import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import type { KyInstance } from 'ky';
import Pbf from 'pbf';
import { z } from 'zod';

import type { IdGenerator } from '@/application/ports/IdGenerator';
import {
  PlaceSearchFailure,
  type PlaceSearchKind,
  type PlaceSearchResult,
} from '@/application/ports/PlaceSearchGateway';
import {
  EARTH_RADIUS_METERS,
  geodesicDistanceMeters,
} from '@/domain/tracks/trackCalculations';
import { translatePlaceSearchFailure } from '@/infrastructure/geocoding/NominatimPlaceSearchGateway';

/** OpenMapTiles puts hiking and historic POIs only into z14 tiles. */
const landmarkZoom = 14;
const landmarkRadiusMeters = 2_000;
const webMercatorMaximumLatitude = 85.051_128_78;

const tileJsonSchema = z.looseObject({
  tiles: z.array(z.string()).min(1),
  maxzoom: z.number().int(),
});

type FeatureProperties = VectorTileFeature['properties'];

/** The configured OpenMapTiles source-layer names, as the map style uses them. */
export interface LandmarkSourceLayers {
  readonly peaks: string;
  readonly pois: string;
  readonly places: string;
  readonly waterNames: string;
}

type LandmarkRole = keyof LandmarkSourceLayers;

const landmarkRoles: readonly LandmarkRole[] = [
  'peaks',
  'pois',
  'places',
  'waterNames',
];

interface LandmarkClass {
  /** OSM `key:value`, the vocabulary track naming ranks. */
  readonly category: string;
  readonly kind: PlaceSearchKind;
}

const settlementClasses = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'isolated_dwelling',
]);

/** `poi.subclass` carries the OSM value; its key is implied by the schema mapping. */
const poiCategories: Readonly<Record<string, string>> = {
  alpine_hut: 'tourism:alpine_hut',
  viewpoint: 'tourism:viewpoint',
  camp_site: 'tourism:camp_site',
  attraction: 'tourism:attraction',
  shelter: 'amenity:shelter',
  castle: 'historic:castle',
  ruins: 'historic:ruins',
  monument: 'historic:monument',
};

function stringProperty(properties: FeatureProperties, key: string): string | null {
  const value = properties[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 2_000);
}

function landmarkClass(
  role: LandmarkRole,
  properties: FeatureProperties,
): LandmarkClass | null {
  const featureClass = stringProperty(properties, 'class');
  if (featureClass === null) return null;
  switch (role) {
    case 'peaks':
      return featureClass === 'peak' ||
        featureClass === 'volcano' ||
        featureClass === 'saddle'
        ? { category: `natural:${featureClass}`, kind: 'mountain' }
        : null;
    case 'places':
      return settlementClasses.has(featureClass)
        ? { category: `place:${featureClass}`, kind: 'settlement' }
        : null;
    case 'waterNames':
      return featureClass === 'lake'
        ? { category: 'natural:water', kind: 'water' }
        : null;
    case 'pois': {
      // A place of worship's subclass is its religion.
      if (featureClass === 'place_of_worship') {
        return { category: 'amenity:place_of_worship', kind: 'other' };
      }
      const subclass = stringProperty(properties, 'subclass');
      const category = subclass === null ? undefined : poiCategories[subclass];
      return category === undefined ? null : { category, kind: 'other' };
    }
  }
}

function landmarkName(properties: FeatureProperties): string | null {
  for (const key of ['name:en', 'name:latin', 'name_int', 'name']) {
    const name = stringProperty(properties, key);
    if (name !== null) return name;
  }
  return null;
}

interface TileAddress {
  readonly x: number;
  readonly y: number;
}

