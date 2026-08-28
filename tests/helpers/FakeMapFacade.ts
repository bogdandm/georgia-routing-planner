import type { MapFacade } from '@/presentation/map/MapFacade';
import type { MapInteractionMode } from '@/presentation/map/MapFacade';
import {
  defaultGeorgiaCamera,
  type MapCoordinate,
  type MapCamera,
  type MapDebugOptions,
  type MapDiagnosticsSnapshot,
  type MapFitPadding,
  type MapPointInspection,
  type NearbyPoi,
  type MapViewportBounds,
  type MapViewportSnapshot,
  type TerrainMode,
  type TerrainTransitionResult,
} from '@/presentation/map/mapTypes';

export class FakeMapFacade implements MapFacade {
  readonly #listeners = new Set<() => void>();
  readonly #planningClickListeners = new Set<(coordinate: MapCoordinate) => void>();
  public destroyed = false;
  public debugOptions: MapDebugOptions | null = null;
  public terrainModeRequests: TerrainMode[] = [];
  public interactionModes: MapInteractionMode[] = [];
  public routePlanPreviewAnchors: (MapCoordinate | null)[] = [];
  public navigationRequests: {
    readonly longitude: number;
    readonly latitude: number;
    readonly zoom?: number;
  }[] = [];
  public navigationPaddingRequests: (MapFitPadding | undefined)[] = [];
  public fitBoundsRequests: {
    readonly bounds: MapViewportBounds;
    readonly maxZoom: number;
    readonly padding: MapFitPadding | undefined;
  }[] = [];
  public pointInspection: MapPointInspection = { status: 'closed' };
  public pointInspectionRequests: MapCoordinate[] = [];
  public nearestPoi: NearbyPoi | null = null;
  public terrainTransition:
    ((mode: TerrainMode) => Promise<TerrainTransitionResult>) | null = null;
  public cameraSettle: (() => Promise<void>) | null = null;
  public snapshot: MapDiagnosticsSnapshot = {
    lifecycle: 'loading',
    camera: defaultGeorgiaCamera,
    terrainMode: 'flat',
    styleId: 'test-style',
    sourceIds: [],
    layerIds: ['background'],
    lastIdleAt: null,
    webGlContext: 'unknown',
    webGlCapabilities: {
      contextType: 'unknown',
      version: null,
      maxTextureSize: null,
      antialias: null,
    },
    recoverableFailures: [],
    message: null,
  };

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  public subscribePlanningClicks(
    listener: (coordinate: MapCoordinate) => void,
  ): () => void {
    this.#planningClickListeners.add(listener);
    return () => {
      this.#planningClickListeners.delete(listener);
    };
  }

  public emitPlanningClick(coordinate: MapCoordinate): void {
    for (const listener of this.#planningClickListeners) listener(coordinate);
  }

  public getCamera(): MapCamera {
    return this.snapshot.camera;
  }

  public getViewportSnapshot(): MapViewportSnapshot {
    return {
      bounds: { west: 42.8, south: 41.6, east: 44, north: 42.6 },
      center: {
        longitude: this.snapshot.camera.longitude,
        latitude: this.snapshot.camera.latitude,
      },
    };
  }

  public getDiagnosticsSnapshot(): MapDiagnosticsSnapshot {
    return this.snapshot;
  }

  public getPointInspection(): MapPointInspection {
    return this.pointInspection;
  }

  public getNearestPoi(_coordinate: MapCoordinate): NearbyPoi | null {
    return this.nearestPoi;
  }

  public openPointInspection(coordinate: MapCoordinate): void {
    const inspectionCoordinate = { ...coordinate };
    this.pointInspectionRequests.push(inspectionCoordinate);
    this.pointInspection = {
      status: 'open',
      coordinate: inspectionCoordinate,
      elevation: { status: 'loading' },
      nearbyPoi: { status: 'loading' },
    };
    this.notify();
  }

  public waitForCameraSettled(): Promise<void> {
    return this.cameraSettle?.() ?? Promise.resolve();
  }

  public closePointInspection(): void {
    this.pointInspection = { status: 'closed' };
    this.notify();
  }

  public setPointInspection(inspection: MapPointInspection): void {
    this.pointInspection = inspection;
    this.notify();
  }

  public navigateTo(
    target: {
      readonly longitude: number;
      readonly latitude: number;
      readonly zoom?: number;
    },
    visibleAreaPadding?: MapFitPadding,
  ): void {
    this.navigationRequests.push(target);
    this.navigationPaddingRequests.push(visibleAreaPadding);
  }

  public fitBounds(
    bounds: MapViewportBounds,
    maxZoom: number,
    padding?: MapFitPadding,
  ): void {
    this.fitBoundsRequests.push({ bounds, maxZoom, padding });
  }

  public setTerrainMode(mode: TerrainMode): Promise<TerrainTransitionResult> {
    this.terrainModeRequests.push(mode);
    if (this.terrainTransition !== null) {
      return this.terrainTransition(mode);
    }
    this.setSnapshot({ terrainMode: mode });
    return Promise.resolve({ status: 'success', mode });
  }

  public setDebugOptions(options: MapDebugOptions): void {
    this.debugOptions = options;
  }

  public setInteractionMode(mode: MapInteractionMode): void {
    this.interactionModes.push(mode);
  }

  public setRoutePlanPreviewAnchor(coordinate: MapCoordinate | null): void {
    this.routePlanPreviewAnchors.push(coordinate);
  }

  public destroy(): void {
    this.destroyed = true;
    this.#listeners.clear();
    this.#planningClickListeners.clear();
  }

  public setSnapshot(changed: Partial<MapDiagnosticsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changed };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
