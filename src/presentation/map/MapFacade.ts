import type {
  MapCamera,
  MapDebugOptions,
  MapFitPadding,
  MapDiagnosticsSnapshot,
  MapCoordinate,
  MapPointInspection,
  NearbyPoi,
  MapViewportBounds,
  MapViewportSnapshot,
  TerrainMode,
  TerrainTransitionResult,
} from '@/presentation/map/mapTypes';

export type MapInteractionMode = 'default' | 'marker-placement' | 'route-planning';

/**
 * Capability boundary between declarative React UI and MapLibre's imperative native
 * object. Consumers observe serializable snapshots and never receive the native map.
 */
export interface MapFacade {
  subscribe(listener: () => void): () => void;
  subscribePlanningClicks(listener: (coordinate: MapCoordinate) => void): () => void;
  getCamera(): MapCamera;
  getDiagnosticsSnapshot(): MapDiagnosticsSnapshot;
  getViewportSnapshot(): MapViewportSnapshot | null;
  getPointInspection(): MapPointInspection;
  getNearestPoi(coordinate: MapCoordinate): NearbyPoi | null;
  closePointInspection(): void;

  /** Moves the native camera without exposing MapLibre to callers. */
  navigateTo(
    target: {
      readonly longitude: number;
      readonly latitude: number;
      readonly zoom?: number;
    },
    visibleAreaPadding?: MapFitPadding,
  ): void;

  /** Fits a serializable geographic area without exposing native MapLibre bounds. */
  fitBounds(bounds: MapViewportBounds, maxZoom: number, padding?: MapFitPadding): void;

  /** Resolves after the requested terrain source is usable or flat fallback is restored. */
  setTerrainMode(mode: TerrainMode): Promise<TerrainTransitionResult>;
  setDebugOptions(options: MapDebugOptions): void;
  setInteractionMode(mode: MapInteractionMode): void;
  setRoutePlanPreviewAnchor(coordinate: MapCoordinate | null): void;

  /** Cancels pending transitions and removes every native listener owned by the facade. */
  destroy(): void;
}
