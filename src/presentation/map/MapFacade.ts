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

export type MapInteractionMode =
  | 'default'
  | 'marker-placement'
  | 'route-planning'
  | 'measurement'
  | 'weather-point-selection';

export type MapViewportMovement =
  | { readonly phase: 'moving' }
  | { readonly phase: 'settled'; readonly viewport: MapViewportSnapshot };

/**
 * Capability boundary between declarative React UI and MapLibre's imperative native
 * object. Consumers observe serializable snapshots and never receive the native map.
 */
export interface MapFacade {
  subscribe(listener: () => void): () => void;
  /** Replays the current settled viewport when the map has already emitted its initial settle. */
  subscribeViewportMovement(listener: (event: MapViewportMovement) => void): () => void;
  /** Primary clicks while route planning or measuring; other modes never publish them. */
  subscribePlanningClicks(listener: (coordinate: MapCoordinate) => void): () => void;
  getCamera(): MapCamera;
  getDiagnosticsSnapshot(): MapDiagnosticsSnapshot;
  getViewportSnapshot(): MapViewportSnapshot | null;
  getPointInspection(): MapPointInspection;
  /** Popup-owned host element; React renders the open inspection's content into it. */
  getPointInspectionContent(): HTMLElement;
  /** Touch layouts disable the anchored popup and show the inspection in a sheet. */
  setPointInspectionPopupEnabled(enabled: boolean): void;
  getNearestPoi(coordinate: MapCoordinate): NearbyPoi | null;
  openPointInspection(
    coordinate: MapCoordinate,
    options?: { readonly refreshNearbyPoiOnIdle?: boolean },
  ): void;
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
  /** Last accepted route-plan or ruler point; the cursor preview line starts there. */
  setPlanningPreviewAnchor(coordinate: MapCoordinate | null): void;

  /** Cancels pending transitions and removes every native listener owned by the facade. */
  destroy(): void;
}
