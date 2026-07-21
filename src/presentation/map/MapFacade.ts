import type {
  MapCamera,
  MapDebugOptions,
  MapDiagnosticsSnapshot,
  MapPointInspection,
  MapViewportBounds,
  MapViewportSnapshot,
  TerrainMode,
  TerrainTransitionResult,
} from '@/presentation/map/mapTypes';

/**
 * Capability boundary between declarative React UI and MapLibre's imperative native
 * object. Consumers observe serializable snapshots and never receive the native map.
 */
export interface MapFacade {
  subscribe(listener: () => void): () => void;
  getCamera(): MapCamera;
  getDiagnosticsSnapshot(): MapDiagnosticsSnapshot;
  getViewportSnapshot(): MapViewportSnapshot | null;
  getPointInspection(): MapPointInspection;
  closePointInspection(): void;

  /** Moves the native camera without exposing MapLibre to callers. */
  navigateTo(target: {
    readonly longitude: number;
    readonly latitude: number;
    readonly zoom?: number;
  }): void;

  /** Fits a serializable geographic area without exposing native MapLibre bounds. */
  fitBounds(bounds: MapViewportBounds, maxZoom: number): void;

  /** Resolves after the requested terrain source is usable or flat fallback is restored. */
  setTerrainMode(mode: TerrainMode): Promise<TerrainTransitionResult>;
  setDebugOptions(options: MapDebugOptions): void;

  /** Cancels pending transitions and removes every native listener owned by the facade. */
  destroy(): void;
}
