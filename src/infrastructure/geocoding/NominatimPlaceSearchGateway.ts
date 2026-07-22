import { HTTPError, TimeoutError, type KyInstance } from 'ky';
import { z } from 'zod';

import type { IdGenerator } from '@/application/ports/IdGenerator';
import {
  PlaceSearchFailure,
  type PlaceSearchBounds,
  type PlaceSearchGateway,
  type PlaceSearchKind,
  type PlaceSearchResult,
} from '@/application/ports/PlaceSearchGateway';
import type { GeocodingProviderConfiguration } from '@/bootstrap/configuration/GeocodingProviderConfiguration';

const resultSchema = z
  .array(
    z
      .object({
        place_id: z.number().int().nonnegative(),
        lat: z.string(),
        lon: z.string(),
        display_name: z.string().trim().min(1).max(2_000),
        category: z.string().trim().min(1).max(100),
        type: z.string().trim().min(1).max(100),
        osm_type: z.enum(['node', 'way', 'relation']),
        boundingbox: z.tuple([z.string(), z.string(), z.string(), z.string()]),
      })
      .loose(),
  )
  .max(10);

const reverseResultSchema = z
  .object({
    place_id: z.number().int().nonnegative(),
    lat: z.string(),
    lon: z.string(),
    display_name: z.string().trim().min(1).max(2_000),
    category: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(100),
    osm_type: z.enum(['node', 'way', 'relation']),
    boundingbox: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  })
  .loose();

interface CacheEntry {
  readonly expiresAt: number;
  readonly results: readonly PlaceSearchResult[];
}

const mountainTypes = new Set([
  'mountain_pass',
  'mountain_range',
  'peak',
  'ridge',
  'saddle',
  'volcano',
]);
const settlementTypes = new Set([
  'city',
  'hamlet',
  'isolated_dwelling',
  'town',
  'village',
]);
const waterTypes = new Set([
  'bay',
  'canal',
  'lake',
  'lagoon',
  'oxbow',
  'pond',
  'reservoir',
  'river',
  'riverbank',
  'spring',
  'strait',
  'stream',
  'waterfall',
  'water',
]);

