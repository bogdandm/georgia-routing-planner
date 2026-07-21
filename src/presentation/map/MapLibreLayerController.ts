import type {
  ErrorEvent as MapLibreErrorEvent,
  Map as MapLibreMap,
  MapSourceDataEvent,
} from 'maplibre-gl';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type {
  MapLayerPreferencesRepository,
  MapLayerVisibilityPreferences,
  PersistedMapLayerPreferences,
  TerrainOverlayPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';
import { defaultTerrainOverlayPreferences } from '@/application/ports/MapLayerPreferencesRepository';
import { supportedContourIntervals } from '@/application/ports/MapLayerPreferencesRepository';
import type { SentinelQueryDiagnostics } from '@/application/ports/SentinelQueryDiagnostics';
import { SentinelQueryOperation } from '@/application/satellite/SentinelQueryOperation';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';
import {
  type LogicalMapLayerId,
  type MapLayerVisibility,
  type MapLayerVisibilityResult,
} from '@/presentation/map/MapLayerVisibility';
import {
  mapInsertionPoints,
  mapLayerIds,
  mapSourceIds,
  sentinelMapLayerIds,
  terrainOverlayLayerIds,
} from '@/presentation/map/mapIds';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import {
  mapVisualModePaint,
  mapVisualPalette,
  type MapVisualMode,
  type MapVisualModePaint,
} from '@/presentation/map/mapVisualPalette';
import type {
  SatelliteImageryCommandResult,
  SatelliteImageryMap,
  SatelliteRenderingTuning,
} from '@/presentation/map/SatelliteImageryMap';
import { defaultSatelliteRenderingTuning } from '@/presentation/map/SatelliteImageryMap';
import type {
  TerrainOverlayCommandResult,
  TerrainOverlayMap,
} from '@/presentation/map/TerrainOverlayMap';
import { createTerrainDemSource } from '@/presentation/map/terrainOverlayStyle';
import type { ContourTileGenerator } from '@/presentation/map/ContourTileGenerator';
import { mapFailureDetails } from '@/presentation/map/mapFailureDetails';
import type { MapRecoveryState } from '@/presentation/map/mapTypes';

const rasterSlots = [
  { sourceId: mapSourceIds.sentinelRasterA, layerId: sentinelMapLayerIds.rasterA },
  { sourceId: mapSourceIds.sentinelRasterB, layerId: sentinelMapLayerIds.rasterB },
] as const;

const openStreetMapOpacityProperties = {
  [mapLayerIds.landcover]: ['fill-opacity'],
  [mapLayerIds.glacierAreas]: ['fill-opacity'],
  [mapLayerIds.water]: ['fill-opacity'],
  [mapLayerIds.restrictedAreas]: ['line-opacity'],
  [mapLayerIds.hikingPaths]: ['line-opacity'],
  [mapLayerIds.hikingSteps]: ['line-opacity'],
  [mapLayerIds.roadCasings]: ['line-opacity'],
  [mapLayerIds.roads]: ['line-opacity'],
  [mapLayerIds.roadLabels]: ['text-opacity'],
  [mapLayerIds.hikingPois]: ['circle-opacity', 'circle-stroke-opacity'],
  [mapLayerIds.hikingPoiLabels]: ['text-opacity'],
  [mapLayerIds.peaks]: ['circle-opacity', 'circle-stroke-opacity'],
  [mapLayerIds.peakLabels]: ['text-opacity'],
  [mapLayerIds.placeLabels]: ['text-opacity'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const maximumRasterRecoveryAttempts = 3;
const rasterRecoveryBaseDelayMs = 1_000;
const rasterSourceStabilityMs = 2_000;

export const logicalNativeLayerGroups: Readonly<
  Record<
    Exclude<LogicalMapLayerId, 'satellite-imagery' | 'scene-footprint'>,
    readonly string[]
  >
> = {
  'terrain-relief': [terrainOverlayLayerIds.reliefShade],
  'elevation-isolines': [
    terrainOverlayLayerIds.contourMinor,
    terrainOverlayLayerIds.contourIndex,
    terrainOverlayLayerIds.contourLabels,
  ],
  'natural-features': [
    mapLayerIds.landcover,
    mapLayerIds.glacierAreas,
    mapLayerIds.water,
  ],
  'restricted-areas': [mapLayerIds.restrictedAreas],
  'hiking-paths': [mapLayerIds.hikingPaths, mapLayerIds.hikingSteps],
  roads: [mapLayerIds.roadCasings, mapLayerIds.roads, mapLayerIds.roadLabels],
  'places-and-pois': [
    mapLayerIds.hikingPois,
    mapLayerIds.hikingPoiLabels,
    mapLayerIds.peaks,
    mapLayerIds.peakLabels,
    mapLayerIds.placeLabels,
  ],
};

type RasterSlot = (typeof rasterSlots)[number];
interface RasterTileCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface RasterRecoveryTracker {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  readonly pendingTiles: Map<string, RasterTileCoordinate>;
  hasUnscopedFailure: boolean;
  lastDetails: ReturnType<typeof mapFailureDetails>;
  scheduledDelayMs: number;
}

interface RasterRecoveryRequest {
  readonly state: MapRecoveryState;
  readonly retryAttempt: number;
  readonly retryDelayMs: number;
}

function sceneBounds(scene: SatelliteScene): [number, number, number, number] {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  const polygons =
    scene.footprint.type === 'Polygon'
      ? [scene.footprint.coordinates]
      : scene.footprint.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const position of ring) {
        const longitude = position[0];
        const latitude = position[1];
        if (longitude === undefined || latitude === undefined) continue;
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }
    }
  }
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error('The scene footprint does not contain usable coordinates.');
  }
  return [west, south, east, north];
}

function sourceIdFromError(event: MapLibreErrorEvent): string | null {
  const value = (event as unknown as { readonly sourceId?: unknown }).sourceId;
  return typeof value === 'string' ? value : null;
}

function tileCoordinateFromEvent(event: unknown): RasterTileCoordinate | null {
  const canonical =
    (
      event as {
        readonly coord?: { readonly canonical?: RasterTileCoordinate };
        readonly tile?: {
          readonly tileID?: {
            readonly canonical?: {
              readonly x?: unknown;
              readonly y?: unknown;
              readonly z?: unknown;
            };
          };
        };
      }
    ).tile?.tileID?.canonical ??
    (event as { readonly coord?: { readonly canonical?: RasterTileCoordinate } }).coord
      ?.canonical;
  if (
    canonical === undefined ||
    !Number.isInteger(canonical.x) ||
    !Number.isInteger(canonical.y) ||
    !Number.isInteger(canonical.z)
  ) {
    return null;
  }
  return {
    x: canonical.x as number,
    y: canonical.y as number,
    z: canonical.z as number,
  };
}

