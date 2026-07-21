import type {
  ErrorEvent as MapLibreErrorEvent,
  Map as MapLibreMap,
  MapMouseEvent,
  MapSourceDataEvent,
} from 'maplibre-gl';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { ElevationProvider } from '@/application/ports/ElevationProvider';
import type { MapViewState } from '@/application/ports/MapCameraRepository';
import type {
  MapViewportBounds,
  MapViewportSnapshot,
} from '@/application/ports/MapViewportProvider';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';
import type { MapFacade } from '@/presentation/map/MapFacade';
import { mapSourceIds } from '@/presentation/map/mapIds';
import { createTerrainDemSource } from '@/presentation/map/terrainOverlayStyle';
import type { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import { mapFailureDetails } from '@/presentation/map/mapFailureDetails';
import { MiddleMouseCameraControl } from '@/presentation/map/MiddleMouseCameraControl';
import {
  MapLibrePointInspector,
  type PointInspectorPopup,
} from '@/presentation/map/MapLibrePointInspector';
import { selectNearestPoi } from '@/presentation/map/selectNearestPoi';
import {
  defaultGeorgiaCamera,
  type MapCamera,
  type MapDebugOptions,
  type MapDiagnosticsSnapshot,
  type MapFailureCategory,
  type MapPointInspection,
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
  readonly sourceLayers?: Pick<
    MapProviderConfiguration['vector']['sourceLayers'],
    'peaks' | 'pois'
  >;
  readonly demTileUrl: string;
  readonly requestTimeoutMs: number;
  readonly equivalentErrorWindowMs: number;
}

interface FailureBucket {
  readonly failure: MapSourceFailure;
  readonly lastLoggedAtMs: number;
}

type MapLayerControllerLifecycle = Pick<
  MapLibreLayerController,
  | 'attach'
  | 'detach'
  | 'handleRasterSourceData'
  | 'handleRasterSourceFailure'
  | 'handleRasterSourceRecovered'
  | 'isRasterSourceRecoveryComplete'
  | 'setTerrainInteractionActive'
> &
  Partial<
    Pick<MapLibreLayerController, 'getRasterSourceId' | 'isExpectedRasterCancellation'>
  >;

const sourceRecoveryStabilityMs = 2_000;

function getErrorSourceId(event: MapLibreErrorEvent): string | null {
  const sourceId = (event as unknown as { readonly sourceId?: unknown }).sourceId;
  return typeof sourceId === 'string' ? sourceId : null;
}

function isSatelliteSourceId(sourceId: string): boolean {
  return (
    sourceId === mapSourceIds.sentinelRasterA ||
    sourceId === mapSourceIds.sentinelRasterB
  );
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
  resolvedSourceId: string | null = getErrorSourceId(event),
): MapFailureCategory {
  const sourceId = resolvedSourceId;
  if (sourceId === mapSourceIds.terrainDem) return 'terrain';
  if (sourceId === mapSourceIds.basemapVector) return 'base-vector';
  if (
    sourceId === mapSourceIds.sentinelRasterA ||
    sourceId === mapSourceIds.sentinelRasterB
  )
    return 'satellite-raster';

  const message = event.error.message.toLowerCase();
  if (message.includes('glyph') || message.includes('sprite')) return 'glyph-sprite';
  if (message.includes('style') || lifecycle === 'loading') return 'style';
  return 'unknown';
}

function recoverableMessage(
  category: MapFailureCategory,
  details: ReturnType<typeof mapFailureDetails>,
  recoveryState: MapSourceFailure['recoveryState'],
): string {
  switch (category) {
    case 'base-vector':
      return 'Some basemap tiles could not load. You can keep using areas that are already visible.';
    case 'glyph-sprite':
      return 'Some map labels or icons could not load. Roads and terrain remain available.';
    case 'terrain':
      return '3D terrain is unavailable. The 2D basemap remains usable.';
    case 'satellite-raster': {
      const status =
        details.httpStatus === null ? '' : ` (HTTP ${String(details.httpStatus)})`;
      const recovery =
        recoveryState === 'scheduled'
          ? ' Retrying automatically.'
          : recoveryState === 'alternative-provider'
            ? ' TiTiler is unavailable; switching to direct pre-rendered Sentinel imagery.'
            : recoveryState === 'exhausted'
              ? ' Automatic retries were exhausted; reapply the scene to try again.'
              : recoveryState === 'not-retryable'
                ? ' Reapply the scene after correcting the request or provider issue.'
                : '';
      switch (details.reason) {
        case 'rate-limit':
          return `The satellite imagery renderer is rate-limiting requests${status}.${recovery}`;
        case 'http-server':
          return `The satellite imagery renderer returned a server error${status}.${recovery}`;
        case 'timeout':
          return `The satellite imagery request timed out${status}.${recovery}`;
        case 'network':
          return `The satellite imagery request failed because of a network connection error.${recovery}`;
        case 'no-response':
          return `The satellite imagery tile received no HTTP response (network, CORS, or provider connection failure).${recovery}`;
        case 'http-client':
          return `The satellite imagery renderer rejected the tile request${status}.${recovery}`;
        default:
          return `Some satellite imagery tiles could not load${status}. Open developer diagnostics for details.${recovery}`;
      }
    }
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
  #terrainCameraAdjustmentActive = false;
  #terrainSourceRefreshRequired = false;
  #terrainRetryRevision = 0;
  #cancelTerrainWait: (() => void) | null = null;
  readonly #failureBuckets = new Map<string, FailureBucket>();
  readonly #sourceRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #mountedAt = 0;
  #lastCameraDiagnosticAt = 0;
  #styleSnapshotQueued = false;
  #pointInspection: MapPointInspection = { status: 'closed' };
  #pointInspectionSequence = 0;
  #pointInspectionAbort: AbortController | null = null;
  readonly #pointInspector: PointInspectorPopup;
  readonly #middleMouseCamera = new MiddleMouseCameraControl();

  public constructor(
    private readonly logger: DiagnosticLogger,
    private readonly onViewSettled: (view: MapViewState) => void = () => undefined,
    private readonly provider?: MapProviderOptions,
    private readonly snapshotStore?: MapDiagnosticsSnapshotStore,
    private readonly layerController?: MapLayerControllerLifecycle,
    private readonly elevationProvider?: ElevationProvider,
    pointInspector?: PointInspectorPopup,
  ) {
    this.#pointInspector =
      pointInspector ??
      new MapLibrePointInspector(() => {
        this.closePointInspection();
      });
    this.snapshotStore?.update(this.#snapshot);
  }

  /** Attaches exactly one native map and transfers listener ownership from any prior map. */
  public attach(map: MapLibreMap): void {
    if (this.#map === map) {
      return;
    }
    this.detach();
    this.#map = map;
    this.#middleMouseCamera.attach(map.getCanvasContainer(), map);
    this.#middleMouseCamera.setEnabled(this.#snapshot.terrainMode === 'terrain');
    this.#pointInspector.attach(map);
    this.layerController?.attach(map);
    map.on('load', this.handleLoad);
    map.on('styledata', this.handleStyleData);
    map.on('idle', this.handleIdle);
    map.on('movestart', this.handleMoveStart);
    map.on('moveend', this.handleMoveEnd);
    map.on('click', this.handleMapClick);
    map.on('sourcedata', this.handleSourceData);
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

  public getPointInspection(): MapPointInspection {
    return this.#pointInspection;
  }

  public closePointInspection(): void {
    this.#pointInspectionSequence += 1;
    this.#pointInspectionAbort?.abort();
    this.#pointInspectionAbort = null;
    if (this.#pointInspection.status !== 'closed') {
      this.#pointInspector.close();
      this.updatePointInspection({ status: 'closed' });
      this.logger.log({ level: 'debug', name: 'map.point-inspection.closed' });
    }
  }

  public navigateTo(target: {
    readonly longitude: number;
    readonly latitude: number;
    readonly zoom?: number;
  }): void {
    const map = this.#map;
    if (map === null) return;
    map.easeTo({
      center: [target.longitude, target.latitude],
      zoom: target.zoom ?? Math.max(map.getZoom(), 13),
      duration: 650,
      essential: true,
    });
    this.logger.log({
      level: 'info',
      name: 'map.navigation.requested',
      data: { status: 'accepted' },
    });
  }

  public fitBounds(bounds: MapViewportBounds, maxZoom: number): void {
    const map = this.#map;
    if (map === null) return;
    map.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      {
        padding: 56,
        maxZoom,
        duration: 650,
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
    );
    this.logger.log({
      level: 'info',
      name: 'map.navigation.bounds-requested',
      data: { status: 'accepted' },
    });
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

    this.#terrainCameraAdjustmentActive = true;
    const promise = this.transitionTerrain(mode).finally(() => {
      this.#terrainCameraAdjustmentActive = false;
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
    this.#pointInspector.destroy();
    this.#listeners.clear();
  }

  private readonly handleLoad = (): void => {
    const map = this.#map;
    if (map === null) {
      return;
    }
    this.layerController?.attach(map);
    const style = map.getStyle();
    const terrainMode = map.getTerrain() === null ? 'flat' : 'terrain';
    this.updateSnapshot({
      lifecycle:
        this.#snapshot.message === null ||
        this.#snapshot.recoverableFailures.length === 0
          ? 'ready'
          : 'degraded',
      camera: this.readCamera(map),
      terrainMode,
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
    this.layerController?.setTerrainInteractionActive(false);
    // Terrain mode changes deliberately issue intermediate camera commands. Persisting
    // one of those transient views can restore a pitched flat map or a level 3D map.
    if (this.#terrainCameraAdjustmentActive) return;
    if (this.#map !== null) {
      const camera = this.readCamera(this.#map);
      this.updateSnapshot({ camera });
      this.onViewSettled({ camera, terrainMode: this.#snapshot.terrainMode });
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

  private readonly handleMoveStart = (): void => {
    this.layerController?.setTerrainInteractionActive(true);
  };

  private readonly handleMapClick = (event: MapMouseEvent): void => {
    const map = this.#map;
    if (map === null) return;
    if (this.#pointInspection.status === 'open') {
      const visible = this.#pointInspector.isVisible();
      this.closePointInspection();
      if (visible) return;
    }
    this.#pointInspectionSequence += 1;
    const sequence = this.#pointInspectionSequence;
    this.#pointInspectionAbort?.abort();
    const abortController = new AbortController();
    this.#pointInspectionAbort = abortController;
    const coordinate = {
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    };
    this.updatePointInspection({
      status: 'open',
      coordinate,
      elevation: { status: 'loading' },
      nearbyPoi: { status: 'loading' },
    });
    this.logger.log({ level: 'info', name: 'map.point-inspection.started' });
    void this.inspectPoint(map, coordinate, sequence, abortController.signal);
  };

  private async inspectPoint(
    map: MapLibreMap,
    coordinate: { readonly longitude: number; readonly latitude: number },
    sequence: number,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = performance.now();
    let nearbyPoi: Exclude<MapPointInspection, { status: 'closed' }>['nearbyPoi'];
    try {
      const sourceLayers = this.provider?.sourceLayers;
      if (
        sourceLayers === undefined ||
        map.getSource(mapSourceIds.basemapVector) === undefined
      ) {
        nearbyPoi = { status: 'error' };
      } else {
        const features = [
          ...map.querySourceFeatures(mapSourceIds.basemapVector, {
            sourceLayer: sourceLayers.pois,
          }),
          ...map.querySourceFeatures(mapSourceIds.basemapVector, {
            sourceLayer: sourceLayers.peaks,
          }),
        ];
        const poi = selectNearestPoi(features, coordinate);
        nearbyPoi = poi === null ? { status: 'none' } : { status: 'found', poi };
      }
    } catch {
      nearbyPoi = { status: 'error' };
    }

    if (!this.isCurrentInspection(map, sequence, signal)) return;
    this.updatePointInspection({
      status: 'open',
      coordinate,
      elevation: { status: 'loading' },
      nearbyPoi,
    });

    let elevation: Exclude<MapPointInspection, { status: 'closed' }>['elevation'];
    try {
      const nativeElevation = map.queryTerrainElevation([
        coordinate.longitude,
        coordinate.latitude,
      ]);
      if (typeof nativeElevation === 'number' && Number.isFinite(nativeElevation)) {
        elevation = {
          status: 'available',
          meters: nativeElevation / (this.provider?.terrain.exaggeration ?? 1),
        };
      } else if (this.elevationProvider === undefined) {
        elevation = { status: 'unavailable' };
      } else {
        const sample = await this.elevationProvider.sample(coordinate, signal);
        elevation =
          sample.status === 'available'
            ? { status: 'available', meters: sample.meters }
            : { status: 'unavailable' };
      }
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      elevation = { status: 'error' };
    }

    if (!this.isCurrentInspection(map, sequence, signal)) return;
    this.#pointInspectionAbort = null;
    this.updatePointInspection({ status: 'open', coordinate, elevation, nearbyPoi });
    this.logger.log({
      level:
        elevation.status === 'error' || nearbyPoi.status === 'error' ? 'warn' : 'info',
      name: 'map.point-inspection.completed',
      data: {
        durationMs: Math.max(0, performance.now() - startedAt),
        status:
          elevation.status === 'error' || nearbyPoi.status === 'error'
            ? 'partial'
            : 'ready',
        count: nearbyPoi.status === 'found' ? 1 : 0,
      },
    });
  }

  private isCurrentInspection(
    map: MapLibreMap,
    sequence: number,
    signal: AbortSignal,
  ): boolean {
    return (
      this.#map === map && this.#pointInspectionSequence === sequence && !signal.aborted
    );
  }

  private readonly handleError = (event: MapLibreErrorEvent): void => {
    // Camera changes routinely cancel obsolete tile requests. Treating those as
    // failures creates a diagnostics/subscriber render storm during pan and zoom.
    if (isCanceledMapRequest(event)) return;
    if (this.layerController?.isExpectedRasterCancellation?.(event) === true) return;
    const sourceId =
      getErrorSourceId(event) ??
      this.layerController?.getRasterSourceId?.(event) ??
      null;
    const category = categorizeMapError(event, this.#snapshot.lifecycle, sourceId);
    if (
      category === 'satellite-raster' &&
      sourceId !== null &&
      this.#map?.getSource(sourceId) === undefined
    ) {
      // Removing or superseding a raster can deliver a late error from its old tiles.
      // It no longer represents any source the user can see or recover.
      return;
    }
    const details = mapFailureDetails(event);
    if (category !== 'style') {
      if (sourceId !== null) this.cancelSourceRecovery(sourceId);
      const recovery =
        category === 'satellite-raster'
          ? (this.layerController?.handleRasterSourceFailure(event) ?? {
              state: 'not-applicable' as const,
              retryAttempt: 0,
              retryDelayMs: 0,
            })
          : {
              state: 'not-applicable' as const,
              retryAttempt: 0,
              retryDelayMs: 0,
            };
      this.recordRecoverableFailure(category, sourceId, details, recovery);
      this.updateSnapshot({
        lifecycle: 'degraded',
        ...(category === 'terrain' ? { terrainMode: 'flat' as const } : {}),
        message: recoverableMessage(category, details, recovery.state),
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

  private readonly handleSourceData = (event: MapSourceDataEvent): void => {
    const sourceId = event.sourceId;
    const map = this.#map;
    if (map === null) return;
    if (map.getSource(sourceId) === undefined) {
      // MapLibre emits one final source-data event synchronously while removeSource is
      // tearing down its tile manager. It is cancellation evidence, not a map failure.
      this.discardRemovedSourceFailures(sourceId);
      return;
    }
    const recoveredFailedTiles = isSatelliteSourceId(sourceId)
      ? (this.layerController?.handleRasterSourceData(event) ?? false)
      : true;
    let loaded = event.isSourceLoaded;
    if (!loaded) {
      try {
        loaded = map.isSourceLoaded(sourceId);
      } catch {
        // A stale source-data event can arrive after its replaceable source was removed.
        return;
      }
    }
    if (!loaded) return;
    if (isSatelliteSourceId(sourceId) && !recoveredFailedTiles) return;
    if (this.#sourceRecoveryTimers.has(sourceId)) return;
    const hasActiveFailure = [...this.#failureBuckets.values()].some(
      (bucket) =>
        bucket.failure.sourceId === sourceId &&
        bucket.failure.recoveryState !== 'recovered',
    );
    if (!hasActiveFailure) return;
    this.#sourceRecoveryTimers.set(
      sourceId,
      setTimeout(() => {
        this.#sourceRecoveryTimers.delete(sourceId);
        this.confirmSourceRecovery(sourceId);
      }, sourceRecoveryStabilityMs),
    );
  };

  private discardRemovedSourceFailures(sourceId: string): void {
    this.cancelSourceRecovery(sourceId);
    let discarded = false;
    for (const [key, bucket] of this.#failureBuckets) {
      if (bucket.failure.sourceId !== sourceId) continue;
      discarded = true;
      this.#failureBuckets.delete(key);
    }
    if (!discarded) return;
    const recoverableFailures = [...this.#failureBuckets.values()].map(
      (bucket) => bucket.failure,
    );
    const hasActiveFailure = recoverableFailures.some(
      (failure) => failure.recoveryState !== 'recovered',
    );
    this.updateSnapshot({
      recoverableFailures,
      ...(!hasActiveFailure && this.#snapshot.lifecycle === 'degraded'
        ? { lifecycle: 'ready' as const, message: null }
        : {}),
    });
    this.logger.log({
      level: 'info',
      name: 'map.source.cancellation-cleared',
      data: { sourceId },
    });
  }

  private confirmSourceRecovery(sourceId: string): void {
    const map = this.#map;
    if (map === null) return;
    try {
      if (!map.isSourceLoaded(sourceId)) return;
    } catch {
      return;
    }
    if (
      isSatelliteSourceId(sourceId) &&
      !(this.layerController?.isRasterSourceRecoveryComplete(sourceId) ?? false)
    )
      return;
    let recovered = false;
    for (const [key, bucket] of this.#failureBuckets) {
      if (
        bucket.failure.sourceId !== sourceId ||
        bucket.failure.recoveryState === 'recovered'
      ) {
        continue;
      }
      recovered = true;
      this.#failureBuckets.set(key, {
        ...bucket,
        failure: { ...bucket.failure, recoveryState: 'recovered' },
      });
    }
    if (!recovered) return;
    this.layerController?.handleRasterSourceRecovered(sourceId);
    const recoverableFailures = [...this.#failureBuckets.values()].map(
      (bucket) => bucket.failure,
    );
    const hasActiveFailure = recoverableFailures.some(
      (failure) => failure.recoveryState !== 'recovered',
    );
    this.updateSnapshot({
      recoverableFailures,
      lifecycle: hasActiveFailure ? 'degraded' : 'ready',
      message: hasActiveFailure ? this.#snapshot.message : null,
    });
    this.logger.log({
      level: 'info',
      name: 'map.source.recovered',
      data: { sourceId },
    });
  }

  private cancelSourceRecovery(sourceId: string): void {
    const timer = this.#sourceRecoveryTimers.get(sourceId);
    if (timer !== undefined) clearTimeout(timer);
    this.#sourceRecoveryTimers.delete(sourceId);
  }

  private cancelAllSourceRecoveries(): void {
    for (const timer of this.#sourceRecoveryTimers.values()) clearTimeout(timer);
    this.#sourceRecoveryTimers.clear();
  }

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
      // Level the terrain-relative camera before removing its elevation reference.
      // Removing terrain from a pitched camera can move its geographic target while
      // MapLibre reconciles the camera with sea level.
      map.jumpTo({
        center: [camera.longitude, camera.latitude],
        zoom: camera.zoom,
        bearing: 0,
        pitch: 0,
      });
      map.setTerrain(null);
      const flatCamera = this.readCamera(map);
      this.updateSnapshot({
        lifecycle: 'ready',
        terrainMode: 'flat',
        camera: flatCamera,
        message: null,
      });
      this.onViewSettled({ camera: flatCamera, terrainMode: 'flat' });
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
      if (this.#terrainSourceRefreshRequired) {
        const terrainSource = map.getSource(mapSourceIds.terrainDem) as {
          setTiles?: (tiles: string[]) => void;
        };
        if (terrainSource.setTiles === undefined) {
          throw new Error('The terrain source cannot refresh its tiles.');
        }
        this.#terrainRetryRevision += 1;
        const separator = provider.demTileUrl.includes('?') ? '&' : '?';
        terrainSource.setTiles([
          `${provider.demTileUrl}${separator}terrainEnableRetry=${String(this.#terrainRetryRevision)}`,
        ]);
        this.#terrainSourceRefreshRequired = false;
        this.logger.log({ level: 'info', name: 'map.terrain.retry-started' });
      }
      // A restored 3D view can mount as a pitched flat camera. Level it before the DEM
      // changes the center elevation so a mountain cannot temporarily cover the camera
      // and trigger MapLibre's emergency camera correction.
      map.jumpTo({
        center: [camera.longitude, camera.latitude],
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: 0,
      });
      map.setTerrain({
        source: mapSourceIds.terrainDem,
        exaggeration: provider.terrain.exaggeration,
      });
      await this.waitForTerrainSource(map, provider.requestTimeoutMs);
      map.jumpTo({
        center: [camera.longitude, camera.latitude],
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch,
      });
      const terrainCamera = this.readCamera(map);
      this.updateSnapshot({
        lifecycle: 'ready',
        terrainMode: 'terrain',
        camera: terrainCamera,
        sourceIds: Object.keys(map.getStyle().sources),
        message: null,
      });
      this.onViewSettled({ camera: terrainCamera, terrainMode: 'terrain' });
      this.logger.log({ level: 'info', name: 'map.terrain.enabled' });
      return { status: 'success', mode };
    } catch {
      this.#terrainSourceRefreshRequired = true;
      map.setTerrain(null);
      map.jumpTo({
        center: [camera.longitude, camera.latitude],
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: 0,
      });
      const fallbackCamera = this.readCamera(map);
      this.updateSnapshot({
        lifecycle: 'degraded',
        terrainMode: 'flat',
        camera: fallbackCamera,
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
    details: ReturnType<typeof mapFailureDetails>,
    recovery: {
      readonly state: MapSourceFailure['recoveryState'];
      readonly retryAttempt: number;
    },
  ): void {
    const now = Date.now();
    const key = `${category}:${sourceId ?? 'none'}:${details.reason}:${details.httpStatus === null ? 'none' : String(details.httpStatus)}`;
    const previous = this.#failureBuckets.get(key);
    const failure: MapSourceFailure = {
      category,
      sourceId,
      reason: details.reason,
      httpStatus: details.httpStatus,
      count: Math.min(9_999, (previous?.failure.count ?? 0) + 1),
      lastOccurredAt: new Date(now).toISOString(),
      recoveryState: recovery.state,
      retryAttempt: recovery.retryAttempt,
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
          reason: details.reason,
          recoveryState: recovery.state,
          retryAttempt: recovery.retryAttempt,
          ...(details.httpStatus === null ? {} : { status: details.httpStatus }),
          ...(sourceId === null ? {} : { sourceId }),
        },
      });
    }
  }

  private updateSnapshot(changed: Partial<MapDiagnosticsSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...changed };
    this.#middleMouseCamera.setEnabled(this.#snapshot.terrainMode === 'terrain');
    this.snapshotStore?.update(this.#snapshot);
    for (const listener of this.#listeners) {
      listener();
    }
  }

  private updatePointInspection(inspection: MapPointInspection): void {
    this.#pointInspection = inspection;
    if (inspection.status === 'open') this.#pointInspector.show(inspection);
    for (const listener of this.#listeners) listener();
  }

  private detach(): void {
    this.cancelAllSourceRecoveries();
    const map = this.#map;
    if (map === null) {
      return;
    }
    map.off('load', this.handleLoad);
    map.off('styledata', this.handleStyleData);
    map.off('idle', this.handleIdle);
    map.off('movestart', this.handleMoveStart);
    map.off('moveend', this.handleMoveEnd);
    map.off('click', this.handleMapClick);
    map.off('sourcedata', this.handleSourceData);
    map.off('error', this.handleError);
    map.getCanvas().removeEventListener('webglcontextlost', this.handleContextLost);
    map
      .getCanvas()
      .removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.#middleMouseCamera.detach();
    this.layerController?.detach(map);
    this.#pointInspectionSequence += 1;
    this.#pointInspectionAbort?.abort();
    this.#pointInspectionAbort = null;
    this.#pointInspector.close();
    this.#pointInspection = { status: 'closed' };
    this.#map = null;
    this.logger.log({ level: 'debug', name: 'map.lifecycle.unmounted' });
  }
}
