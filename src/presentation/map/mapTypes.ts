import type { MapCamera } from '@/application/ports/MapCameraRepository';

export type { MapCamera } from '@/application/ports/MapCameraRepository';

export type TerrainMode = 'flat' | 'terrain';

export interface MapDebugOptions {
  readonly showCollisionBoxes: boolean;
  readonly showTileBoundaries: boolean;
}

export type MapLifecycleState = 'loading' | 'ready' | 'degraded' | 'fatal';

export type MapFailureCategory =
  | 'base-vector'
  | 'glyph-sprite'
  | 'satellite-raster'
  | 'terrain'
  | 'style'
  | 'webgl'
  | 'unknown';

export type MapFailureReason =
  'http-client' | 'http-server' | 'network' | 'rate-limit' | 'timeout' | 'unknown';

export type MapRecoveryState =
  'exhausted' | 'not-applicable' | 'not-retryable' | 'recovered' | 'scheduled';

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
