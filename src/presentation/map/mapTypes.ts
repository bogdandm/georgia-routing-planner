import type { MapCamera, MapViewMode } from '@/application/ports/MapCameraRepository';

export type { MapCamera } from '@/application/ports/MapCameraRepository';

export type TerrainMode = MapViewMode;

export interface MapCoordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export interface NearbyPoi {
  readonly name: string | null;
  readonly category: string;
  readonly distanceMeters: number;
}

export type PointElevationState =
  | { readonly status: 'loading' }
  | { readonly status: 'available'; readonly meters: number }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error' };

export type NearbyPoiState =
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
}

export type MapLifecycleState = 'loading' | 'ready' | 'degraded' | 'fatal';

export type MapFailureCategory =
  'base-vector' | 'glyph-sprite' | 'terrain' | 'style' | 'webgl' | 'unknown';

export interface MapSourceFailure {
  readonly category: MapFailureCategory;
  readonly sourceId: string | null;
  readonly count: number;
  readonly lastOccurredAt: string;
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
