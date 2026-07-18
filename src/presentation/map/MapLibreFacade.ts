import type { ErrorEvent as MapLibreErrorEvent, Map as MapLibreMap } from 'maplibre-gl';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { MapFacade } from '@/presentation/map/MapFacade';
import {
  defaultGeorgiaCamera,
  type MapCamera,
  type MapDebugOptions,
  type MapDiagnosticsSnapshot,
  type TerrainMode,
  type TerrainTransitionResult,
} from '@/presentation/map/mapTypes';

const initialSnapshot: MapDiagnosticsSnapshot = {
  lifecycle: 'loading',
  camera: defaultGeorgiaCamera,
  terrainMode: 'flat',
  styleId: 'phase-0-network-free',
  sourceIds: [],
  layerIds: ['background'],
  lastIdleAt: null,
  webGlContext: 'unknown',
  message: null,
};

export class MapLibreFacade implements MapFacade {
  readonly #listeners = new Set<() => void>();
  #map: MapLibreMap | null = null;
  #snapshot: MapDiagnosticsSnapshot = initialSnapshot;
  #firstIdleRecorded = false;

  public constructor(
    private readonly logger: DiagnosticLogger,
    private readonly onCameraSettled: (camera: MapCamera) => void = () => undefined,
  ) {}

  public attach(map: MapLibreMap): void {
    if (this.#map === map) {
      return;
    }
    this.detach();
    this.#map = map;
    map.on('load', this.handleLoad);
    map.on('idle', this.handleIdle);
    map.on('moveend', this.handleMoveEnd);
    map.on('error', this.handleError);
    map.getCanvas().addEventListener('webglcontextlost', this.handleContextLost);
    map
      .getCanvas()
      .addEventListener('webglcontextrestored', this.handleContextRestored);
    this.logger.log({ level: 'info', name: 'map.lifecycle.mounted' });

    if (map.loaded()) {
      this.handleLoad();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public getCamera(): MapCamera {
    return this.#snapshot.camera;
  }

  public getDiagnosticsSnapshot(): MapDiagnosticsSnapshot {
    return this.#snapshot;
  }

  public setTerrainMode(mode: TerrainMode): Promise<TerrainTransitionResult> {
    if (mode === 'flat') {
      return Promise.resolve({ status: 'success', mode });
    }
    return Promise.resolve({
      status: 'failed' as const,
      reason: 'Terrain configuration is not available in the lifecycle scaffold.',
    });
  }

  public setDebugOptions(options: MapDebugOptions): void {
    const map = this.#map;
    if (map === null) {
      return;
    }
    map.showTileBoundaries = options.showTileBoundaries;
    map.showCollisionBoxes = options.showCollisionBoxes;
  }

  public destroy(): void {
    this.detach();
    this.#listeners.clear();
  }

  private readonly handleLoad = (): void => {
    const map = this.#map;
    if (map === null) {
      return;
    }
    const style = map.getStyle();
    this.updateSnapshot({
      lifecycle: 'ready',
      camera: this.readCamera(map),
      styleId: style.name ?? initialSnapshot.styleId,
      sourceIds: Object.keys(style.sources),
      layerIds: style.layers.map((layer) => layer.id),
      webGlContext: 'available',
      message: null,
    });
    this.logger.log({ level: 'info', name: 'map.lifecycle.loaded' });
  };

  private readonly handleIdle = (): void => {
    this.updateSnapshot({ lastIdleAt: new Date().toISOString() });
    if (!this.#firstIdleRecorded) {
      this.#firstIdleRecorded = true;
      this.logger.log({ level: 'info', name: 'map.lifecycle.first-idle' });
    }
  };

  private readonly handleMoveEnd = (): void => {
    if (this.#map !== null) {
      const camera = this.readCamera(this.#map);
      this.updateSnapshot({ camera });
      this.onCameraSettled(camera);
    }
  };

  private readonly handleError = (event: MapLibreErrorEvent): void => {
    const message = 'MapLibre could not initialize the map workspace.';
    this.updateSnapshot({ lifecycle: 'fatal', message });
    this.logger.log({
      level: 'error',
      name: 'map.lifecycle.failed',
      message: event.error.message,
    });
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.updateSnapshot({
      lifecycle: 'fatal',
      webGlContext: 'lost',
      message: 'The browser lost the WebGL context.',
    });
    this.logger.log({ level: 'error', name: 'map.webgl.context-lost' });
  };

  private readonly handleContextRestored = (): void => {
    this.updateSnapshot({
      lifecycle: 'ready',
      webGlContext: 'restored',
      message: null,
    });
    this.logger.log({ level: 'info', name: 'map.webgl.context-restored' });
  };

  private readCamera(map: MapLibreMap): MapCamera {
    const center = map.getCenter();
    return {
      longitude: center.lng,
      latitude: center.lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
  }

  private updateSnapshot(changed: Partial<MapDiagnosticsSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...changed };
    for (const listener of this.#listeners) {
      listener();
    }
  }

  private detach(): void {
    const map = this.#map;
    if (map === null) {
      return;
    }
    map.off('load', this.handleLoad);
    map.off('idle', this.handleIdle);
    map.off('moveend', this.handleMoveEnd);
    map.off('error', this.handleError);
    map.getCanvas().removeEventListener('webglcontextlost', this.handleContextLost);
    map
      .getCanvas()
      .removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.#map = null;
    this.logger.log({ level: 'debug', name: 'map.lifecycle.unmounted' });
  }
}
