import type {
  ErrorEvent as MapLibreErrorEvent,
  Map as MapLibreMap,
  MapSourceDataEvent,
} from 'maplibre-gl';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
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
} from '@/presentation/map/mapIds';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import type {
  SatelliteImageryCommandResult,
  SatelliteImageryMap,
} from '@/presentation/map/SatelliteImageryMap';

const rasterSlots = [
  { sourceId: mapSourceIds.sentinelRasterA, layerId: sentinelMapLayerIds.rasterA },
  { sourceId: mapSourceIds.sentinelRasterB, layerId: sentinelMapLayerIds.rasterB },
] as const;

export const logicalNativeLayerGroups: Readonly<
  Record<
    Exclude<LogicalMapLayerId, 'satellite-imagery' | 'scene-footprint'>,
    readonly string[]
  >
> = {
  'hiking-paths': [mapLayerIds.hikingPaths, mapLayerIds.hikingSteps],
  roads: [mapLayerIds.roadCasings, mapLayerIds.roads, mapLayerIds.roadLabels],
  'places-and-pois': [
    mapLayerIds.hikingPois,
    mapLayerIds.hikingPoiLabels,
    mapLayerIds.peaks,
    mapLayerIds.peakLabels,
    mapLayerIds.waterLabels,
    mapLayerIds.placeLabels,
  ],
};

type RasterSlot = (typeof rasterSlots)[number];

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

/**
 * Owns logical visibility plus the replaceable Sentinel raster/footprint sources on the
 * long-lived native map. Provider URLs stay inside this adapter and never enter state.
 */
export class MapLibreLayerController
  implements MapLayerVisibility, SatelliteImageryMap
{
  #map: MapLibreMap | null = null;
  #activeSlot: RasterSlot | null = null;
  #appliedScene: SatelliteScene | null = null;
  #applySequence = 0;

  public constructor(
    private readonly renderer: MapProviderConfiguration['satellite']['renderer'],
    private readonly logger: DiagnosticLogger,
    private readonly idGenerator: IdGenerator,
    private readonly diagnostics: SentinelQueryDiagnostics,
    private readonly requestTimeoutMs: number,
  ) {}

  public attach(map: MapLibreMap): void {
    this.#map = map;
    this.applyBaseLayerVisibility();
  }

  public detach(map: MapLibreMap): void {
    if (this.#map !== map) return;
    this.#map = null;
    this.#applySequence += 1;
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
    this.logger.log({
      level: 'info',
      name: 'map.layer.visibility-changed',
      data: { category: layerId, status: visible ? 'visible' : 'hidden' },
    });
    return { status: 'success' };
  }

  public async applyScene(
    scene: SatelliteScene,
    signal: AbortSignal,
  ): Promise<SatelliteImageryCommandResult> {
    const map = this.#map;
    const sceneKey = satelliteSceneKey(scene);
    if (map === null) return this.applyFailure(sceneKey, 'The map is not ready yet.');
    if (scene.visualAsset.kind !== 'cog') {
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
    mapLayerStore.setState({
      appliedImagery: { status: 'loading', sceneKey, previousSceneKey },
      errorMessage: null,
    });

    const slot = this.#activeSlot === rasterSlots[0] ? rasterSlots[1] : rasterSlots[0];
    try {
      operation.beginStep('select-visual-asset');
      const tileUrl = this.createTileUrl(scene.visualAsset.href);
      const bounds = sceneBounds(scene);
      operation.completeStep();
      operation.beginStep('decode-reproject');
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
      await this.waitForSource(map, slot.sourceId, signal);
      if (sequence !== this.#applySequence || this.#map !== map) {
        throw new DOMException('Superseded imagery application.', 'AbortError');
      }
      operation.completeStep();
      operation.beginStep('apply-imagery');
      const state = mapLayerStore.getState();
      map.setPaintProperty(slot.layerId, 'raster-opacity', 1);
      this.updateFootprint(map, scene);
      if (!state.visibility['scene-footprint']) {
        map.setLayoutProperty(sentinelMapLayerIds.footprint, 'visibility', 'none');
      }
      if (this.#activeSlot !== null) this.removeSlot(map, this.#activeSlot);
      this.#activeSlot = slot;
      this.#appliedScene = scene;
      mapLayerStore.setState({
        appliedImagery: { status: 'ready', sceneKey, sceneId: scene.id, visible: true },
        visibility: { ...state.visibility, 'satellite-imagery': true },
        errorMessage: null,
      });
      operation.complete();
      this.logger.log({
        level: 'info',
        name: 'satellite.imagery.applied',
        data: { sceneId: scene.id, status: 'ready' },
      });
      return { status: 'success' };
    } catch (error) {
      this.removeSlot(map, slot);
      if (signal.aborted || error instanceof DOMException) {
        operation.cancel();
        return { status: 'cancelled' };
      }
      operation.fail();
      return this.applyFailure(
        sceneKey,
        'The true-color image could not be rendered. The previous map remains available.',
        previousSceneKey,
      );
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

  private createTileUrl(assetUrl: string): string {
    return this.renderer.tileUrlTemplate.replace(
      '{assetUrl}',
      encodeURIComponent(assetUrl),
    );
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
    for (const layerId of ['hiking-paths', 'roads', 'places-and-pois'] as const) {
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
          'line-color': '#ff8c1a',
          'line-width': 2.5,
          'line-opacity': 0.95,
        },
      },
      mapInsertionPoints.satelliteFootprintBeforeLayerId,
    );
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
      const cleanup = () => {
        clearTimeout(timeout);
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
      const handleSourceData = (event: MapSourceDataEvent) => {
        if (
          event.sourceId === sourceId &&
          (event.isSourceLoaded || map.isSourceLoaded(sourceId))
        ) {
          succeed();
        }
      };
      const handleError = (event: MapLibreErrorEvent) => {
        if (sourceIdFromError(event) === sourceId) {
          fail(new Error('Sentinel raster source failed.'));
        }
      };
      const timeout = setTimeout(() => {
        fail(new Error('Sentinel raster source timed out.'));
      }, this.requestTimeoutMs);
      signal.addEventListener('abort', handleAbort, { once: true });
      map.on('sourcedata', handleSourceData);
      map.on('error', handleError);
    });
  }

  private removeSlot(map: MapLibreMap, slot: RasterSlot): void {
    if (map.getLayer(slot.layerId) !== undefined) map.removeLayer(slot.layerId);
    if (map.getSource(slot.sourceId) !== undefined) map.removeSource(slot.sourceId);
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
    this.logger.log({ level: 'warn', name: 'satellite.imagery.apply-failed' });
    return { status: 'failed', message };
  }
}