function tileY(latitude: number): number {
  const radians = (latitude * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** landmarkZoom;
}

/**
 * The z14 tiles covering the lookup radius: 3–4 tiles per side at Georgian latitudes.
 * Web Mercator tiles stop short of the poles, so no tile covers an anchor there.
 */
function tilesAround(coordinate: {
  readonly longitude: number;
  readonly latitude: number;
}): readonly TileAddress[] {
  if (Math.abs(coordinate.latitude) > webMercatorMaximumLatitude) return [];
  const tileCount = 2 ** landmarkZoom;
  const latitudeDelta = (landmarkRadiusMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const longitudeDelta =
    latitudeDelta / Math.cos((coordinate.latitude * Math.PI) / 180);
  const tileX = (longitude: number) =>
    Math.floor(((longitude + 180) / 360) * tileCount);
  const tiles: TileAddress[] = [];
  const minimumY = Math.max(0, Math.floor(tileY(coordinate.latitude + latitudeDelta)));
  const maximumY = Math.min(
    tileCount - 1,
    Math.floor(tileY(coordinate.latitude - latitudeDelta)),
  );
  for (
    let rawX = tileX(coordinate.longitude - longitudeDelta);
    rawX <= tileX(coordinate.longitude + longitudeDelta);
    rawX += 1
  ) {
    for (let y = minimumY; y <= maximumY; y += 1) {
      tiles.push({ x: ((rawX % tileCount) + tileCount) % tileCount, y });
    }
  }
  return tiles;
}

/**
 * A point feature's position, or a label line's middle vertex; areas are skipped. Tiles
 * repeat points near their edges in a buffer, so a point outside the tile's own extent
 * is left to the neighbouring tile that owns it.
 */
function featureCoordinate(
  feature: VectorTileFeature,
  tile: TileAddress,
): { readonly longitude: number; readonly latitude: number } | null {
  if (feature.type !== 1 && feature.type !== 2) return null;
  const part = feature.loadGeometry()[0];
  const point = part?.[Math.floor(part.length / 2)];
  if (point === undefined) return null;
  if (
    feature.type === 1 &&
    (point.x < 0 ||
      point.y < 0 ||
      point.x >= feature.extent ||
      point.y >= feature.extent)
  ) {
    return null;
  }
  const tileCount = 2 ** landmarkZoom;
  const longitude = ((tile.x + point.x / feature.extent) / tileCount) * 360 - 180;
  const mercatorY =
    Math.PI * (1 - (2 * (tile.y + point.y / feature.extent)) / tileCount);
  const latitude = (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI;
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? { longitude, latitude }
    : null;
}

function decodeLandmarks(
  bytes: ArrayBuffer,
  tile: TileAddress,
  sourceLayers: LandmarkSourceLayers,
): readonly PlaceSearchResult[] {
  let vectorTile: VectorTile;
  try {
    vectorTile = new VectorTile(new Pbf(new Uint8Array(bytes)));
  } catch {
    throw new PlaceSearchFailure(
      'invalid-response',
      'The basemap returned an unreadable vector tile.',
    );
  }
  const results: PlaceSearchResult[] = [];
  for (const role of landmarkRoles) {
    const layerName = sourceLayers[role];
    const layer = vectorTile.layers[layerName];
    if (layer === undefined) continue;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const label = landmarkName(feature.properties);
      const classification = landmarkClass(role, feature.properties);
      if (label === null || classification === null) continue;
      const coordinate = featureCoordinate(feature, tile);
      if (coordinate === null) continue;
      results.push({
        id: `basemap:${layerName}/${String(feature.id ?? `${String(tile.x)}/${String(tile.y)}/${String(index)}`)}`,
        label,
        coordinate,
        category: classification.category,
        kind: classification.kind,
        bounds: null,
      });
    }
  }
  return results;
}

/**
 * Named landmarks read from the basemap's OpenMapTiles z14 vector tiles: the data the
 * map labels, on a CDN without request limits. The browser HTTP cache shares tiles
 * with MapLibre.
 */
export class BasemapLandmarkGateway {
  #tileTemplate: string | null = null;

  public constructor(
    private readonly httpClient: KyInstance,
    private readonly tileJsonUrl: string,
    private readonly sourceLayers: LandmarkSourceLayers,
    private readonly requestTimeoutMs: number,
    private readonly idGenerator: IdGenerator,
  ) {}

  public async nearby(
    coordinate: { readonly longitude: number; readonly latitude: number },
    signal: AbortSignal,
  ): Promise<readonly PlaceSearchResult[]> {
    try {
      const template = await this.tileTemplate(signal);
      const perTile = await Promise.all(
        tilesAround(coordinate).map(async (tile) => {
          const url = template
            .replaceAll('{z}', String(landmarkZoom))
            .replaceAll('{x}', String(tile.x))
            .replaceAll('{y}', String(tile.y));
          const bytes = await this.httpClient
            .get(url, {
              context: { operationId: this.idGenerator.generate() },
              signal,
              timeout: this.requestTimeoutMs,
            })
            .arrayBuffer();
          return decodeLandmarks(bytes, tile, this.sourceLayers);
        }),
      );
      const anchor = [coordinate.longitude, coordinate.latitude] as const;
      return perTile
        .flat()
        .filter(
          (result) =>
            geodesicDistanceMeters(anchor, [
              result.coordinate.longitude,
              result.coordinate.latitude,
            ]) <= landmarkRadiusMeters,
        );
    } catch (error) {
      return translatePlaceSearchFailure(error, signal);
    }
  }

  private async tileTemplate(signal: AbortSignal): Promise<string> {
    if (this.#tileTemplate !== null) return this.#tileTemplate;
    const tileJson = tileJsonSchema.parse(
      await this.httpClient
        .get(this.tileJsonUrl, {
          context: { operationId: this.idGenerator.generate() },
          signal,
          timeout: this.requestTimeoutMs,
        })
        .json<unknown>(),
    );
    const template = tileJson.tiles.find(
      (candidate) =>
        candidate.includes('{z}') &&
        candidate.includes('{x}') &&
        candidate.includes('{y}'),
    );
    if (tileJson.maxzoom < landmarkZoom || template === undefined) {
      throw new PlaceSearchFailure(
        'invalid-response',
        'The basemap TileJSON has no z14 vector tiles.',
      );
    }
    this.#tileTemplate = new URL(template, this.tileJsonUrl)
      .toString()
      .replaceAll('%7B', '{')
      .replaceAll('%7D', '}');
    return this.#tileTemplate;
  }
}
