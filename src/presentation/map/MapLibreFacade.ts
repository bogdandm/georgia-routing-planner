import type {
  ErrorEvent as MapLibreErrorEvent,
  Map as MapLibreMap,
  MapSourceDataEvent,
} from 'maplibre-gl';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type { MapFacade } from '@/presentation/map/MapFacade';
import { mapSourceIds } from '@/presentation/map/mapIds';
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
  styleId: 'Georgia hiking basemap v1',
  sourceIds: [],
  layerIds: ['background'],
  lastIdleAt: null,
  webGlContext: 'unknown',
  message: null,
};

interface TerrainProviderOptions {
  readonly terrain: MapProviderConfiguration['terrain'];
  readonly requestTimeoutMs: number;
}

function getErrorSourceId(event: MapLibreErrorEvent): string | null {
  const sourceId = (event as unknown as { readonly sourceId?: unknown }).sourceId;
  return typeof sourceId === 'string' ? sourceId : null;
}

export class MapLibreFacade implements MapFacade {
  readonly #listeners = new Set<() => void>();
  #map: MapLibreMap | null = null;
  #snapshot: MapDiagnosticsSnapshot = initialSnapshot;
  #firstIdleRecorded = false;
  #lastTerrainPitch = 45;
  #terrainTransition: {
    readonly mode: TerrainMode;
    readonly promise: Promise<TerrainTransitionResult>;
  } | null = null;
  #cancelTerrainWait: (() => void) | null = null;

  public constructor(
    private readonly logger: DiagnosticLogger,
    private readonly onCameraSettled: (camera: MapCamera) => void = () => undefined,
    private readonly terrainProvider?: TerrainProviderOptions,
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
    const transition = this.#terrainTransition;
    if (transition !== null) {
      if (transition.mode === mode) {
        return transition.promise;
      }
      return Promise.resolve({
        status: 'failed',
        reason: 'Another terrain transition is already in progress.',
      });
    }

    if (this.#snapshot.terrainMode === mode) {
      return Promise.resolve({ status: 'success', mode });
    }

    const promise = this.transitionTerrain(mode).finally(() => {
      this.#terrainTransition = null;
    });
    this.#terrainTransition = { mode, promise };
    return promise;
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
    this.#cancelTerrainWait?.();
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
    const sourceId = getErrorSourceId(event);
    if (sourceId === mapSourceIds.terrainDem) {
      this.updateSnapshot({
        lifecycle: 'degraded',
        terrainMode: 'flat',
        message: '3D terrain is unavailable. The 2D basemap remains usable.',
      });
      this.logger.log({
        level: 'warn',
        name: 'map.source.failed',
        data: { category: 'terrain', sourceId },
      });
      return;
    }

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

  private async transitionTerrain(mode: TerrainMode): Promise<TerrainTransitionResult> {
    const map = this.#map;
    if (map === null) {
      return { status: 'failed', reason: 'The map is not ready yet.' };
    }

    if (mode === 'flat') {
      const camera = this.readCamera(map);
      if (camera.pitch > 0) {
        this.#lastTerrainPitch = camera.pitch;
      }
      map.setTerrain(null);
      map.easeTo({
        center: [camera.longitude, camera.latitude],
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: 0,
        duration: 250,
      });
      this.updateSnapshot({
        lifecycle: 'ready',
        terrainMode: 'flat',
        camera: { ...camera, pitch: 0 },
        message: null,
      });
      this.logger.log({ level: 'info', name: 'map.terrain.disabled' });
      return { status: 'success', mode };
    }

    const provider = this.terrainProvider;
    if (provider === undefined) {
      return { status: 'failed', reason: 'Terrain configuration is unavailable.' };
    }

    const camera = this.readCamera(map);
    const pitch = camera.pitch > 0 ? camera.pitch : this.#lastTerrainPitch;
    try {
      if (map.getSource(mapSourceIds.terrainDem) === undefined) {
        map.addSource(mapSourceIds.terrainDem, {
          type: 'raster-dem',
          tiles: [provider.terrain.tileUrl],
          encoding: provider.terrain.encoding,
          tileSize: provider.terrain.tileSize,
          minzoom: provider.terrain.minZoom,
          maxzoom: provider.terrain.maxZoom,
          attribution: provider.terrain.attribution,
        });
      }
      map.setTerrain({
        source: mapSourceIds.terrainDem,
        exaggeration: provider.terrain.exaggeration,
      });
      map.easeTo({
        center: [camera.longitude, camera.latitude],
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch,
        duration: 250,
      });
      await this.waitForTerrainSource(map, provider.requestTimeoutMs);
      this.updateSnapshot({
        lifecycle: 'ready',
        terrainMode: 'terrain',
        camera: { ...camera, pitch },
        sourceIds: Object.keys(map.getStyle().sources),
        message: null,
      });
      this.logger.log({ level: 'info', name: 'map.terrain.enabled' });
      return { status: 'success', mode };
    } catch {
      map.setTerrain(null);
      map.easeTo({
        center: [camera.longitude, camera.latitude],
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: 0,
        duration: 0,
      });
      this.updateSnapshot({
        lifecycle: 'degraded',
        terrainMode: 'flat',
        camera: { ...camera, pitch: 0 },
        sourceIds: Object.keys(map.getStyle().sources),
        message: '3D terrain is unavailable. The 2D basemap remains usable.',
      });
      this.logger.log({ level: 'warn', name: 'map.terrain.enable-failed' });
      return {
        status: 'failed',
        reason: 'Terrain data could not be loaded. Check the connection and try again.',
      };
    }
  }

  private waitForTerrainSource(map: MapLibreMap, timeoutMs: number): Promise<void> {
    if (map.isSourceLoaded(mapSourceIds.terrainDem)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        map.off('sourcedata', handleSourceData);
        map.off('error', handleSourceError);
        this.#cancelTerrainWait = null;
      };
      const handleSourceData = (event: MapSourceDataEvent) => {
        if (
          event.sourceId === mapSourceIds.terrainDem &&
          (event.isSourceLoaded || map.isSourceLoaded(mapSourceIds.terrainDem))
        ) {
          cleanup();
          resolve();
        }
      };
      const handleSourceError = (event: MapLibreErrorEvent) => {
        if (getErrorSourceId(event) === mapSourceIds.terrainDem) {
          cleanup();
          reject(new Error('Terrain source failed.'));
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Terrain source timed out.'));
      }, timeoutMs);
      this.#cancelTerrainWait = () => {
        cleanup();
        reject(new Error('Terrain transition was cancelled.'));
      };

      map.on('sourcedata', handleSourceData);
      map.on('error', handleSourceError);
    });
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
