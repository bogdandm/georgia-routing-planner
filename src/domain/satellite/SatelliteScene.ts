import type { MultiPolygon, Polygon } from 'geojson';

import type { SatelliteProductLevel } from '@/domain/satellite/SatelliteSearchCriteria';
import { SatelliteGeometryError } from '@/domain/satellite/SatelliteGeometryError';

export type SatelliteVisualAsset =
  | {
      readonly kind: 'sentinel-l2a';
      readonly itemHref: string;
      readonly visualHref: string;
      readonly mediaType: string;
      readonly projectionEpsg: number;
    }
  | {
      readonly kind: 'unsupported-jp2';
      readonly href: string;
      readonly mediaType: string;
      readonly projectionEpsg: number;
    }
  | { readonly kind: 'unavailable' };

export interface SatelliteScene {
  readonly id: string;
  readonly collection: string;
  readonly platform: string;
  readonly productLevel: SatelliteProductLevel;
  readonly acquiredAt: string;
  readonly cloudCoverPercent: number;
  readonly footprint: Polygon | MultiPolygon;
  readonly tileId: string | null;
  readonly orbit: string | null;
  readonly productId: string | null;
  readonly thumbnailHref: string | null;
  readonly visualAsset: SatelliteVisualAsset;
  readonly attribution: string;
}

export function satelliteSceneKey(scene: SatelliteScene): string {
  return `${scene.collection}:${scene.id}`;
}

export function satelliteSceneBounds(
  scene: SatelliteScene,
): [west: number, south: number, east: number, north: number] {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  const polygons =
    scene.footprint.type === 'Polygon'
      ? [scene.footprint.coordinates]
      : scene.footprint.coordinates;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 4) {
        throw new SatelliteGeometryError('Scene footprint has an incomplete ring.');
      }
      for (const position of ring) {
        const longitude = position[0];
        const latitude = position[1];
        if (
          longitude === undefined ||
          latitude === undefined ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude)
        ) {
          throw new SatelliteGeometryError(
            'Scene footprint contains an invalid coordinate.',
          );
        }
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }
    }
  }

  if (![west, south, east, north].every(Number.isFinite)) {
    throw new SatelliteGeometryError(
      'Scene footprint does not contain usable coordinates.',
    );
  }
  return [west, south, east, north];
}

export function satelliteSceneBoundsKey(scene: SatelliteScene): string {
  return satelliteSceneBounds(scene).join(',');
}
