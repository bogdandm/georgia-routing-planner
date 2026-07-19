import type { MultiPolygon, Polygon } from 'geojson';

import type { SatelliteProductLevel } from '@/domain/satellite/SatelliteSearchCriteria';

export type SatelliteVisualAsset =
  | {
      readonly kind: 'sentinel-rgb-cogs';
      readonly itemHref: string;
      readonly redHref: string;
      readonly greenHref: string;
      readonly blueHref: string;
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
