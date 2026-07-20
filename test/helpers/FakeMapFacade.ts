import type { MapFacade } from '@/presentation/map/MapFacade';
import type { MapViewportSnapshot } from '@/application/ports/MapViewportProvider';
import {
  defaultGeorgiaCamera,
  type MapCamera,
  type MapDebugOptions,
  type MapDiagnosticsSnapshot,
  type TerrainMode,
  type TerrainTransitionResult,
} from '@/presentation/map/mapTypes';

export class FakeMapFacade implements MapFacade {
  readonly #listeners = new Set<() => void>();
  public destroyed = false;
  public debugOptions: MapDebugOptions | null = null;
  public terrainModeRequests: TerrainMode[] = [];
  public terrainTransition:
    ((mode: TerrainMode) => Promise<TerrainTransitionResult>) | null = null;
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

  public destroy(): void {
    this.destroyed = true;
    this.#listeners.clear();
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
