import type {
  MapCamera,
  MapDebugOptions,
  MapDiagnosticsSnapshot,
  TerrainMode,
  TerrainTransitionResult,
} from '@/presentation/map/mapTypes';

export interface MapFacade {
  subscribe(listener: () => void): () => void;
  getCamera(): MapCamera;
  getDiagnosticsSnapshot(): MapDiagnosticsSnapshot;
  retryRecoverableFailures(): void;
  setTerrainMode(mode: TerrainMode): Promise<TerrainTransitionResult>;
  setDebugOptions(options: MapDebugOptions): void;
  destroy(): void;
}
