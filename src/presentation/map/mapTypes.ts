import type { MapCamera } from '@/application/ports/MapCameraRepository';

export type { MapCamera } from '@/application/ports/MapCameraRepository';

export type TerrainMode = 'flat' | 'terrain';

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

export interface MapDiagnosticsSnapshot {
  readonly lifecycle: MapLifecycleState;
  readonly camera: MapCamera;
  readonly terrainMode: TerrainMode;
  readonly styleId: string;
  readonly sourceIds: readonly string[];
  readonly layerIds: readonly string[];
  readonly lastIdleAt: string | null;
  readonly webGlContext: 'available' | 'lost' | 'restored' | 'unknown';
  readonly recoverableFailures: readonly MapSourceFailure[];
  readonly message: string | null;
}

export type TerrainTransitionResult =
  | { readonly status: 'success'; readonly mode: TerrainMode }
  | { readonly status: 'failed'; readonly reason: string };

export const defaultGeorgiaCamera: MapCamera = {
  longitude: 43.4,
  latitude: 42.1,
  zoom: 5.8,
  bearing: 0,
  pitch: 0,
};
