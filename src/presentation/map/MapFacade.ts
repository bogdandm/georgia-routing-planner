import type {
  MapCamera,
  MapDebugOptions,
  MapDiagnosticsSnapshot,
  TerrainMode,
  TerrainTransitionResult,
} from '@/presentation/map/mapTypes';
import type { MapViewportProvider } from '@/application/ports/MapViewportProvider';

/**
 * Capability boundary between declarative React UI and MapLibre's imperative native
 * object. Consumers observe serializable snapshots and never receive the native map.
 */
export interface MapFacade extends MapViewportProvider {
  subscribe(listener: () => void): () => void;
  getCamera(): MapCamera;
  getDiagnosticsSnapshot(): MapDiagnosticsSnapshot;
  retryRecoverableFailures(): void;

  /** Resolves after the requested terrain source is usable or flat fallback is restored. */
  setTerrainMode(mode: TerrainMode): Promise<TerrainTransitionResult>;
  setDebugOptions(options: MapDebugOptions): void;

  /** Cancels pending transitions and removes every native listener owned by the facade. */
  destroy(): void;
}
