import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { z } from 'zod';

import type { TrailRouteFailure } from '@/application/ports/TrailRouter';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  EARTH_RADIUS_METERS,
  geodesicDistanceMeters,
} from '@/domain/tracks/trackCalculations';
import type { RoutingWorkerInitializeRequest } from '@/infrastructure/routing/RoutingWorkerProtocol';
import {
  isWalkableTransportation,
  toRoutingLineMetadata,
  type RoutingLineInput,
  type RoutingTileRectangle,
} from '@/infrastructure/routing/trailGraph';

export const ROUTING_ZOOM = 14;
export const MAX_ROUTING_TILES = 256;
export const ROUTING_TILE_CACHE_ENTRIES = 128;
export const ROUTING_TILE_FETCH_CONCURRENCY = 8;

const minimumRoutingPaddingMeters = 2_000;
const webMercatorMaximumLatitude = 85.051_128_78;

export interface RoutingBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface RoutingTileCoordinate {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly key: string;
}

export interface RoutingTileCoverage {
  readonly tiles: readonly RoutingTileCoordinate[];
  readonly rectangle: RoutingTileRectangle;
}

export interface LoadedRoutingArea extends RoutingTileCoverage {
  readonly lines: readonly RoutingLineInput[];
}

interface AreaTooLargeFailure {
  readonly status: 'failed';
  readonly reason: 'area-too-large';
}

interface RoutingDataFailure {
  readonly status: 'failed';
  readonly reason: 'routing-data-unavailable' | 'routing-data-invalid';
}

export type RoutingTileCoverageResult =
  | { readonly status: 'ready'; readonly coverage: RoutingTileCoverage }
  | AreaTooLargeFailure;

export type RoutingTileLoadResult =
  { readonly status: 'ready'; readonly area: LoadedRoutingArea } | TrailRouteFailure;

export type RoutingTileLoaderInitialization =
  { readonly status: 'ready'; readonly loader: RoutingTileLoader } | RoutingDataFailure;

type RoutingFetch = typeof fetch;

interface DecodedRoutingTile {
  readonly lines: readonly RoutingLineInput[];
}

class RoutingTileDataError extends Error {
  public constructor(
    public readonly reason: 'routing-data-unavailable' | 'routing-data-invalid',
    message: string,
  ) {
    super(message);
    this.name = 'RoutingTileDataError';
  }
}

const tileJsonSchema = z.looseObject({
  tiles: z.array(z.string()),
  minzoom: z.number().int(),
  maxzoom: z.number().int(),
});

function clampMercatorLatitude(latitude: number): number {
  return Math.max(
    -webMercatorMaximumLatitude,
    Math.min(webMercatorMaximumLatitude, latitude),
  );
}

function normalizeLongitudeDelta(longitudeDelta: number): number {
  return ((((longitudeDelta + 180) % 360) + 360) % 360) - 180;
}

function unwrapLongitude(longitude: number, reference: number): number {
  return reference + normalizeLongitudeDelta(longitude - reference);
}

function destinationPoint(
  origin: TrackCoordinate,
  distanceMeters: number,
  bearingDegrees: number,
): TrackCoordinate {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const latitude = (origin[1] * Math.PI) / 180;
  const longitude = (origin[0] * Math.PI) / 180;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
    );
  return [
    (((destinationLongitude * 180) / Math.PI + 540) % 360) - 180,
    clampMercatorLatitude((destinationLatitude * 180) / Math.PI),
  ];
}

export function routingPaddingMeters(
  start: TrackCoordinate,
  destination: TrackCoordinate,
): number {
  return Math.max(
    minimumRoutingPaddingMeters,
    geodesicDistanceMeters(start, destination) * 0.25,
  );
}

export function expandRoutingBounds(
  start: TrackCoordinate,
  destination: TrackCoordinate,
  paddingMeters: number,
): RoutingBounds {
  const unwrappedDestinationLongitude = unwrapLongitude(destination[0], start[0]);
  const endpoints: readonly [
    coordinate: TrackCoordinate,
    unwrappedLongitude: number,
  ][] = [
    [start, start[0]],
    [destination, unwrappedDestinationLongitude],
  ];
  const longitudes: number[] = [start[0], unwrappedDestinationLongitude];
  const latitudes: number[] = [start[1], destination[1]];
  for (const [coordinate, unwrappedLongitude] of endpoints) {
    for (const bearing of [0, 90, 180, 270]) {
      const expanded = destinationPoint(coordinate, paddingMeters, bearing);
      longitudes.push(unwrapLongitude(expanded[0], unwrappedLongitude));
      latitudes.push(expanded[1]);
    }
  }
  return {
    west: Math.min(...longitudes),
    south: clampMercatorLatitude(Math.min(...latitudes)),
    east: Math.max(...longitudes),
    north: clampMercatorLatitude(Math.max(...latitudes)),
  };
}

