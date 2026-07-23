import { HTTPError, TimeoutError, type KyInstance } from 'ky';
import { z } from 'zod';

import type { IdGenerator } from '@/application/ports/IdGenerator';
import { geodesicDistanceKm } from '@/application/map/expandPlaceSearchBounds';
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

const nearbyResultSchema = z
  .object({
    elements: z
      .array(
        z
          .object({
            type: z.enum(['node', 'way', 'relation']),
            id: z.number().int().nonnegative(),
            lat: z.number().optional(),
            lon: z.number().optional(),
            center: z.object({ lat: z.number(), lon: z.number() }).strict().optional(),
            tags: z.record(z.string(), z.string()).optional(),
          })
          .loose(),
      )
      .max(50),
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
const nearbyTagKeys = [
  'mountain_pass',
  'natural',
  'amenity',
  'tourism',
  'historic',
  'man_made',
  'place',
  'leisure',
  'shop',
  'waterway',
] as const;
const nearbyRadiusMeters = 2_000;

function nearbyQuery(latitude: number, longitude: number): string {
  return `[out:json][timeout:10];nwr(around:${String(nearbyRadiusMeters)},${latitude.toFixed(6)},${longitude.toFixed(6)})["name"][~"^(${nearbyTagKeys.join('|')})$"~"."];out center 50;`;
}

function nearbyName(tags: Readonly<Record<string, string>>): string | null {
  for (const key of ['name:en', 'name:latin', 'int_name', 'name'] as const) {
    const value = tags[key]?.trim();
    if (value !== undefined && value.length > 0) return value.slice(0, 2_000);
  }
  return null;
}

function nearbyCategory(
  tags: Readonly<Record<string, string>>,
): { readonly category: string; readonly type: string } | null {
  for (const category of nearbyTagKeys) {
    const type = tags[category]?.trim();
    if (type !== undefined && type.length > 0) return { category, type };
  }
  return null;
}

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

/** Public OSM place adapter with application-wide pacing and a bounded cache. */
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

  public async nearby(
    coordinate: { readonly longitude: number; readonly latitude: number },
    signal: AbortSignal,
  ): Promise<readonly PlaceSearchResult[]> {
    const nearbyUrl = this.configuration.nearbyUrl;
    if (nearbyUrl === undefined) return [];
    const cacheKey = `nearby|${coordinate.longitude.toFixed(5)}|${coordinate.latitude.toFixed(5)}`;
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.results;

    await this.waitForRequestSlot(signal);
    try {
      const raw = await this.httpClient
        .post(nearbyUrl, {
          context: { operationId: this.idGenerator.generate() },
          body: new URLSearchParams({
            data: nearbyQuery(coordinate.latitude, coordinate.longitude),
          }),
          signal,
          timeout: this.configuration.requestTimeoutMs,
        })
        .json<unknown>();
      const parsed = nearbyResultSchema.parse(raw);
      const results = parsed.elements
        .flatMap<PlaceSearchResult>((element) => {
          const result = this.toNearbyPlaceSearchResult(element);
          return result === null ? [] : [result];
        })
        .filter(
          (result) =>
            geodesicDistanceKm(
              coordinate.latitude,
              coordinate.longitude,
              result.coordinate.latitude,
              result.coordinate.longitude,
            ) <=
            nearbyRadiusMeters / 1_000,
        );
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

  private toNearbyPlaceSearchResult(
    element: z.infer<typeof nearbyResultSchema>['elements'][number],
  ): PlaceSearchResult | null {
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    const tags = element.tags;
    if (
      latitude === undefined ||
      longitude === undefined ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      tags === undefined
    ) {
      return null;
    }
    const label = nearbyName(tags);
    const classification = nearbyCategory(tags);
    if (label === null || classification === null) return null;
    return {
      id: `osm:${element.type}/${String(element.id)}`,
      label,
      coordinate: { longitude, latitude },
      category: `${classification.category}:${classification.type}`,
      kind: classifyResult(classification.category, classification.type),
      bounds: null,
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