function applicationOriginCacheKey(): string {
  const origin = `${window.location.protocol}-${window.location.host}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120);
  return origin === '' ? 'unknown-origin' : origin;
}

function isCanceledMapRequest(event: MapLibreErrorEvent): boolean {
  const errorName = (event.error as unknown as { readonly name?: unknown }).name;
  return (
    errorName === 'AbortError' ||
    /\b(?:abort(?:ed)?|cancel(?:ed|led)|superseded)\b/iu.test(event.error.message)
  );
}

class SentinelRasterLoadError extends Error {
  public constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = 'SentinelRasterLoadError';
  }
}

function safeRasterFailureMessage(event: MapLibreErrorEvent): string {
  const details = mapFailureDetails(event);
  const status =
    details.httpStatus === null ? '' : ` (HTTP ${String(details.httpStatus)})`;
  switch (details.reason) {
    case 'no-response':
      return 'The imagery tile request received no HTTP response (network, CORS, or provider connection failure). The current map remains usable; retry the scene.';
    case 'network':
      return 'The imagery tile request failed because of a network connection error. The current map remains usable; retry the scene.';
    case 'rate-limit':
      return `The imagery renderer is rate-limiting requests${status}. The current map remains usable; wait briefly, then retry.`;
    case 'timeout':
      return `The imagery renderer did not finish in time${status}. The current map remains usable; retry the scene.`;
    case 'http-server':
      return `The imagery renderer is temporarily unavailable${status}. The current map remains usable; retry shortly.`;
    case 'http-client':
      if (details.httpStatus === 400 || details.httpStatus === 422) {
        return `The imagery renderer rejected these stretch values${status}. Reset the imagery stretch or try less extreme values.`;
      }
      return `The imagery renderer rejected the tile request${status}. The current map remains usable; review the provider configuration.`;
    case 'unknown':
      return 'The imagery renderer did not return a usable tile. The current map remains usable; retry or reset the imagery stretch.';
  }
}

/**
 * Owns logical visibility plus the replaceable Sentinel raster/footprint sources on the
 * long-lived native map. Provider URLs stay inside this adapter and never enter state.
 */
export class MapLibreLayerController
  implements MapLayerVisibility, SatelliteImageryMap, TerrainOverlayMap
{
  #map: MapLibreMap | null = null;
  #activeSlot: RasterSlot | null = null;
  #appliedScene: SatelliteScene | null = null;
  #applySequence = 0;
  #pendingRestore: PersistedMapLayerPreferences | null = null;
  #restoreController: AbortController | null = null;
  #restoreInProgress = false;
  #renderingTuning: SatelliteRenderingTuning = defaultSatelliteRenderingTuning;
  #terrainOverlayPreferences: TerrainOverlayPreferences =
    defaultTerrainOverlayPreferences;
  #contourFailureReported = false;
  #appliedDemTileUrl: string | null = null;
  #appliedContourTileUrl: string | null = null;
  #appliedVisualMode: MapVisualMode | null = null;
  readonly #visualModeLayerAnchors = new Map<string, unknown>();
  readonly #releaseTerrainComputeStatus: () => void;
  readonly #releaseTerrainComputeQueue: () => void;
  #appliedOpenStreetMapOpacity: number | null = null;
  readonly #openStreetMapOpacityLayerAnchors = new Map<string, unknown>();
  readonly #rasterRecoveries = new Map<string, RasterRecoveryTracker>();
  #stagingSourceId: string | null = null;

  public constructor(
    private readonly renderer: MapProviderConfiguration['satellite']['renderer'],
    private readonly terrain: MapProviderConfiguration['terrain'],
    private readonly contourTiles: ContourTileGenerator,
    private readonly logger: DiagnosticLogger,
    private readonly idGenerator: IdGenerator,
    private readonly diagnostics: SentinelQueryDiagnostics,
    private readonly satelliteRendererTimeoutMs: number,
    private readonly preferences: MapLayerPreferencesRepository,
  ) {
    mapLayerStore.setState({
      terrainComputeStatus: contourTiles.getStatus(),
      terrainComputeQueue: contourTiles.getQueueState(),
    });
    this.#releaseTerrainComputeStatus = contourTiles.subscribeStatus((status) => {
      mapLayerStore.setState({ terrainComputeStatus: status });
    });
    this.#releaseTerrainComputeQueue = contourTiles.subscribeQueueState((state) => {
      mapLayerStore.setState({ terrainComputeQueue: state });
    });
  }

  public attach(map: MapLibreMap): void {
    if (this.#map === map) {
      this.reconcileTerrainOverlays();
      this.applyBaseLayerVisibility();
      this.applyMapVisualMode();
      if (map.isStyleLoaded()) void this.restorePendingScene();
      return;
    }
    this.#map?.off('styledata', this.handleStyleData);
    this.#map = map;
    map.on('styledata', this.handleStyleData);
    map.on('error', this.handleTerrainOverlayError);
    this.reconcileTerrainOverlays();
    this.applyBaseLayerVisibility();
    this.applyMapVisualMode();
    if (map.isStyleLoaded()) void this.restorePendingScene();
  }

  public createDemTileUrl(): string {
    return this.contourTiles.createDemTileUrl();
  }

  public setTerrainInteractionActive(active: boolean): void {
    this.contourTiles.setInteractionActive(active);
  }

  public detach(map: MapLibreMap): void {
    if (this.#map !== map) return;
    this.contourTiles.setInteractionActive(false);
    map.off('styledata', this.handleStyleData);
    map.off('error', this.handleTerrainOverlayError);
    this.cancelRasterRecovery();
    this.#map = null;
    this.#appliedVisualMode = null;
    this.#visualModeLayerAnchors.clear();
    this.#appliedOpenStreetMapOpacity = null;
    this.#openStreetMapOpacityLayerAnchors.clear();
    this.#applySequence += 1;
    this.#restoreController?.abort();
  }

  /** Releases map listeners, persistence work, protocols, and terrain compute resources. */
  public dispose(): void {
    const map = this.#map;
    if (map !== null) this.detach(map);
    this.#releaseTerrainComputeStatus();
    this.#releaseTerrainComputeQueue();
    this.contourTiles.dispose();
  }

  public setLayerVisibility(
    layerId: LogicalMapLayerId,
    visible: boolean,
  ): MapLayerVisibilityResult {
    const map = this.#map;
    if (map === null) {
      return this.visibilityFailure('The map is not ready yet.');
    }

    const state = mapLayerStore.getState();
    if (
      (layerId === 'satellite-imagery' || layerId === 'scene-footprint') &&
      state.appliedImagery.status === 'empty'
    ) {
      return this.visibilityFailure('Apply a Sentinel scene before changing it.');
    }

    const nativeLayerIds = this.nativeLayerIds(layerId);
    const missing = nativeLayerIds.filter(
      (nativeId) => map.getLayer(nativeId) === undefined,
    );
    if (missing.length > 0) {
      return this.visibilityFailure('The requested map layer is not available yet.');
    }

    for (const nativeId of nativeLayerIds) {
      map.setLayoutProperty(nativeId, 'visibility', visible ? 'visible' : 'none');
    }
    const visibility = { ...state.visibility, [layerId]: visible };
    const appliedImagery =
      layerId !== 'satellite-imagery'
        ? state.appliedImagery
        : this.withRasterVisibility(state.appliedImagery, visible);
    mapLayerStore.setState({ visibility, appliedImagery, errorMessage: null });
    if (layerId === 'satellite-imagery') this.applyMapVisualMode();
    this.persistStableState();
    this.logger.log({
      level: 'info',
      name: 'map.layer.visibility-changed',
      data: { category: layerId, status: visible ? 'visible' : 'hidden' },
    });
    return { status: 'success' };
  }

  public setOpenStreetMapOpacity(opacity: number): MapLayerVisibilityResult {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      return this.visibilityFailure('Choose an opacity between 0 and 100 percent.');
    }
    if (this.#map === null) return this.visibilityFailure('The map is not ready yet.');
    mapLayerStore.setState({ openStreetMapOpacity: opacity, errorMessage: null });
    this.applyOpenStreetMapOpacity(true);
    this.persistStableState();
    this.logger.log({
      level: 'info',
      name: 'map.layer-group.opacity-changed',
      data: { category: 'openstreetmap', opacityPercent: Math.round(opacity * 100) },
    });
    return { status: 'success' };
  }

  public async applyScene(
    scene: SatelliteScene,
    signal: AbortSignal,
  ): Promise<SatelliteImageryCommandResult> {
    this.#restoreController?.abort();
    this.#restoreController = null;
    this.#pendingRestore = null;
    return this.applySceneInternal(scene, signal, true);
  }

  public clearScene(): SatelliteImageryCommandResult {
    this.cancelRasterRecovery();
    this.#applySequence += 1;
    this.#restoreController?.abort();
    this.#restoreController = null;
    this.#pendingRestore = null;
    const map = this.#map;
    if (map !== null) {
      for (const slot of rasterSlots) this.removeSlot(map, slot);
      this.removeFootprint(map);
      this.reconcileTerrainOverlays();
    }
    this.#activeSlot = null;
    this.#appliedScene = null;
    mapLayerStore.setState({ appliedImagery: { status: 'empty' }, errorMessage: null });
    this.applyMapVisualMode();
    this.persistStableState();
    this.logger.log({
      level: 'info',
      name: 'satellite.imagery.cleared',
      data: { status: 'empty' },
    });
    return { status: 'success' };
  }

  public getAppliedScene(): SatelliteScene | null {
    return this.#appliedScene;
  }

  /** Schedules one bounded refresh of failed tiles on the active raster. */
  public handleRasterSourceFailure(event: MapLibreErrorEvent): RasterRecoveryRequest {
    const sourceId = sourceIdFromError(event);
    if (
      this.#map === null ||
      sourceId === null ||
      (sourceId !== this.#activeSlot?.sourceId && sourceId !== this.#stagingSourceId)
    ) {
      return { state: 'not-applicable', retryAttempt: 0, retryDelayMs: 0 };
    }
    const details = mapFailureDetails(event);
    if (!details.retryable) {
      return { state: 'not-retryable', retryAttempt: 0, retryDelayMs: 0 };
    }
    const tracker = this.getOrCreateRasterRecovery(sourceId, details);
    tracker.lastDetails = details;
    const tileCoordinate = tileCoordinateFromEvent(event);
    if (tileCoordinate !== null) {
      tracker.pendingTiles.set(this.tileCoordinateKey(tileCoordinate), tileCoordinate);
    } else {
      tracker.hasUnscopedFailure = true;
    }
    if (tracker.timer !== null) {
      return {
        state: 'scheduled',
        retryAttempt: tracker.attempts + 1,
        retryDelayMs: tracker.scheduledDelayMs,
      };
    }
    if (tracker.attempts >= maximumRasterRecoveryAttempts) {
      return {
        state: 'exhausted',
        retryAttempt: tracker.attempts,
        retryDelayMs: 0,
      };
    }
    return this.scheduleRasterRecovery(sourceId, tracker);
  }

  /** Records successful tile data and returns true only when every failed tile recovered. */
  public handleRasterSourceData(event: MapSourceDataEvent): boolean {
    const tracker = this.#rasterRecoveries.get(event.sourceId);
    if (tracker === undefined) return false;
    const coordinate = tileCoordinateFromEvent(event);
    if (coordinate !== null) {
      tracker.pendingTiles.delete(this.tileCoordinateKey(coordinate));
    }
    if (event.sourceDataType === 'content' && event.isSourceLoaded) {
      tracker.hasUnscopedFailure = false;
    }
    if (tracker.pendingTiles.size > 0 || tracker.hasUnscopedFailure) return false;
    if (tracker.timer !== null) clearTimeout(tracker.timer);
    tracker.timer = null;
    tracker.scheduledDelayMs = 0;
    return true;
  }

  public isRasterSourceRecoveryComplete(sourceId: string): boolean {
    const tracker = this.#rasterRecoveries.get(sourceId);
    return tracker?.pendingTiles.size === 0 && !tracker.hasUnscopedFailure;
  }

  public handleRasterSourceRecovered(sourceId: string): void {
    this.cancelRasterRecovery(sourceId);
  }

  public async restorePersistedState(): Promise<void> {
    try {
      const persisted = await this.preferences.loadMapLayerPreferences();
      this.#renderingTuning = { ...persisted.renderingTuning };
      this.#terrainOverlayPreferences = { ...persisted.terrainOverlays };
      this.contourTiles.setFilterEnabled(
        persisted.terrainOverlays.filterInvalidDemPixels,
      );
      this.#pendingRestore = persisted.appliedScene === null ? null : persisted;
      mapLayerStore.setState({
        visibility: persisted.visibility,
        openStreetMapOpacity: persisted.openStreetMapOpacity,
        errorMessage: null,
      });
      this.applyBaseLayerVisibility();
      this.reconcileTerrainOverlays();
      await this.restorePendingScene();
    } catch {
      this.logger.log({
        level: 'warn',
        name: 'storage.map-layers.load-failed',
      });
    }
  }

  public getRenderingTuning(): SatelliteRenderingTuning {
    return { ...this.#renderingTuning };
  }

  public getTerrainOverlayPreferences(): TerrainOverlayPreferences {
    return { ...this.#terrainOverlayPreferences };
  }

  public setTerrainOverlayPreferences(
    value: TerrainOverlayPreferences,
  ): TerrainOverlayCommandResult {
    if (!supportedContourIntervals.includes(value.contourIntervalMeters)) {
      return this.terrainOverlayFailure(
        'Choose a supported contour distance that divides the 200 m index interval.',
      );
    }
    const previous = this.#terrainOverlayPreferences;
    this.#terrainOverlayPreferences = { ...value };
    this.contourTiles.setFilterEnabled(value.filterInvalidDemPixels);
    this.#contourFailureReported = false;
    if (this.#map === null) {
      mapLayerStore.setState({
        terrainOverlays: {
          initialized: false,
          preferences: { ...value },
          message: null,
        },
      });
      this.persistStableState();
      return { status: 'success' };
    }
    const result = this.reconcileTerrainOverlays();
    if (result.status === 'success') {
      this.persistStableState();
      if (previous.filterInvalidDemPixels !== value.filterInvalidDemPixels) {
        this.logger.log({
          level: 'info',
          name: 'map.dem.filter-changed',
          data: { status: value.filterInvalidDemPixels ? 'enabled' : 'disabled' },
        });
      }
    } else {
      this.#terrainOverlayPreferences = previous;
      this.contourTiles.setFilterEnabled(previous.filterInvalidDemPixels);
      this.reconcileTerrainOverlays();
    }
    return result;
  }

  public async setRenderingTuning(
    tuning: SatelliteRenderingTuning,
    signal: AbortSignal,
  ): Promise<SatelliteImageryCommandResult> {
    if (
      !Number.isFinite(tuning.reflectanceMax) ||
      tuning.reflectanceMax < 2_000 ||
      tuning.reflectanceMax > 15_000 ||
      !Number.isFinite(tuning.gamma) ||
      tuning.gamma < 0.3 ||
      tuning.gamma > 4 ||
      !Number.isFinite(tuning.saturation) ||
      tuning.saturation < 0 ||
      tuning.saturation > 5
    ) {
      return { status: 'failed', message: 'Imagery tuning values are out of range.' };
    }
    const previousTuning = this.#renderingTuning;
    this.#renderingTuning = { ...tuning };
    if (this.#appliedScene === null) {
      this.persistStableState();
      return { status: 'success' };
    }
    const result = await this.applySceneInternal(this.#appliedScene, signal, false);
    if (result.status === 'failed') this.#renderingTuning = previousTuning;
    if (result.status === 'success') this.persistStableState();
    return result;
  }

  private async applySceneInternal(
    scene: SatelliteScene,
    signal: AbortSignal,
    persist: boolean,
  ): Promise<SatelliteImageryCommandResult> {
    this.cancelRasterRecovery();
    const map = this.#map;
    const sceneKey = satelliteSceneKey(scene);
    if (map === null) return this.applyFailure(sceneKey, 'The map is not ready yet.');
    if (scene.visualAsset.kind !== 'sentinel-rgb-cogs') {
      return this.applyFailure(
        sceneKey,
        'This scene has no supported true-color asset.',
      );
    }

    const sequence = ++this.#applySequence;
    const previousSceneKey =
      this.#appliedScene === null ? null : satelliteSceneKey(this.#appliedScene);
    const operation = new SentinelQueryOperation(
      this.idGenerator.generate(),
      this.diagnostics,
    );
    const startedAt = Date.now();
    mapLayerStore.setState({
      appliedImagery: {
        status: 'loading',
        sceneKey,
        previousSceneKey,
        stage: 'preparing',
        message: 'Preparing the selected Sentinel scene…',
        startedAt,
      },
      errorMessage: null,
    });

    const slot = this.#activeSlot === rasterSlots[0] ? rasterSlots[1] : rasterSlots[0];
    this.#stagingSourceId = slot.sourceId;
    try {
      operation.beginStep('select-visual-asset');
      const tileUrl = this.createTileUrl(scene.visualAsset.itemHref);
      const bounds = sceneBounds(scene);
      operation.completeStep();
      operation.beginStep('decode-reproject');
      this.updateLoadingProgress(
        sceneKey,
        previousSceneKey,
        'requesting-tiles',
        'Requesting true-color tiles from the imagery renderer…',
        startedAt,
      );
      this.removeSlot(map, slot);
      map.addSource(slot.sourceId, {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: this.renderer.tileSize,
        minzoom: this.renderer.minZoom,
        maxzoom: this.renderer.maxZoom,
        bounds,
        attribution: this.renderer.attribution,
      });
      map.addLayer(
        {
          id: slot.layerId,
          type: 'raster',
          source: slot.sourceId,
          layout: { visibility: 'visible' },
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 },
        },
        mapInsertionPoints.satelliteBeforeLayerId,
      );
      this.updateLoadingProgress(
        sceneKey,
        previousSceneKey,
        'rendering',
        'Downloading, reprojecting, and decoding visible map tiles…',
        startedAt,
      );
      await this.waitForSource(map, slot.sourceId, signal);
      if (sequence !== this.#applySequence || this.#map !== map) {
        throw new DOMException('Superseded imagery application.', 'AbortError');
      }
      operation.completeStep();
      operation.beginStep('apply-imagery');
      this.updateLoadingProgress(
        sceneKey,
        previousSceneKey,
        'finalizing',
        'Finalizing the raster and scene footprint…',
        startedAt,
      );
      const state = mapLayerStore.getState();
      map.setPaintProperty(slot.layerId, 'raster-opacity', 1);
      this.updateFootprint(map, scene);
      if (!state.visibility['scene-footprint']) {
        map.setLayoutProperty(sentinelMapLayerIds.footprint, 'visibility', 'none');
      }
      if (this.#activeSlot !== null) {
        this.cancelRasterRecovery(this.#activeSlot.sourceId);
        this.removeSlot(map, this.#activeSlot);
      }
      this.#activeSlot = slot;
      this.#stagingSourceId = null;
      this.#appliedScene = scene;
      this.reconcileTerrainOverlays();
      mapLayerStore.setState({
        appliedImagery: { status: 'ready', sceneKey, sceneId: scene.id, visible: true },
        visibility: { ...state.visibility, 'satellite-imagery': true },
        errorMessage: null,
      });
      this.applyMapVisualMode();
      operation.complete();
      if (persist) this.persistStableState();
      this.logger.log({
        level: 'info',
        name: 'satellite.imagery.applied',
        data: { sceneId: scene.id, status: 'ready' },
      });
      return { status: 'success' };
    } catch (error) {
      // A newer request can reuse the same inactive slot before this rejected
      // continuation runs. Only the current request may remove that shared slot.
      if (sequence === this.#applySequence) {
        this.cancelRasterRecovery(slot.sourceId);
        this.#stagingSourceId = null;
        this.removeSlot(map, slot);
      }
      if (signal.aborted || error instanceof DOMException) {
        operation.cancel();
        return { status: 'cancelled' };
      }
      operation.fail();
      const message =
        error instanceof SentinelRasterLoadError
          ? error.userMessage
          : 'The true-color image could not be rendered. The previous map remains available.';
      return this.applyFailure(sceneKey, message, previousSceneKey);
    }
  }

  public fitFootprint(): SatelliteImageryCommandResult {
    const map = this.#map;
    const scene = this.#appliedScene;
    if (map === null || scene === null) {
      return { status: 'failed', message: 'No applied scene is available to fit.' };
    }
    const bounds = sceneBounds(scene);
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: 56,
        duration: 500,
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
    );
    this.logger.log({ level: 'info', name: 'satellite.footprint.fit-requested' });
    return { status: 'success' };
  }

  private createTileUrl(itemUrl: string): string {
    const rendererUrl = this.renderer.tileUrlTemplate
      .replace('{itemUrl}', encodeURIComponent(itemUrl))
      .replaceAll(
        '{reflectanceMax}',
        String(Math.round(this.#renderingTuning.reflectanceMax)),
      )
      .replace('{gamma}', this.#renderingTuning.gamma.toFixed(2))
      .replace('{saturation}', this.#renderingTuning.saturation.toFixed(2));
    const separator = rendererUrl.includes('?') ? '&' : '?';
    // TiTiler's CloudFront distribution caches a reflected CORS header without varying
    // by Origin. Partitioning otherwise identical tiles prevents one site from serving
    // another site's Access-Control-Allow-Origin value.
    return this.renderer.cachePartition === 'application-origin'
      ? `${rendererUrl}${separator}application_origin=${applicationOriginCacheKey()}`
      : rendererUrl;
  }

  private updateLoadingProgress(
    sceneKey: string,
    previousSceneKey: string | null,
    stage: Extract<
      ReturnType<typeof mapLayerStore.getState>['appliedImagery'],
      { readonly status: 'loading' }
    >['stage'],
    message: string,
    startedAt: number,
  ): void {
    mapLayerStore.setState({
      appliedImagery: {
        status: 'loading',
        sceneKey,
        previousSceneKey,
        stage,
        message,
        startedAt,
      },
    });
  }

  private async restorePendingScene(): Promise<void> {
    const pending = this.#pendingRestore;
    if (
      pending === null ||
      this.#map === null ||
      !this.#map.isStyleLoaded() ||
      this.#restoreInProgress
    )
      return;
    const appliedScene = pending.appliedScene;
    if (appliedScene === null) {
      this.#pendingRestore = null;
      return;
    }
    this.#restoreInProgress = true;
    const controller = new AbortController();
    this.#restoreController = controller;
    let result: SatelliteImageryCommandResult | null = null;
    try {
      result = await this.applySceneInternal(appliedScene, controller.signal, false);
      if (result.status === 'success') {
        this.applyVisibility(pending.visibility);
        this.#pendingRestore = null;
      }
    } finally {
      if (this.#restoreController === controller) this.#restoreController = null;
      this.#restoreInProgress = false;
      if (
        result?.status === 'cancelled' &&
        this.#pendingRestore !== null &&
        this.isAttachedStyleReady()
      ) {
        void this.restorePendingScene();
      }
    }
  }

  private isAttachedStyleReady(): boolean {
    return this.#map !== null && this.#map.isStyleLoaded() === true;
  }

  private applyVisibility(visibility: MapLayerVisibilityPreferences): void {
    const map = this.#map;
    if (map === null) return;
    for (const layerId of [
      'satellite-imagery',
      'scene-footprint',
      'terrain-relief',
      'elevation-isolines',
      'natural-features',
      'restricted-areas',
      'hiking-paths',
      'roads',
      'places-and-pois',
    ] as const) {
      for (const nativeId of this.nativeLayerIds(layerId)) {
        if (map.getLayer(nativeId) !== undefined) {
          map.setLayoutProperty(
            nativeId,
            'visibility',
            visibility[layerId] ? 'visible' : 'none',
          );
        }
      }
    }
    const appliedImagery = this.withRasterVisibility(
      mapLayerStore.getState().appliedImagery,
      visibility['satellite-imagery'],
    );
    mapLayerStore.setState({ visibility, appliedImagery, errorMessage: null });
    this.applyMapVisualMode();
  }

  private persistStableState(): void {
    const appliedScene = this.#appliedScene;
    const { visibility, openStreetMapOpacity } = mapLayerStore.getState();
    const renderingTuning = { ...this.#renderingTuning };
    void this.preferences
      .saveMapLayerPreferences({
        visibility,
        openStreetMapOpacity,
        appliedScene,
        renderingTuning,
        terrainOverlays: { ...this.#terrainOverlayPreferences },
      })
      .catch(() => {
        this.logger.log({
          level: 'warn',
          name: 'storage.map-layers.save-failed',
        });
      });
  }

  private readonly handleStyleData = (): void => {
    this.reconcileTerrainOverlays();
    this.applyBaseLayerVisibility();
    this.applyMapVisualMode();
  };

  private readonly handleTerrainOverlayError = (event: MapLibreErrorEvent): void => {
    if (
      isCanceledMapRequest(event) ||
      sourceIdFromError(event) !== mapSourceIds.terrainContours ||
      this.#contourFailureReported
    ) {
      return;
    }
    this.#contourFailureReported = true;
    this.terrainOverlayFailure(
      'Elevation isolines could not be generated. Relief and the base map remain available.',
    );
  };

  private reconcileTerrainOverlays(): TerrainOverlayCommandResult {
    const map = this.#map;
    if (map === null) {
      return this.terrainOverlayFailure('The map is not ready yet.');
    }
    if (map.getLayer(mapLayerIds.background) === undefined) {
      return { status: 'success' };
    }
    try {
      const demTileUrl = this.contourTiles.createDemTileUrl();
      const existingDemSource = map.getSource(mapSourceIds.terrainDem);
      if (existingDemSource === undefined) {
        map.addSource(
          mapSourceIds.terrainDem,
          createTerrainDemSource(this.terrain, demTileUrl),
        );
        this.#appliedDemTileUrl = demTileUrl;
      } else if (this.#appliedDemTileUrl !== demTileUrl) {
        const source = existingDemSource as { setTiles?: (tiles: string[]) => void };
        if (source.setTiles === undefined) {
          throw new Error('The terrain source cannot update its tiles.');
        }
        source.setTiles([demTileUrl]);
        this.#appliedDemTileUrl = demTileUrl;
      }
      if (map.getLayer(terrainOverlayLayerIds.reliefShade) === undefined) {
        map.addLayer(
          {
            id: terrainOverlayLayerIds.reliefShade,
            type: 'hillshade',
            source: mapSourceIds.terrainDem,
            layout: {
              visibility: mapLayerStore.getState().visibility['terrain-relief']
                ? 'visible'
                : 'none',
            },
            paint: {
              ...mapVisualModePaint.vector[terrainOverlayLayerIds.reliefShade],
              'hillshade-shadow-color': mapVisualPalette.terrain.shadow,
              'hillshade-highlight-color': mapVisualPalette.terrain.highlight,
              'hillshade-accent-color': mapVisualPalette.terrain.accent,
              'hillshade-illumination-anchor': 'map',
            },
          },
          mapInsertionPoints.terrainOverlaysBeforeLayerId,
        );
        this.logger.log({ level: 'info', name: 'map.relief.initialized' });
      }
      const contourTileUrl = this.contourTiles.createTileUrl(
        this.#terrainOverlayPreferences.contourIntervalMeters,
      );
      const existingContourSource = map.getSource(mapSourceIds.terrainContours);
      if (existingContourSource === undefined) {
        map.addSource(mapSourceIds.terrainContours, {
          type: 'vector',
          tiles: [contourTileUrl],
          minzoom: this.terrain.overlays.contourMinZoom,
          maxzoom: this.terrain.overlays.contourMaxZoom,
          attribution: this.terrain.attribution,
        });
        this.#appliedContourTileUrl = contourTileUrl;
      } else if (this.#appliedContourTileUrl !== contourTileUrl) {
        const source = existingContourSource as {
          setTiles?: (tiles: string[]) => void;
        };
        if (source.setTiles === undefined) {
          throw new Error('The contour source cannot update its tiles.');
        }
        source.setTiles([contourTileUrl]);
        this.#appliedContourTileUrl = contourTileUrl;
      }
      this.ensureContourLayers(map);
      this.ensureContourOrder(map);
      const beforeId =
        !this.#terrainOverlayPreferences.shadeAboveSatellite &&
        this.#activeSlot !== null &&
        map.getLayer(this.#activeSlot.layerId) !== undefined
          ? this.#activeSlot.layerId
          : map.getLayer(terrainOverlayLayerIds.contourMinor) === undefined
            ? mapInsertionPoints.terrainOverlaysBeforeLayerId
            : terrainOverlayLayerIds.contourMinor;
      const layerIds = map.getStyle().layers.map((layer) => layer.id);
      const reliefIndex = layerIds.indexOf(terrainOverlayLayerIds.reliefShade);
      const beforeIndex = layerIds.indexOf(beforeId);
      const activeRasterIndex =
        this.#activeSlot === null ? -1 : layerIds.indexOf(this.#activeSlot.layerId);
      const orderIsCorrect = this.#terrainOverlayPreferences.shadeAboveSatellite
        ? activeRasterIndex < 0 ||
          (reliefIndex > activeRasterIndex && reliefIndex < beforeIndex)
        : reliefIndex >= 0 && reliefIndex < beforeIndex;
      if (!orderIsCorrect) map.moveLayer(terrainOverlayLayerIds.reliefShade, beforeId);
      mapLayerStore.setState({
        terrainOverlays: {
          initialized: true,
          preferences: { ...this.#terrainOverlayPreferences },
          message: null,
        },
      });
      if (!orderIsCorrect) {
        this.logger.log({
          level: 'info',
          name: 'map.relief.order-reconciled',
          data: {
            position: this.#terrainOverlayPreferences.shadeAboveSatellite
              ? 'above-satellite'
              : 'below-satellite',
          },
        });
      }
      return { status: 'success' };
    } catch {
      return this.terrainOverlayFailure(
        'Terrain relief could not be rendered. The base map remains available.',
      );
    }
  }

  private ensureContourLayers(map: MapLibreMap): void {
    const minzoom = this.terrain.overlays.contourMinZoom;
    if (map.getLayer(terrainOverlayLayerIds.contourMinor) === undefined) {
      map.addLayer(
        {
          id: terrainOverlayLayerIds.contourMinor,
          type: 'line',
          source: mapSourceIds.terrainContours,
          'source-layer': 'contours',
          minzoom,
          filter: ['==', ['get', 'level'], 0],
          layout: {
            visibility: mapLayerStore.getState().visibility['elevation-isolines']
              ? 'visible'
              : 'none',
          },
          paint: {
            'line-color': mapVisualPalette.terrain.contourMinor,
            ...mapVisualModePaint.vector[terrainOverlayLayerIds.contourMinor],
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              minzoom,
              0.42,
              this.terrain.overlays.contourMaxZoom,
              0.72,
            ],
          },
        },
        mapInsertionPoints.contoursBeforeLayerId,
      );
    }
    if (map.getLayer(terrainOverlayLayerIds.contourIndex) === undefined) {
      map.addLayer(
        {
          id: terrainOverlayLayerIds.contourIndex,
          type: 'line',
          source: mapSourceIds.terrainContours,
          'source-layer': 'contours',
          minzoom,
          filter: ['>', ['get', 'level'], 0],
          layout: {
            visibility: mapLayerStore.getState().visibility['elevation-isolines']
              ? 'visible'
              : 'none',
          },
          paint: {
            'line-color': mapVisualPalette.terrain.contourIndex,
            ...mapVisualModePaint.vector[terrainOverlayLayerIds.contourIndex],
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              minzoom,
              0.72,
              this.terrain.overlays.contourMaxZoom,
              1.15,
            ],
          },
        },
        mapInsertionPoints.contoursBeforeLayerId,
      );
    }
    if (map.getLayer(terrainOverlayLayerIds.contourLabels) === undefined) {
      map.addLayer(
        {
          id: terrainOverlayLayerIds.contourLabels,
          type: 'symbol',
          source: mapSourceIds.terrainContours,
          'source-layer': 'contours',
          minzoom,
          filter: ['>', ['get', 'level'], 0],
          layout: {
            visibility: mapLayerStore.getState().visibility['elevation-isolines']
              ? 'visible'
              : 'none',
            'symbol-placement': 'line',
            'symbol-spacing': 360,
            'text-field': [
              'concat',
              ['number-format', ['get', 'ele'], { 'max-fraction-digits': 0 }],
              ' m',
            ],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,
          },
          paint: {
            'text-color': mapVisualPalette.terrain.contourLabel,
            ...mapVisualModePaint.vector[terrainOverlayLayerIds.contourLabels],
            'text-halo-width': 1.2,
          },
        },
        mapInsertionPoints.contoursBeforeLayerId,
      );
    }
  }

  private ensureContourOrder(map: MapLibreMap): void {
    if (this.#activeSlot === null) return;
    const layerIds = map.getStyle().layers.map((layer) => layer.id);
    const rasterIndex = layerIds.indexOf(this.#activeSlot.layerId);
    const minorIndex = layerIds.indexOf(terrainOverlayLayerIds.contourMinor);
    const indexIndex = layerIds.indexOf(terrainOverlayLayerIds.contourIndex);
    const labelIndex = layerIds.indexOf(terrainOverlayLayerIds.contourLabels);
    const waterIndex = layerIds.indexOf(mapInsertionPoints.contoursBeforeLayerId);
    const orderIsCorrect =
      rasterIndex >= 0 &&
      minorIndex > rasterIndex &&
      indexIndex > minorIndex &&
      labelIndex > indexIndex &&
      labelIndex < waterIndex;
    if (orderIsCorrect) return;
    map.moveLayer(
      terrainOverlayLayerIds.contourMinor,
      mapInsertionPoints.contoursBeforeLayerId,
    );
    map.moveLayer(
      terrainOverlayLayerIds.contourIndex,
      mapInsertionPoints.contoursBeforeLayerId,
    );
    map.moveLayer(
      terrainOverlayLayerIds.contourLabels,
      mapInsertionPoints.contoursBeforeLayerId,
    );
  }

  private terrainOverlayFailure(message: string): TerrainOverlayCommandResult {
    mapLayerStore.setState({
      terrainOverlays: {
        initialized: false,
        preferences: { ...this.#terrainOverlayPreferences },
        message,
      },
    });
    this.logger.log({
      level: 'warn',
      name: 'map.terrain-overlays.failed',
      message,
    });
    return { status: 'failed', message };
  }

  private nativeLayerIds(layerId: LogicalMapLayerId): readonly string[] {
    if (layerId === 'satellite-imagery') {
      return this.#activeSlot === null ? [] : [this.#activeSlot.layerId];
    }
    if (layerId === 'scene-footprint') return [sentinelMapLayerIds.footprint];
    return logicalNativeLayerGroups[layerId];
  }

  private applyBaseLayerVisibility(): void {
    const map = this.#map;
    if (map === null) return;
    const { visibility } = mapLayerStore.getState();
    for (const layerId of [
      'terrain-relief',
      'elevation-isolines',
      'natural-features',
      'restricted-areas',
      'hiking-paths',
      'roads',
      'places-and-pois',
    ] as const) {
      for (const nativeId of logicalNativeLayerGroups[layerId]) {
        if (map.getLayer(nativeId) !== undefined) {
          map.setLayoutProperty(
            nativeId,
            'visibility',
            visibility[layerId] ? 'visible' : 'none',
          );
        }
      }
    }
  }

  private applyMapVisualMode(): void {
    const map = this.#map;
    if (map === null) return;
    const imagery = mapLayerStore.getState().appliedImagery;
    const mode: MapVisualMode =
      this.#activeSlot !== null && imagery.status !== 'hidden' ? 'satellite' : 'vector';
    const modePaint: MapVisualModePaint = mapVisualModePaint[mode];
    const layers = Object.entries(modePaint);
    const modeChanged = this.#appliedVisualMode !== mode;
    const layerChanged = layers.some(
      ([layerId]) =>
        map.getLayer(layerId) !== this.#visualModeLayerAnchors.get(layerId),
    );
    if (!modeChanged && !layerChanged) {
      this.applyOpenStreetMapOpacity();
      return;
    }
    this.#appliedVisualMode = mode;
    this.#visualModeLayerAnchors.clear();
    for (const [layerId, properties] of layers) {
      const layer = map.getLayer(layerId);
      if (layer === undefined) continue;
      this.#visualModeLayerAnchors.set(layerId, layer);
      for (const [property, value] of Object.entries(properties)) {
        map.setPaintProperty(layerId, property, value);
      }
    }
    this.applyOpenStreetMapOpacity(true);
  }

  private applyOpenStreetMapOpacity(force = false): void {
    const map = this.#map;
    if (map === null) return;
    const opacity = mapLayerStore.getState().openStreetMapOpacity;
    const layerChanged = Object.keys(openStreetMapOpacityProperties).some(
      (layerId) =>
        map.getLayer(layerId) !== this.#openStreetMapOpacityLayerAnchors.get(layerId),
    );
    if (!force && !layerChanged && this.#appliedOpenStreetMapOpacity === opacity)
      return;
    this.#appliedOpenStreetMapOpacity = opacity;
    this.#openStreetMapOpacityLayerAnchors.clear();
    const imagery = mapLayerStore.getState().appliedImagery;
    const mode: MapVisualMode =
      this.#activeSlot !== null && imagery.status !== 'hidden' ? 'satellite' : 'vector';
    const modePaint: MapVisualModePaint = mapVisualModePaint[mode];
    const effectiveOpacity = mode === 'satellite' ? opacity : 1;
    for (const [layerId, properties] of Object.entries(
      openStreetMapOpacityProperties,
    )) {
      const layer = map.getLayer(layerId);
      if (layer === undefined) continue;
      this.#openStreetMapOpacityLayerAnchors.set(layerId, layer);
      for (const property of properties) {
        const baseOpacity = modePaint[layerId]?.[property];
        map.setPaintProperty(
          layerId,
          property,
          effectiveOpacity * (typeof baseOpacity === 'number' ? baseOpacity : 1),
        );
      }
    }
  }

  private updateFootprint(map: MapLibreMap, scene: SatelliteScene): void {
    const data = {
      type: 'Feature' as const,
      properties: {},
      geometry: scene.footprint,
    };
    if (map.getLayer(sentinelMapLayerIds.footprint) !== undefined) {
      map.removeLayer(sentinelMapLayerIds.footprint);
    }
    if (map.getSource(mapSourceIds.sentinelFootprint) !== undefined) {
      map.removeSource(mapSourceIds.sentinelFootprint);
    }
    map.addSource(mapSourceIds.sentinelFootprint, { type: 'geojson', data });
    map.addLayer(
      {
        id: sentinelMapLayerIds.footprint,
        type: 'line',
        source: mapSourceIds.sentinelFootprint,
        paint: {
          'line-color': mapVisualPalette.userGeometry.satelliteFootprint,
          'line-width': 2.5,
          'line-opacity': 0.95,
        },
      },
      mapInsertionPoints.satelliteFootprintBeforeLayerId,
    );
  }

  private removeFootprint(map: MapLibreMap): void {
    if (map.getLayer(sentinelMapLayerIds.footprint) !== undefined) {
      map.removeLayer(sentinelMapLayerIds.footprint);
    }
    if (map.getSource(mapSourceIds.sentinelFootprint) !== undefined) {
      map.removeSource(mapSourceIds.sentinelFootprint);
    }
  }

  private waitForSource(
    map: MapLibreMap,
    sourceId: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted)
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    if (map.isSourceLoaded(sourceId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeout !== null) clearTimeout(timeout);
        if (stabilityTimer !== null) clearTimeout(stabilityTimer);
        signal.removeEventListener('abort', handleAbort);
        map.off('sourcedata', handleSourceData);
        map.off('error', handleError);
      };
      const succeed = () => {
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const handleAbort = () => {
        fail(new DOMException('Aborted', 'AbortError'));
      };
      const armTimeout = (additionalDelayMs = 0) => {
        if (timeout !== null) clearTimeout(timeout);
        timeout = setTimeout(() => {
          fail(
            new SentinelRasterLoadError(
              'The imagery renderer did not finish in time. The current map remains usable; try again.',
            ),
          );
        }, this.satelliteRendererTimeoutMs + additionalDelayMs);
      };
      const scheduleStableSuccess = (allowPartial: boolean) => {
        if (stabilityTimer !== null) return;
        stabilityTimer = setTimeout(() => {
          stabilityTimer = null;
          try {
            if (
              map.isSourceLoaded(sourceId) &&
              (allowPartial ||
                !this.#rasterRecoveries.has(sourceId) ||
                this.isRasterSourceRecoveryComplete(sourceId))
            ) {
              succeed();
            }
          } catch {
            // A superseding request can remove the staging source before its timer fires.
          }
        }, rasterSourceStabilityMs);
      };
      const handleSourceData = (event: MapSourceDataEvent) => {
        if (event.sourceId !== sourceId) return;
        const recoveredFailedTiles = this.handleRasterSourceData(event);
        const loaded = event.isSourceLoaded || map.isSourceLoaded(sourceId);
        if (loaded && (!this.#rasterRecoveries.has(sourceId) || recoveredFailedTiles))
          scheduleStableSuccess(false);
      };
      const handleError = (event: MapLibreErrorEvent) => {
        if (sourceIdFromError(event) !== sourceId) return;
        if (stabilityTimer !== null) clearTimeout(stabilityTimer);
        stabilityTimer = null;
        const recovery = this.handleRasterSourceFailure(event);
        if (recovery.state === 'not-retryable') {
          fail(new SentinelRasterLoadError(safeRasterFailureMessage(event)));
          return;
        }
        if (recovery.state === 'exhausted') {
          armTimeout(rasterSourceStabilityMs);
          scheduleStableSuccess(true);
          return;
        }
        if (recovery.state === 'scheduled') armTimeout(recovery.retryDelayMs);
      };
      signal.addEventListener('abort', handleAbort, { once: true });
      map.on('sourcedata', handleSourceData);
      map.on('error', handleError);
      armTimeout();
    });
  }

  private removeSlot(map: MapLibreMap, slot: RasterSlot): void {
    if (map.getLayer(slot.layerId) !== undefined) map.removeLayer(slot.layerId);
    if (map.getSource(slot.sourceId) !== undefined) map.removeSource(slot.sourceId);
  }

  private getOrCreateRasterRecovery(
    sourceId: string,
    details: ReturnType<typeof mapFailureDetails>,
  ): RasterRecoveryTracker {
    const existing = this.#rasterRecoveries.get(sourceId);
    if (existing !== undefined) return existing;
    const tracker: RasterRecoveryTracker = {
      attempts: 0,
      timer: null,
      pendingTiles: new Map<string, RasterTileCoordinate>(),
      hasUnscopedFailure: false,
      lastDetails: details,
      scheduledDelayMs: 0,
    };
    this.#rasterRecoveries.set(sourceId, tracker);
    return tracker;
  }

  private scheduleRasterRecovery(
    sourceId: string,
    tracker: RasterRecoveryTracker,
  ): RasterRecoveryRequest {
    const retryAttempt = tracker.attempts + 1;
    const delayMs =
      rasterRecoveryBaseDelayMs *
      2 ** tracker.attempts *
      (tracker.lastDetails.reason === 'rate-limit' ? 5 : 1);
    tracker.scheduledDelayMs = delayMs;
    tracker.timer = setTimeout(() => {
      tracker.timer = null;
      tracker.scheduledDelayMs = 0;
      const map = this.#map;
      if (map?.getSource(sourceId) === undefined) {
        this.cancelRasterRecovery(sourceId);
        return;
      }
      tracker.attempts = retryAttempt;
      const tileIds = [...tracker.pendingTiles.values()];
      try {
        map.refreshTiles(sourceId, tileIds.length === 0 ? undefined : tileIds);
        this.logger.log({
          level: 'info',
          name: 'satellite.imagery.retry-requested',
          data: {
            attempt: retryAttempt,
            count: tileIds.length,
            reason: tracker.lastDetails.reason,
            sourceId,
            ...(tracker.lastDetails.httpStatus === null
              ? {}
              : { status: tracker.lastDetails.httpStatus }),
          },
        });
      } catch {
        this.logger.log({
          level: 'warn',
          name: 'satellite.imagery.retry-failed',
          data: { attempt: retryAttempt, sourceId },
        });
      }
    }, delayMs);
    return { state: 'scheduled', retryAttempt, retryDelayMs: delayMs };
  }

  private tileCoordinateKey(coordinate: RasterTileCoordinate): string {
    return `${String(coordinate.z)}/${String(coordinate.x)}/${String(coordinate.y)}`;
  }

  private cancelRasterRecovery(sourceId?: string): void {
    if (sourceId !== undefined) {
      const tracker = this.#rasterRecoveries.get(sourceId);
      if (tracker?.timer !== null && tracker?.timer !== undefined) {
        clearTimeout(tracker.timer);
      }
      this.#rasterRecoveries.delete(sourceId);
      return;
    }
    for (const tracker of this.#rasterRecoveries.values()) {
      if (tracker.timer !== null) clearTimeout(tracker.timer);
    }
    this.#rasterRecoveries.clear();
  }

  private withRasterVisibility(
    snapshot: ReturnType<typeof mapLayerStore.getState>['appliedImagery'],
    visible: boolean,
  ): ReturnType<typeof mapLayerStore.getState>['appliedImagery'] {
    if (
      snapshot.status !== 'ready' &&
      snapshot.status !== 'preview' &&
      snapshot.status !== 'hidden'
    ) {
      return snapshot;
    }
    return visible
      ? {
          status: snapshot.status === 'preview' ? 'preview' : 'ready',
          sceneKey: snapshot.sceneKey,
          sceneId: snapshot.sceneId,
          visible: true,
        }
      : {
          status: 'hidden',
          sceneKey: snapshot.sceneKey,
          sceneId: snapshot.sceneId,
          visible: false,
        };
  }

  private visibilityFailure(message: string): MapLayerVisibilityResult {
    mapLayerStore.setState({ errorMessage: message });
    this.logger.log({ level: 'warn', name: 'map.layer.visibility-failed' });
    return { status: 'failed', message };
  }

  private applyFailure(
    sceneKey: string,
    message: string,
    previousSceneKey: string | null = null,
  ): SatelliteImageryCommandResult {
    mapLayerStore.setState({
      appliedImagery: { status: 'failed', sceneKey, previousSceneKey, message },
      errorMessage: message,
    });
    this.logger.log({
      level: 'warn',
      name: 'satellite.imagery.apply-failed',
      message,
    });
    return { status: 'failed', message };
  }
}