function longitudeToTileX(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

function latitudeToTileY(latitude: number, zoom: number): number {
  const latitudeRadians = (clampMercatorLatitude(latitude) * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * 2 ** zoom;
}

export function coverRoutingBounds(
  bounds: RoutingBounds,
  zoom = ROUTING_ZOOM,
): RoutingTileCoverageResult {
  const tileCount = 2 ** zoom;
  const rawMinimumX = Math.floor(longitudeToTileX(bounds.west, zoom));
  const rawMaximumXExclusive = Math.ceil(longitudeToTileX(bounds.east, zoom));
  const minimumY = Math.max(0, Math.floor(latitudeToTileY(bounds.north, zoom)));
  const maximumYExclusive = Math.min(
    tileCount,
    Math.ceil(latitudeToTileY(bounds.south, zoom)),
  );
  const xCount = Math.max(0, rawMaximumXExclusive - rawMinimumX);
  const yCount = Math.max(0, maximumYExclusive - minimumY);
  if (xCount * yCount > MAX_ROUTING_TILES) {
    return { status: 'failed', reason: 'area-too-large' };
  }

  const byKey = new Map<string, RoutingTileCoordinate>();
  for (let rawX = rawMinimumX; rawX < rawMaximumXExclusive; rawX += 1) {
    const x = ((rawX % tileCount) + tileCount) % tileCount;
    for (let y = minimumY; y < maximumYExclusive; y += 1) {
      const key = `${String(zoom)}/${String(x)}/${String(y)}`;
      byKey.set(key, { z: zoom, x, y, key });
    }
  }
  const tiles = [...byKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  if (tiles.length > MAX_ROUTING_TILES) {
    return { status: 'failed', reason: 'area-too-large' };
  }
  const xValues = tiles.map((tile) => tile.x);
  const yValues = tiles.map((tile) => tile.y);
  return {
    status: 'ready',
    coverage: {
      tiles,
      rectangle: {
        minTileX: Math.min(...xValues),
        maxTileX: Math.max(...xValues),
        minTileY: Math.min(...yValues),
        maxTileY: Math.max(...yValues),
      },
    },
  };
}

export function resolveRoutingTileUrl(
  template: string,
  tile: RoutingTileCoordinate,
): string {
  return template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{y}', String(tile.y));
}

async function fetchWithTimeout(
  fetcher: RoutingFetch,
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetcher(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!response.ok) {
    throw new RoutingTileDataError(
      'routing-data-unavailable',
      `Routing data request failed with HTTP ${String(response.status)}.`,
    );
  }
  return response;
}

function decodeRoutingTile(
  bytes: Uint8Array,
  tile: RoutingTileCoordinate,
  transportationSourceLayer: string,
): DecodedRoutingTile {
  let vectorTile: VectorTile;
  try {
    vectorTile = new VectorTile(new Pbf(bytes));
  } catch (error) {
    throw new RoutingTileDataError(
      'routing-data-invalid',
      error instanceof Error ? error.message : 'Invalid routing vector tile.',
    );
  }
  const layer = vectorTile.layers[transportationSourceLayer];
  if (layer === undefined) return { lines: [] };
  const lines: RoutingLineInput[] = [];
  for (let index = 0; index < layer.length; index += 1) {
    let feature;
    try {
      feature = layer.feature(index);
    } catch {
      continue;
    }
    if (feature.type !== 2 || !isWalkableTransportation(feature.properties)) continue;
    let geometry;
    try {
      geometry = feature.loadGeometry();
    } catch {
      continue;
    }
    if (!Number.isFinite(feature.extent) || feature.extent <= 0) continue;
    const metadata = toRoutingLineMetadata(feature.properties, feature.id);
    for (const part of geometry) {
      if (
        part.length < 2 ||
        part.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
      ) {
        continue;
      }
      const hasNonZeroEdge = part.some((point, pointIndex) => {
        const previous = part[pointIndex - 1];
        return (
          previous !== undefined && (point.x !== previous.x || point.y !== previous.y)
        );
      });
      if (!hasNonZeroEdge) continue;
      lines.push({
        tileX: tile.x,
        tileY: tile.y,
        extent: feature.extent,
        points: part.map((point) => ({ x: point.x, y: point.y })),
        metadata,
      });
    }
  }
  return { lines };
}

export class RoutingTileLoader {
  readonly #cache = new Map<string, DecodedRoutingTile>();

  private constructor(
    private readonly tileTemplate: string,
    private readonly transportationSourceLayer: string,
    private readonly requestTimeoutMs: number,
    private readonly fetcher: RoutingFetch,
  ) {}

  public static async initialize(
    configuration: RoutingWorkerInitializeRequest,
    signal: AbortSignal,
    fetcher: RoutingFetch = fetch,
  ): Promise<RoutingTileLoaderInitialization> {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetcher,
        configuration.tileJsonUrl,
        configuration.requestTimeoutMs,
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      return {
        status: 'failed',
        reason:
          error instanceof RoutingTileDataError
            ? error.reason
            : 'routing-data-unavailable',
      };
    }

    let rawTileJson: unknown;
    try {
      rawTileJson = await response.json();
    } catch {
      return { status: 'failed', reason: 'routing-data-invalid' };
    }
    const parsed = tileJsonSchema.safeParse(rawTileJson);
    if (!parsed.success) return { status: 'failed', reason: 'routing-data-invalid' };
    if (parsed.data.minzoom > ROUTING_ZOOM || parsed.data.maxzoom < ROUTING_ZOOM) {
      return { status: 'failed', reason: 'routing-data-unavailable' };
    }
    const template = parsed.data.tiles.find(
      (candidate) =>
        candidate.includes('{z}') &&
        candidate.includes('{x}') &&
        candidate.includes('{y}'),
    );
    if (template === undefined) {
      return { status: 'failed', reason: 'routing-data-unavailable' };
    }
    let resolvedTemplate: string;
    try {
      resolvedTemplate = new URL(template, configuration.tileJsonUrl)
        .toString()
        .replaceAll('%7B', '{')
        .replaceAll('%7D', '}');
    } catch {
      return { status: 'failed', reason: 'routing-data-unavailable' };
    }
    return {
      status: 'ready',
      loader: new RoutingTileLoader(
        resolvedTemplate,
        configuration.transportationSourceLayer,
        configuration.requestTimeoutMs,
        fetcher,
      ),
    };
  }

  public get cacheSize(): number {
    return this.#cache.size;
  }

  public get cacheKeys(): readonly string[] {
    return [...this.#cache.keys()];
  }

  public async loadArea(
    start: TrackCoordinate,
    destination: TrackCoordinate,
    paddingMeters: number,
    signal: AbortSignal,
  ): Promise<RoutingTileLoadResult> {
    const coverageResult = coverRoutingBounds(
      expandRoutingBounds(start, destination, paddingMeters),
    );
    if (coverageResult.status === 'failed') return coverageResult;
    try {
      const decoded = await this.loadTiles(coverageResult.coverage.tiles, signal);
      return {
        status: 'ready',
        area: {
          ...coverageResult.coverage,
          lines: decoded.flatMap((tile) => tile.lines),
        },
      };
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Route request canceled.', 'AbortError');
      }
      return {
        status: 'failed',
        reason:
          error instanceof RoutingTileDataError
            ? error.reason
            : 'routing-data-unavailable',
      };
    }
  }

  public dispose(): void {
    this.#cache.clear();
  }

  private async loadTiles(
    tiles: readonly RoutingTileCoordinate[],
    signal: AbortSignal,
  ): Promise<readonly DecodedRoutingTile[]> {
    const decoded = tiles.map<DecodedRoutingTile | undefined>(() => undefined);
    let nextIndex = 0;
    const loadNext = async (): Promise<void> => {
      while (nextIndex < tiles.length) {
        const index = nextIndex;
        nextIndex += 1;
        const tile = tiles[index];
        if (tile !== undefined) decoded[index] = await this.loadTile(tile, signal);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(ROUTING_TILE_FETCH_CONCURRENCY, tiles.length) },
        () => loadNext(),
      ),
    );
    return decoded.map((tile) => {
      if (tile === undefined) {
        throw new RoutingTileDataError(
          'routing-data-invalid',
          'A routing tile did not produce a decoded result.',
        );
      }
      return tile;
    });
  }

  private async loadTile(
    tile: RoutingTileCoordinate,
    signal: AbortSignal,
  ): Promise<DecodedRoutingTile> {
    const cached = this.#cache.get(tile.key);
    if (cached !== undefined) {
      this.#cache.delete(tile.key);
      this.#cache.set(tile.key, cached);
      return cached;
    }
    const response = await fetchWithTimeout(
      this.fetcher,
      resolveRoutingTileUrl(this.tileTemplate, tile),
      this.requestTimeoutMs,
      signal,
    );
    const decoded = decodeRoutingTile(
      new Uint8Array(await response.arrayBuffer()),
      tile,
      this.transportationSourceLayer,
    );
    this.#cache.set(tile.key, decoded);
    while (this.#cache.size > ROUTING_TILE_CACHE_ENTRIES) {
      const oldestKey = this.#cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.#cache.delete(oldestKey);
    }
    return decoded;
  }
}
