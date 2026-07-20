import type {
  ErrorEvent as MapLibreErrorEvent,
  Map as MapLibreMap,
  MapSourceDataEvent,
} from 'maplibre-gl';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { MapViewportSnapshot } from '@/application/ports/MapViewportProvider';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';
import type { MapFacade } from '@/presentation/map/MapFacade';
import { mapSourceIds } from '@/presentation/map/mapIds';
import { createTerrainDemSource } from '@/presentation/map/terrainOverlayStyle';
import type { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import {
  defaultGeorgiaCamera,
  type MapCamera,
  type MapDebugOptions,
  type MapDiagnosticsSnapshot,
  type MapFailureCategory,
  type MapSourceFailure,
  type MapWebGlCapabilities,
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
  webGlCapabilities: {
    contextType: 'unknown',
    version: null,
    maxTextureSize: null,
    antialias: null,
  },
  recoverableFailures: [],
  message: null,
};

interface MapProviderOptions {
  readonly terrain: MapProviderConfiguration['terrain'];
  readonly demTileUrl: string;
  readonly requestTimeoutMs: number;
  readonly equivalentErrorWindowMs: number;
}

interface FailureBucket {
  readonly failure: MapSourceFailure;
  readonly lastLoggedAtMs: number;
}

function getErrorSourceId(event: MapLibreErrorEvent): string | null {
  const sourceId = (event as unknown as { readonly sourceId?: unknown }).sourceId;
  return typeof sourceId === 'string' ? sourceId : null;
}

function isCanceledMapRequest(event: MapLibreErrorEvent): boolean {
  const error = event.error;
  const errorName =
    typeof (error as unknown as { readonly name?: unknown }).name === 'string'
      ? (error as unknown as { readonly name: string }).name
      : null;
  return (
    errorName === 'AbortError' ||
    /\b(?:abort(?:ed)?|cancel(?:ed|led)|superseded)\b/iu.test(error.message)
  );
}

function categorizeMapError(
  event: MapLibreErrorEvent,
  lifecycle: MapDiagnosticsSnapshot['lifecycle'],
): MapFailureCategory {
  const sourceId = getErrorSourceId(event);
  if (sourceId === mapSourceIds.terrainDem) return 'terrain';
  if (sourceId === mapSourceIds.basemapVector) return 'base-vector';

  const message = event.error.message.toLowerCase();
  if (message.includes('glyph') || message.includes('sprite')) return 'glyph-sprite';
  if (message.includes('style') || lifecycle === 'loading') return 'style';
  return 'unknown';
}

function recoverableMessage(category: MapFailureCategory): string {
  switch (category) {
    case 'base-vector':
      return 'Some basemap tiles could not load. You can keep using areas that are already visible.';
    case 'glyph-sprite':
      return 'Some map labels or icons could not load. Roads and terrain remain available.';
    case 'terrain':
      return '3D terrain is unavailable. The 2D basemap remains usable.';
    default:
      return 'Part of the map could not load. The available basemap remains usable.';
  }
}

/**
 * Owns the single native MapLibre instance, its listeners, terrain transitions, and
 * bounded diagnostic snapshot. React interacts only through the `MapFacade` contract.
 */
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
  readonly #failureBuckets = new Map<string, FailureBucket>();
  #mountedAt = 0;
  #lastCameraDiagnosticAt = 0;
  #styleSnapshotQueued = false;

  public constructor(
    private readonly logger: DiagnosticLogger,
    private readonly onCameraSettled: (camera: MapCamera) => void = () => undefined,
    private readonly provider?: MapProviderOptions,
    private readonly snapshotStore?: MapDiagnosticsSnapshotStore,
    private readonly layerController?: MapLibreLayerController,
  ) {
    this.snapshotStore?.update(this.#snapshot);
  }

  /** Attaches exactly one native map and transfers listener ownership from any prior map. */
  public attach(map: MapLibreMap): void {
    if (this.#map === map) {
      return;
    }
    this.detach();
    this.#map = map;
    this.layerController?.attach(map);
    map.on('load', this.handleLoad);
    map.on('styledata', this.handleStyleData);
    map.on('idle', this.handleIdle);
    map.on('moveend', this.handleMoveEnd);
    map.on('error', this.handleError);
    map.getCanvas().addEventListener('webglcontextlost', this.handleContextLost);
    map
      .getCanvas()
      .addEventListener('webglcontextrestored', this.handleContextRestored);
    this.#mountedAt = performance.now();
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

  public getViewportSnapshot(): MapViewportSnapshot | null {
    const map = this.#map;
    if (map === null) return null;

    const bounds = map.getBounds();
    const center = map.getCenter();
    return {
      bounds: {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      center: { longitude: center.lng, latitude: center.lat },
    };
  }

  public getDiagnosticsSnapshot(): MapDiagnosticsSnapshot {
    return this.#snapshot;
  }

  /** Serializes terrain transitions so sources, listeners, and camera changes cannot race. */
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

  /**
   * Releases only the current native map attachment. Subscribers remain registered so
   * React Strict Mode can replay the ref lifecycle and attach the same facade again.
   */
  public detachMap(): void {
    this.#cancelTerrainWait?.();
    this.detach();
  }

  public destroy(): void {
    this.detachMap();
    this.#listeners.clear();
  }

  private readonly handleLoad = (): void => {
    const map = this.#map;
    if (map === null) {
      return;
    }
    this.layerController?.attach(map);
    const style = map.getStyle();
    this.updateSnapshot({
      lifecycle:
        this.#snapshot.message === null ||
        this.#snapshot.recoverableFailures.length === 0
          ? 'ready'
          : 'degraded',
      camera: this.readCamera(map),
      styleId: style.name ?? initialSnapshot.styleId,
      sourceIds: Object.keys(style.sources),
      layerIds: style.layers.map((layer) => layer.id),
      webGlContext: 'available',
      webGlCapabilities: this.readWebGlCapabilities(map),
      message: this.#snapshot.message,
    });
    const durationMs = Math.max(0, performance.now() - this.#mountedAt);
    this.logger.log({
      level: 'info',
      name: 'map.lifecycle.loaded',
      data: { durationMs },
    });
    this.logger.log({
      level: 'info',
      name: 'map.style.ready',
      data: {
        count: style.layers.length,
        status: style.name ?? initialSnapshot.styleId,
      },
    });
  };

  private readonly handleStyleData = (): void => {
    const map = this.#map;
    if (map === null || this.#styleSnapshotQueued) return;
    this.#styleSnapshotQueued = true;
    queueMicrotask(() => {
      this.#styleSnapshotQueued = false;
      if (this.#map !== map) return;
      const style = map.getStyle();
      this.updateSnapshot({
        sourceIds: Object.keys(style.sources),
        layerIds: style.layers.map((layer) => layer.id),
      });
    });
  };

  private readonly handleIdle = (): void => {
    this.updateSnapshot({ lastIdleAt: new Date().toISOString() });
    if (!this.#firstIdleRecorded) {
      this.#firstIdleRecorded = true;
      this.logger.log({
        level: 'info',
        name: 'map.lifecycle.first-idle',
        data: { durationMs: Math.max(0, performance.now() - this.#mountedAt) },
      });
    }
  };

  private readonly handleMoveEnd = (): void => {
    if (this.#map !== null) {
      const camera = this.readCamera(this.#map);
      this.updateSnapshot({ camera });
      this.onCameraSettled(camera);
      const now = Date.now();
      if (now - this.#lastCameraDiagnosticAt >= 5_000) {
        this.#lastCameraDiagnosticAt = now;
        this.logger.log({
          level: 'debug',
          name: 'map.camera.settled',
          data: { cameraZoom: Math.round(camera.zoom * 10) / 10 },
        });
      }
    }
  };

  private readonly handleError = (event: MapLibreErrorEvent): void => {
    if (isCanceledMapRequest(event)) return;
    const category = categorizeMapError(event, this.#snapshot.lifecycle);
    const sourceId = getErrorSourceId(event);
    if (category !== 'style') {
      this.recordRecoverableFailure(category, sourceId);
      this.updateSnapshot({
        lifecycle: 'degraded',
        ...(category === 'terrain' ? { terrainMode: 'flat' as const } : {}),
        message: recoverableMessage(category),
      });
      return;
    }

    const message =
      'The map style could not be loaded. Check the provider configuration or open developer diagnostics.';
    this.updateSnapshot({ lifecycle: 'fatal', message });
    this.logger.log({
      level: 'error',
      name: 'map.style.failed',
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
      ...(this.#map === null
        ? {}
        : { webGlCapabilities: this.readWebGlCapabilities(this.#map) }),
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

  private readWebGlCapabilities(map: MapLibreMap): MapWebGlCapabilities {
    if (typeof WebGLRenderingContext === 'undefined') {
      return {
        contextType: 'unknown',
        version: null,
        maxTextureSize: null,
        antialias: null,
      };
    }

    try {
      const canvas = map.getCanvas();
      const webGl2 = canvas.getContext('webgl2');
      const context = webGl2 ?? canvas.getContext('webgl');
      if (context === null) {
        return {
          contextType: 'unavailable',
          version: null,
          maxTextureSize: null,
          antialias: null,
        };
      }
      const version = context.getParameter(context.VERSION) as unknown;
      const maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE) as unknown;
      return {
        contextType: webGl2 === null ? 'webgl' : 'webgl2',
        version: typeof version === 'string' ? version : null,
        maxTextureSize: typeof maxTextureSize === 'number' ? maxTextureSize : null,
        antialias: context.getContextAttributes()?.antialias ?? null,
      };
    } catch {
      return {
        contextType: 'unknown',
        version: null,
        maxTextureSize: null,
        antialias: null,
      };
    }
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

    const provider = this.provider;
    if (provider === undefined) {
      return { status: 'failed', reason: 'Terrain configuration is unavailable.' };
    }

    const camera = this.readCamera(map);
    const pitch = camera.pitch > 0 ? camera.pitch : this.#lastTerrainPitch;
    try {
      if (map.getSource(mapSourceIds.terrainDem) === undefined) {
        map.addSource(
          mapSourceIds.terrainDem,
          createTerrainDemSource(provider.terrain, provider.demTileUrl),
        );
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

  private recordRecoverableFailure(
    category: MapFailureCategory,
    sourceId: string | null,
  ): void {
    const now = Date.now();
    const key = `${category}:${sourceId ?? 'none'}`;
    const previous = this.#failureBuckets.get(key);
    const failure: MapSourceFailure = {
      category,
      sourceId,
      count: Math.min(9_999, (previous?.failure.count ?? 0) + 1),
      lastOccurredAt: new Date(now).toISOString(),
    };
    const windowMs = this.provider?.equivalentErrorWindowMs ?? 10_000;
    const shouldLog =
      previous === undefined || now - previous.lastLoggedAtMs >= windowMs;

    if (previous === undefined && this.#failureBuckets.size >= 8) {
      // Bound cardinality as well as event count; arbitrary provider errors cannot grow memory.
      const oldestKey = this.#failureBuckets.keys().next().value;
      if (oldestKey !== undefined) this.#failureBuckets.delete(oldestKey);
    }
    this.#failureBuckets.set(key, {
      failure,
      lastLoggedAtMs:
        previous === undefined || shouldLog ? now : previous.lastLoggedAtMs,
    });
    this.updateSnapshot({
      recoverableFailures: [...this.#failureBuckets.values()].map(
        (bucket) => bucket.failure,
      ),
    });

    if (shouldLog) {
      this.logger.log({
        level: 'warn',
        name: 'map.source.failed',
        data: {
          category,
          count: failure.count,
          ...(sourceId === null ? {} : { sourceId }),
        },
      });
    }
  }

  private updateSnapshot(changed: Partial<MapDiagnosticsSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...changed };
    this.snapshotStore?.update(this.#snapshot);
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
    map.off('styledata', this.handleStyleData);
    map.off('idle', this.handleIdle);
    map.off('moveend', this.handleMoveEnd);
    map.off('error', this.handleError);
    map.getCanvas().removeEventListener('webglcontextlost', this.handleContextLost);
    map
      .getCanvas()
      .removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.layerController?.detach(map);
    this.#map = null;
    this.logger.log({ level: 'debug', name: 'map.lifecycle.unmounted' });
  }
}
