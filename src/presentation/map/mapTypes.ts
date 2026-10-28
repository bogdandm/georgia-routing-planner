import type { MapCamera, MapViewMode } from '@/application/ports/MapCameraRepository';

export type { MapCamera } from '@/application/ports/MapCameraRepository';

export type TerrainMode = MapViewMode;

export type MapLayerPreset =
  | 'vector-osm'
  | 'google-satellite'
  | 'bing-satellite'
  | 'esri-satellite'
  | 'napr-orthophoto'
  | 'soviet-topographic'
  | 'sentinel-2';

/** Basemap order shared by the layer chooser and the digit keyboard shortcuts. */
export const basemapPresets = [
  'vector-osm',
  'google-satellite',
  'bing-satellite',
  'esri-satellite',
  'napr-orthophoto',
  'soviet-topographic',
] as const satisfies readonly MapLayerPreset[];

export type BasemapPreset = (typeof basemapPresets)[number];

/** One keyboard camera step: pan 100 px, zoom one level, rotate 15°, or pitch 10°. */
export type MapCameraStep =
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'pan-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'rotate-left'
  | 'rotate-right'
  | 'pitch-up'
  | 'pitch-down';

export interface MapCoordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export interface MapViewportBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface MapFitPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Track geometry for a 3D fit: the camera turns so `from` sits at the bottom of the
 * screen and `to` toward the top, then keeps every point in view at their elevations.
 * Flat maps ignore it and fit the bounds in their current orientation.
 */
export interface MapTravelPath {
  readonly from: MapCoordinate;
  readonly to: MapCoordinate;
  readonly points: readonly MapPathPoint[];
}

export interface MapPathPoint extends MapCoordinate {
  readonly elevationMeters?: number;
}

export interface MapViewportSnapshot {
  readonly bounds: MapViewportBounds;
  readonly center: MapCoordinate;
}

export interface NearbyPoi {
  readonly name: string | null;
  /** Provider category token; `null` when the source feature has no category. */
  readonly category: string | null;
  readonly distanceMeters: number;
}

type PointElevationState =
  | { readonly status: 'loading' }
  | { readonly status: 'available'; readonly meters: number }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error' };

type NearbyPoiState =
  | { readonly status: 'loading' }
  | { readonly status: 'found'; readonly poi: NearbyPoi }
  | { readonly status: 'none' }
  | { readonly status: 'error' };

export type MapPointInspection =
  | { readonly status: 'closed' }
  | {
      readonly status: 'open';
      readonly coordinate: MapCoordinate;
      readonly elevation: PointElevationState;
      readonly nearbyPoi: NearbyPoiState;
    };

export interface MapDebugOptions {
  readonly showCollisionBoxes: boolean;
  readonly showTileBoundaries: boolean;
  /** Draws the arcs explored by the route search; the map facade ignores it. */
  readonly showRouteSearch: boolean;
}

type MapLifecycleState = 'loading' | 'ready' | 'degraded' | 'fatal';

export type MapFailureCategory =
  | 'base-vector'
  | 'glyph-sprite'
  | 'satellite-raster'
  | 'terrain'
  | 'style'
  | 'webgl'
  | 'unknown';

export type MapFailureReason =
  | 'http-client'
  | 'http-server'
  | 'network'
  | 'no-response'
  | 'rate-limit'
  | 'timeout'
  | 'unknown';

export type MapRecoveryState =
  | 'alternative-provider'
  | 'exhausted'
  | 'not-applicable'
  | 'not-retryable'
  | 'recovered'
  | 'scheduled';

export interface MapSourceFailure {
  readonly category: MapFailureCategory;
  readonly sourceId: string | null;
  readonly reason: MapFailureReason;
  readonly httpStatus: number | null;
  readonly count: number;
  readonly lastOccurredAt: string;
  readonly recoveryState: MapRecoveryState;
  readonly retryAttempt: number;
}

export interface MapWebGlCapabilities {
  readonly contextType: 'webgl2' | 'webgl' | 'unavailable' | 'unknown';
  readonly version: string | null;
  readonly maxTextureSize: number | null;
  readonly antialias: boolean | null;
}

/** Serializable map state shared with React and diagnostics; it contains no native objects. */
export interface MapDiagnosticsSnapshot {
  readonly lifecycle: MapLifecycleState;
  readonly camera: MapCamera;
  readonly terrainMode: TerrainMode;
  readonly styleId: string;
  readonly sourceIds: readonly string[];
  readonly layerIds: readonly string[];
  readonly lastIdleAt: string | null;
  readonly webGlContext: 'available' | 'lost' | 'restored' | 'unknown';
  readonly webGlCapabilities: MapWebGlCapabilities;
  readonly recoverableFailures: readonly MapSourceFailure[];
  readonly message: string | null;
}

export type TerrainTransitionResult =
  | { readonly status: 'success'; readonly mode: TerrainMode }
  | { readonly status: 'failed'; readonly reason: string };

/** Overview used when no valid persisted camera can be restored. */
export const defaultGeorgiaCamera: MapCamera = {
  longitude: 43.4,
  latitude: 42.1,
  zoom: 5.8,
  bearing: 0,
  pitch: 0,
};
