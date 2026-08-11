import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { z } from 'zod';

import type { TrailRouteResult } from '@/application/ports/TrailRouter';
import {
  loadMapProviderConfiguration,
  type MapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { executeTrailRoute } from '@/infrastructure/routing/RoutingWorkerServer';
import { RoutingTileLoader } from '@/infrastructure/routing/routingTiles';

const DEFAULT_LONGITUDE = 44.6408;
const DEFAULT_LATITUDE = 42.6602;
const DEFAULT_ZOOM = 14;
const GRAPH_EXTENT = 4_096;

interface RouteStressCoordinates {
  readonly start: TrackCoordinate;
  readonly destination: TrackCoordinate;
}

interface InspectionOptions {
  readonly longitude: number;
  readonly latitude: number;
  readonly zoom: number;
  readonly routeStress: RouteStressCoordinates | null;
}

interface TileJson {
  readonly tiles: readonly string[];
  readonly minzoom?: number;
  readonly maxzoom?: number;
}

const tileJsonSchema = z.looseObject({
  tiles: z.array(z.string()),
  minzoom: z.number().optional(),
  maxzoom: z.number().optional(),
});

interface TileCoordinate {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

function parseNumber(value: string | undefined, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${option} requires a finite number.`);
  return parsed;
}

function parseArguments(): InspectionOptions {
  const values = process.argv.slice(2).filter((value) => value !== '--');
  let longitude = DEFAULT_LONGITUDE;
  let latitude = DEFAULT_LATITUDE;
  let zoom = DEFAULT_ZOOM;
  let startLatitude: number | undefined;
  let startLongitude: number | undefined;
  let destinationLatitude: number | undefined;
  let destinationLongitude: number | undefined;

  for (let index = 0; index < values.length; index += 2) {
    const option = values[index];
    const value = values[index + 1];
    if (option === '--longitude') longitude = parseNumber(value, option);
    else if (option === '--latitude') latitude = parseNumber(value, option);
    else if (option === '--zoom') zoom = parseNumber(value, option);
    else if (option === '--start-latitude') {
      startLatitude = parseNumber(value, option);
    } else if (option === '--start-longitude') {
      startLongitude = parseNumber(value, option);
    } else if (option === '--destination-latitude') {
      destinationLatitude = parseNumber(value, option);
    } else if (option === '--destination-longitude') {
      destinationLongitude = parseNumber(value, option);
    } else throw new Error(`Unknown option: ${option ?? '<missing>'}.`);
  }

  if (values.length % 2 !== 0) throw new Error('Every option requires a value.');
  if (longitude < -180 || longitude > 180)
    throw new Error('Longitude must be in [-180, 180].');
  if (latitude < -85.051_128_78 || latitude > 85.051_128_78) {
    throw new Error('Latitude must be within Web Mercator limits.');
  }
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 24) {
    throw new Error('Zoom must be an integer in [0, 24].');
  }

  const routeValues = [
    startLatitude,
    startLongitude,
    destinationLatitude,
    destinationLongitude,
  ];
  const routeValueCount = routeValues.filter((value) => value !== undefined).length;
  if (routeValueCount !== 0 && routeValueCount !== routeValues.length) {
    throw new Error(
      'Route stress requires all four start/destination coordinate flags.',
    );
  }
  let routeStress: RouteStressCoordinates | null = null;
  if (
    startLatitude !== undefined &&
    startLongitude !== undefined &&
    destinationLatitude !== undefined &&
    destinationLongitude !== undefined
  ) {
    if (
      startLongitude < -180 ||
      startLongitude > 180 ||
      destinationLongitude < -180 ||
      destinationLongitude > 180
    ) {
      throw new Error('Route stress longitudes must be in [-180, 180].');
    }
    if (
      startLatitude < -85.051_128_78 ||
      startLatitude > 85.051_128_78 ||
      destinationLatitude < -85.051_128_78 ||
      destinationLatitude > 85.051_128_78
    ) {
      throw new Error('Route stress latitudes must be within Web Mercator limits.');
    }
    routeStress = {
      start: [startLongitude, startLatitude],
      destination: [destinationLongitude, destinationLatitude],
    };
  }
  return { longitude, latitude, zoom, routeStress };
}

function parseTileJson(value: unknown): TileJson {
  const parsed = tileJsonSchema.safeParse(value);
  if (!parsed.success)
    throw new Error('TileJSON does not contain a valid tiles array.');
  const tiles = parsed.data.tiles.filter(
    (template) =>
      template.includes('{z}') && template.includes('{x}') && template.includes('{y}'),
  );
  if (tiles.length === 0) throw new Error('TileJSON has no usable XYZ template.');

  const result: { tiles: readonly string[]; minzoom?: number; maxzoom?: number } = {
    tiles,
  };
  if (parsed.data.minzoom !== undefined) result.minzoom = parsed.data.minzoom;
  if (parsed.data.maxzoom !== undefined) result.maxzoom = parsed.data.maxzoom;
  return result;
}

function centerTile(longitude: number, latitude: number, zoom: number): TileCoordinate {
  const tileCount = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * tileCount);
  const latitudeRadians = (latitude * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * tileCount,
  );
  return { z: zoom, x, y };
}

function inspectionTiles(center: TileCoordinate): readonly TileCoordinate[] {
  const tileCount = 2 ** center.z;
  const tiles: TileCoordinate[] = [];
  for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      const x = (center.x + xOffset + tileCount) % tileCount;
      const y = center.y + yOffset;
      if (y >= 0 && y < tileCount) tiles.push({ z: center.z, x, y });
    }
  }
  return tiles;
}

function resolveTileUrl(
  template: string,
  tile: TileCoordinate,
  tileJsonUrl: string,
): string {
  const resolved = template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{y}', String(tile.y));
  return new URL(resolved, tileJsonUrl).toString();
}

function sorted(values: ReadonlySet<string>): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(`TileJSON request failed with HTTP ${String(response.status)}.`);
  return response.json() as Promise<unknown>;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(`Tile request failed with HTTP ${String(response.status)}.`);
  return new Uint8Array(await response.arrayBuffer());
}

function routeStressReport(
  input: RouteStressCoordinates,
  result: TrailRouteResult,
  elapsedMilliseconds: number,
): Readonly<Record<string, unknown>> {
  const base = {
    input,
    status: result.status,
    elapsedMilliseconds,
  };
  if (result.status === 'failed') {
    return {
      ...base,
      reason: result.reason,
      endpoint: result.endpoint ?? null,
    };
  }
  return {
    ...base,
    snappedStart: result.snappedStart,
    snappedDestination: result.snappedDestination,
    networkDistanceMeters: result.networkDistanceMeters,
    loadedTileCount: result.loadedTileCount,
    graphNodeCount: result.graphNodeCount,
    graphEdgeCount: result.graphEdgeCount,
    expandedAreaRetryUsed: result.expandedAreaRetryUsed,
    geometryPointCount: result.geometry.coordinates.length,
  };
}

async function runRouteStress(
  input: RouteStressCoordinates,
  configuration: MapProviderConfiguration,
): Promise<void> {
  const startedAt = performance.now();
  const signal = new AbortController().signal;
  const initialization = await RoutingTileLoader.initialize(
    {
      tileJsonUrl: configuration.detailVector.tileJsonUrl,
      transportationSourceLayer: configuration.detailVector.sourceLayers.streets,
      requestTimeoutMs: configuration.policy.requestTimeoutMs,
    },
    signal,
  );
  let result: TrailRouteResult;
  if (initialization.status === 'failed') {
    result = { status: 'failed', reason: initialization.reason };
  } else {
    try {
      result = await executeTrailRoute(initialization.loader, input, signal);
    } finally {
      initialization.loader.dispose();
    }
  }
  const elapsedMilliseconds =
    Math.round((performance.now() - startedAt) * 1_000) / 1_000;
  process.stdout.write(
    `${JSON.stringify(
      {
        inspectedAt: new Date().toISOString(),
        tileJsonUrl: configuration.detailVector.tileJsonUrl,
        transportationLayer: configuration.detailVector.sourceLayers.streets,
        routeStress: routeStressReport(input, result, elapsedMilliseconds),
      },
      null,
      2,
    )}\n`,
  );
  if (result.status !== 'ready') process.exitCode = 1;
}

async function main(): Promise<void> {
  const options = parseArguments();
  const configurationResult = loadMapProviderConfiguration(
    process.env.VITE_MAP_PROVIDER_CONFIGURATION,
    new URL(`file://${process.cwd()}/`).toString(),
  );
  if (configurationResult.status !== 'valid')
    throw new Error(configurationResult.message);

  const configuration = configurationResult.value;
  if (options.routeStress !== null) {
    await runRouteStress(options.routeStress, configuration);
    return;
  }

  const tileJson = parseTileJson(
    await fetchJson(configuration.detailVector.tileJsonUrl),
  );
  const template = tileJson.tiles[0];
  if (template === undefined) throw new Error('TileJSON has no usable XYZ template.');
  const tiles = inspectionTiles(
    centerTile(options.longitude, options.latitude, options.zoom),
  );
  if (tiles.length !== 9)
    throw new Error(`Expected 9 inspection tiles, received ${String(tiles.length)}.`);

  const keys = new Set<string>();
  const kinds = new Set<string>();
  const repeatedEndpoints = new Map<string, number>();
  const graphVertexAppearances = new Map<string, number>();
  const representativePathProperties: Readonly<Record<string, unknown>>[] = [];
  const representativeTrackProperties: Readonly<Record<string, unknown>>[] = [];
  let transportationFeatures = 0;
  let lineFeatures = 0;
  let polygonFeatures = 0;
  let featuresWithIds = 0;

  await Promise.all(
    tiles.map(async (tile) => {
      const bytes = await fetchBytes(
        resolveTileUrl(template, tile, configuration.detailVector.tileJsonUrl),
      );
      const vectorTile = new VectorTile(new Pbf(bytes));
      const layer = vectorTile.layers[configuration.detailVector.sourceLayers.streets];
      if (layer === undefined) return;

      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        transportationFeatures += 1;
        if (feature.id !== undefined) featuresWithIds += 1;
        for (const key of Object.keys(feature.properties)) keys.add(key);
        const kind = feature.properties.kind;
        if (typeof kind === 'string') kinds.add(kind);
        if (kind === 'path' && representativePathProperties.length < 3) {
          representativePathProperties.push({ ...feature.properties });
        }
        if (kind === 'track' && representativeTrackProperties.length < 3) {
          representativeTrackProperties.push({ ...feature.properties });
        }

        if (feature.type === 2) {
          lineFeatures += 1;
          for (const part of feature.loadGeometry()) {
            for (const point of part) {
              const globalX =
                tile.x * GRAPH_EXTENT +
                Math.round((point.x * GRAPH_EXTENT) / feature.extent);
              const globalY =
                tile.y * GRAPH_EXTENT +
                Math.round((point.y * GRAPH_EXTENT) / feature.extent);
              const key = `${String(globalX)},${String(globalY)}`;
              graphVertexAppearances.set(
                key,
                (graphVertexAppearances.get(key) ?? 0) + 1,
              );
            }
            const first = part[0];
            const last = part.at(-1);
            if (first === undefined || last === undefined) continue;
            for (const point of [first, last]) {
              const globalX =
                tile.x * GRAPH_EXTENT +
                Math.round((point.x * GRAPH_EXTENT) / feature.extent);
              const globalY =
                tile.y * GRAPH_EXTENT +
                Math.round((point.y * GRAPH_EXTENT) / feature.extent);
              const key = `${String(globalX)},${String(globalY)}`;
              repeatedEndpoints.set(key, (repeatedEndpoints.get(key) ?? 0) + 1);
            }
          }
        } else if (feature.type === 3) {
          polygonFeatures += 1;
        }
      }
    }),
  );

  const sharedEndpointKeys = [...repeatedEndpoints.values()].filter(
    (count) => count > 1,
  ).length;
  const repeatedEndpointOccurrences = [...repeatedEndpoints.values()].reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );
  const sharedGraphVertexKeys = [...graphVertexAppearances.values()].filter(
    (count) => count > 1,
  ).length;
  const report = {
    inspectedAt: new Date().toISOString(),
    center: {
      longitude: options.longitude,
      latitude: options.latitude,
      zoom: options.zoom,
    },
    tileJsonUrl: configuration.detailVector.tileJsonUrl,
    tileTemplate: new URL(template, configuration.detailVector.tileJsonUrl).toString(),
    advertisedZoomRange: {
      minzoom: tileJson.minzoom ?? null,
      maxzoom: tileJson.maxzoom ?? null,
    },
    requestedTileCount: tiles.length,
    successfulTileCount: tiles.length,
    transportationLayer: configuration.detailVector.sourceLayers.streets,
    geometryCounts: {
      features: transportationFeatures,
      lines: lineFeatures,
      polygons: polygonFeatures,
      other: transportationFeatures - lineFeatures - polygonFeatures,
    },
    propertyKeys: sorted(keys),
    kinds: sorted(kinds),
    featureIdCoverage: {
      present: featuresWithIds,
      total: transportationFeatures,
    },
    sharedEndpointKeys,
    repeatedEndpointOccurrences,
    sharedGraphVertexKeys,
    representativePathProperties,
    representativeTrackProperties,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown routing tile inspection failure.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
