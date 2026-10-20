import type {
  MapCamera,
  MapDebugOptions,
  MapFitPadding,
  MapDiagnosticsSnapshot,
  MapCoordinate,
  MapPointInspection,
  NearbyPoi,
  MapTravelPath,
  MapViewportBounds,
  MapViewportSnapshot,
  TerrainMode,
  TerrainTransitionResult,
} from '@/presentation/map/mapTypes';
import type {
  RenderBenchmarkReport,
  RenderBenchmarkStep,
} from '@/presentation/map/renderBenchmark';

export type MapInteractionMode =
  | 'default'
  | 'marker-placement'
  | 'route-planning'
  | 'measurement'
  | 'weather-point-selection';

export type MapViewportMovement =
  | { readonly phase: 'moving' }
  | { readonly phase: 'settled'; readonly viewport: MapViewportSnapshot };

/** Cursor preview that starts at the last accepted route-plan or ruler point. */
export interface PlanningPreview {
  readonly anchor: MapCoordinate;
  /** Ruler only: its first point and the straight-line distance measured up to `anchor`. */
  readonly measurement?: {
    readonly origin: MapCoordinate;
    readonly distanceMeters: number;
  };
}

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
  /**
   * Reserves a bottom overlay (the touch sheet) of `bottomInsetPx` as camera padding
   * until the inspection closes, without moving the view, so later camera moves land
   * above it. A tapped point already on screen but under the overlay is panned above it.
   */
  revealPointInspection(bottomInsetPx: number): void;
  /**
   * Touch layouts disable the cursor-following planning preview; the ruler then labels
   * its total at the last point.
   */
  setCursorPreviewEnabled(enabled: boolean): void;
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
      /** Keeps `zoom` in 3D instead of the terrain close-up zoom. */
      readonly exactZoom?: boolean;
    },
    visibleAreaPadding?: MapFitPadding,
  ): void;

  /**
   * Fits a serializable geographic area without exposing native MapLibre bounds. With a
   * travel path in 3D, the camera faces along it at a fixed pitch and keeps its points
   * in view at their elevations.
   */
  fitBounds(
    bounds: MapViewportBounds,
    maxZoom: number,
    padding?: MapFitPadding,
    path?: MapTravelPath,
  ): void;

  /** Resolves after the requested terrain source is usable or flat fallback is restored. */
  setTerrainMode(mode: TerrainMode): Promise<TerrainTransitionResult>;
  /**
   * Developer benchmark in 3D at a fixed scene; restores the user's mode and camera.
   * `signal` stops the run, and so does detaching the map.
   */
  runRenderBenchmark(
    onStep: (step: RenderBenchmarkStep) => void,
    signal: AbortSignal,
  ): Promise<RenderBenchmarkReport>;
  setDebugOptions(options: MapDebugOptions): void;
  setInteractionMode(mode: MapInteractionMode): void;
  setPlanningPreview(preview: PlanningPreview | null): void;

  /** Cancels pending transitions and removes every native listener owned by the facade. */
  destroy(): void;
}