function classifyResult(category: string, type: string): PlaceSearchKind {
  if (category === 'place' && settlementTypes.has(type)) return 'settlement';
  if (category === 'boundary' && type === 'administrative') {
    return 'administrative-area';
  }
  if (category === 'natural' && mountainTypes.has(type)) return 'mountain';
  if (category === 'mountain_pass' && type === 'yes') return 'mountain';
  if (
    (category === 'water' && waterTypes.has(type)) ||
    (category === 'waterway' && waterTypes.has(type)) ||
    (category === 'natural' && waterTypes.has(type))
  ) {
    return 'water';
  }
  return 'other';
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new DOMException('Place search cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Submit-only public Nominatim adapter with application-wide pacing and bounded cache. */
export class NominatimPlaceSearchGateway implements PlaceSearchGateway {
  readonly #cache = new Map<string, CacheEntry>();
  #lastRequestStartedAt = 0;

  public constructor(
    private readonly httpClient: KyInstance,
    private readonly configuration: GeocodingProviderConfiguration,
    private readonly idGenerator: IdGenerator,
    private readonly now: () => number = Date.now,
  ) {}

  public async reverse(
    coordinate: { readonly longitude: number; readonly latitude: number },
    signal: AbortSignal,
  ): Promise<PlaceSearchResult | null> {
    const cacheKey = `reverse|${coordinate.longitude.toFixed(5)}|${coordinate.latitude.toFixed(5)}`;
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return cached.results[0] ?? null;
    }
    await this.waitForRequestSlot(signal);
    const reverseUrl =
      this.configuration.reverseUrl ??
      new URL('reverse', this.configuration.searchUrl).toString();
    try {
      const raw = await this.httpClient
        .get(reverseUrl, {
          context: { operationId: this.idGenerator.generate() },
          headers: { 'Accept-Language': 'en' },
          searchParams: {
            lat: coordinate.latitude.toFixed(6),
            lon: coordinate.longitude.toFixed(6),
            format: 'jsonv2',
            addressdetails: '0',
            zoom: '14',
          },
          signal,
          timeout: this.configuration.requestTimeoutMs,
        })
        .json<unknown>();
      const candidate = reverseResultSchema.parse(raw);
      const result = this.toPlaceSearchResult(candidate);
      const results = result === null ? [] : [result];
      this.remember(cacheKey, results);
      return result;
    } catch (error) {
      return this.translateFailure(error, signal);
    }
  }

  public async search(
    query: string,
    bounds: PlaceSearchBounds,
    signal: AbortSignal,
  ): Promise<readonly PlaceSearchResult[]> {
    const viewbox = [bounds.west, bounds.north, bounds.east, bounds.south]
      .map((coordinate) => coordinate.toFixed(6))
      .join(',');
    const cacheKey = `${query.toLocaleLowerCase('en')}|${viewbox}`;
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.results;

    await this.waitForRequestSlot(signal);

    try {
      const raw = await this.httpClient
        .get(this.configuration.searchUrl, {
          context: { operationId: this.idGenerator.generate() },
          headers: { 'Accept-Language': 'en' },
          searchParams: {
            q: query,
            format: 'jsonv2',
            addressdetails: '0',
            limit: String(this.configuration.maximumResults),
            viewbox,
            bounded: '1',
            layer: 'address,natural,manmade',
          },
          signal,
          timeout: this.configuration.requestTimeoutMs,
        })
        .json<unknown>();
      const parsed = resultSchema.parse(raw);
      const results = parsed.flatMap<PlaceSearchResult>((candidate) => {
        const result = this.toPlaceSearchResult(candidate);
        return result === null ? [] : [result];
      });
      this.remember(cacheKey, results);
      return results;
    } catch (error) {
      return this.translateFailure(error, signal);
    }
  }

  private async waitForRequestSlot(signal: AbortSignal): Promise<void> {
    const delay = Math.max(
      0,
      this.configuration.minimumRequestIntervalMs -
        (this.now() - this.#lastRequestStartedAt),
    );
    await waitFor(delay, signal);
    signal.throwIfAborted();
    this.#lastRequestStartedAt = this.now();
  }

  private remember(cacheKey: string, results: readonly PlaceSearchResult[]): void {
    if (this.#cache.size >= 50) {
      this.#cache.delete(this.#cache.keys().next().value ?? '');
    }
    this.#cache.set(cacheKey, {
      expiresAt: this.now() + 5 * 60_000,
      results,
    });
  }

  private toPlaceSearchResult(
    candidate: z.infer<typeof reverseResultSchema>,
  ): PlaceSearchResult | null {
    const latitude = Number(candidate.lat);
    const longitude = Number(candidate.lon);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }
    const [southText, northText, westText, eastText] = candidate.boundingbox;
    const south = Number(southText);
    const north = Number(northText);
    const west = Number(westText);
    const east = Number(eastText);
    const bounds =
      candidate.osm_type === 'node' ||
      !Number.isFinite(south) ||
      !Number.isFinite(north) ||
      !Number.isFinite(west) ||
      !Number.isFinite(east) ||
      south < -90 ||
      north > 90 ||
      west < -180 ||
      east > 180 ||
      south >= north ||
      west >= east
        ? null
        : { west, south, east, north };
    return {
      id: String(candidate.place_id),
      label: candidate.display_name,
      coordinate: { longitude, latitude },
      category: `${candidate.category}:${candidate.type}`,
      kind: classifyResult(candidate.category, candidate.type),
      bounds,
    };
  }

  private translateFailure(error: unknown, signal: AbortSignal): never {
    if (signal.aborted) throw error;
    if (error instanceof TimeoutError) {
      throw new PlaceSearchFailure('timeout', 'Place search timed out. Try again.');
    }
    if (error instanceof HTTPError && error.response.status === 429) {
      throw new PlaceSearchFailure(
        'rate-limited',
        'Place search is temporarily rate limited. Wait and try again.',
      );
    }
    if (error instanceof z.ZodError) {
      throw new PlaceSearchFailure(
        'invalid-response',
        'The place provider returned an unsupported response.',
      );
    }
    throw new PlaceSearchFailure('network', 'Place search is unavailable. Try again.');
  }
}
