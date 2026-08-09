import type { ErrorEvent as MapLibreErrorEvent, Map as MapLibreMap } from 'maplibre-gl';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SAVED_MARKER_SCHEMA_VERSION,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import {
  importedTrackLayerIds,
  mapLayerIds,
  mapSourceIds,
  satelliteBasemapLayerIds,
  savedMarkerLayerIds,
  sentinelMapLayerIds,
  terrainOverlayLayerIds,
} from '@/presentation/map/mapIds';
import * as markerCatalog from '@/presentation/markers/markerCatalog';
import { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import { mapVisualModePaint } from '@/presentation/map/mapVisualPalette';
import { createTestServices } from '@test/helpers/createTestServices';

type Listener = (event: never) => void;

class FakeLayerMap {
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly sources = new Map<string, unknown>();
  readonly images = new Map<string, unknown>();
  readonly layers = new Map<string, Record<string, unknown>>();
  readonly visibility = new Map<string, string>();
  readonly paint = new Map<string, unknown>();
  readonly paintProperties = new Map<string, unknown>();
  paintUpdateCount = 0;
  readonly moves: { readonly id: string; readonly beforeId?: string }[] = [];
  fitOptions: Record<string, unknown> | null = null;
  sourceLoaded = true;
  styleLoaded = true;
  directRasterSourceAdds = 0;
  readonly refreshTilesCalls: {
    readonly sourceId: string;
    readonly tileIds?: readonly {
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }[];
  }[] = [];

  public constructor() {
    for (const id of Object.values(mapLayerIds)) this.layers.set(id, { id });
    this.sources.set(mapSourceIds.satelliteBasemap, { type: 'raster' });
    const layers = [...this.layers.entries()];
    layers.splice(1, 0, [
      satelliteBasemapLayerIds.imagery,
      { id: satelliteBasemapLayerIds.imagery },
    ]);
    this.layers.clear();
    for (const [id, layer] of layers) this.layers.set(id, layer);
  }

  public on(type: string, listener: Listener): this {
    const listeners = this.#listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
    return this;
  }

  public off(type: string, listener: Listener): this {
    this.#listeners.get(type)?.delete(listener);
    return this;
  }

  public fire(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event as never);
  }

  public getLayer(id: string): unknown {
    return this.layers.get(id);
  }

  public addLayer(layer: Record<string, unknown>, beforeId?: string): void {
    const id = String(layer.id);
    if (beforeId === undefined || !this.layers.has(beforeId)) {
      this.layers.set(id, layer);
      return;
    }
    const reordered = [...this.layers.entries()];
    const beforeIndex = reordered.findIndex(([layerId]) => layerId === beforeId);
    reordered.splice(beforeIndex, 0, [id, layer]);
    this.layers.clear();
    for (const [layerId, value] of reordered) this.layers.set(layerId, value);
  }

  public moveLayer(id: string, beforeId?: string): void {
    if (!this.layers.has(id)) throw new Error(`Layer ${id} is unavailable.`);
    this.moves.push(beforeId === undefined ? { id } : { id, beforeId });
    const layer = this.layers.get(id);
    if (layer === undefined) return;
    const reordered = [...this.layers.entries()].filter(([layerId]) => layerId !== id);
    const beforeIndex = reordered.findIndex(([layerId]) => layerId === beforeId);
    reordered.splice(beforeIndex < 0 ? reordered.length : beforeIndex, 0, [id, layer]);
    this.layers.clear();
    for (const [layerId, value] of reordered) this.layers.set(layerId, value);
  }

  public hasImage(id: string): boolean {
    return this.images.has(id);
  }

  public addImage(id: string, image: unknown): void {
    this.images.set(id, image);
  }

  public removeImage(id: string): void {
    this.images.delete(id);
  }

  public getStyle(): {
    readonly sources: Record<string, unknown>;
    readonly layers: { readonly id: string }[];
  } {
    return {
      sources: Object.fromEntries(this.sources),
      layers: [...this.layers.keys()].map((id) => ({ id })),
    };
  }

  public removeLayer(id: string): void {
    this.layers.delete(id);
  }

  public setLayoutProperty(id: string, _name: string, value: unknown): void {
    this.visibility.set(id, String(value));
  }

  public setPaintProperty(id: string, name: string, value: unknown): void {
    if (!this.layers.has(id)) throw new Error(`Layer ${id} is unavailable.`);
    this.paint.set(id, value);
    this.paintProperties.set(`${id}.${name}`, value);
    this.paintUpdateCount += 1;
  }

  public getSource(id: string): unknown {
    return this.sources.get(id);
  }

  public addSource(id: string, source: unknown): void {
    if (
      typeof source === 'object' &&
      source !== null &&
      'type' in source &&
      source.type === 'geojson'
    ) {
      this.sources.set(id, {
        ...source,
        setData: (data: unknown) => {
          const current = this.sources.get(id);
          if (typeof current === 'object' && current !== null) {
            this.sources.set(id, { ...current, data });
          }
        },
      });
      return;
    }
    if (
      typeof source === 'object' &&
      source !== null &&
      'tiles' in source &&
      Array.isArray(source.tiles) &&
      source.tiles.some(
        (tile) => typeof tile === 'string' && tile.startsWith('test-satellite-cog:'),
      )
    ) {
      this.directRasterSourceAdds += 1;
    }
    this.sources.set(
      id,
      typeof source === 'object' && source !== null && 'tiles' in source
        ? {
            ...source,
            setTiles: (tiles: string[]) => {
              const current = this.sources.get(id);
              if (typeof current === 'object' && current !== null) {
                this.sources.set(id, { ...current, tiles });
              }
            },
          }
        : source,
    );
  }

  public removeSource(id: string): void {
    this.sources.delete(id);
  }

  public isSourceLoaded(id: string): boolean {
    return this.sourceLoaded && this.sources.has(id);
  }

  public isStyleLoaded(): boolean {
    return this.styleLoaded;
  }

  public refreshTiles(
    sourceId: string,
    tileIds?: readonly { readonly x: number; readonly y: number; readonly z: number }[],
  ): void {
    this.refreshTilesCalls.push(
      tileIds === undefined ? { sourceId } : { sourceId, tileIds },
    );
  }

  public fitBounds(_bounds: unknown, options: Record<string, unknown>): void {
    this.fitOptions = options;
  }

  public getBearing(): number {
    return 17;
  }

  public getPitch(): number {
    return 34;
  }
}

function scene(id: string): SatelliteScene {
  return {
    id,
    collection: 'sentinel-2-l2a',
    platform: 'sentinel-2a',
    productLevel: 'L2A',
    acquiredAt: '2026-07-12T10:12:00.000Z',
    cloudCoverPercent: 4,
    footprint: {
      type: 'Polygon',
      coordinates: [
        [
          [44, 42],
          [45, 42],
          [45, 43],
          [44, 43],
          [44, 42],
        ],
      ],
    },
    tileId: '38TMN',
    orbit: 'R036',
    productId: `S2A_${id}`,
    thumbnailHref: null,
    visualAsset: {
      kind: 'sentinel-l2a',
      itemHref: `https://earth-search.example.test/items/${id}`,
      visualHref: `https://sentinel.example.test/${id}/TCI.tif`,
      mediaType: 'image/tiff; application=geotiff; profile=cloud-optimized',
      projectionEpsg: 32638,
    },
    attribution: 'Synthetic test data',
  };
}

beforeEach(async () => {
  const services = createTestServices();
  await services.database.delete();
  resetMapLayerStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MapLibreLayerController', () => {
  it('retries an active satellite raster with bounded exponential recovery', async () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.setRenderingMode('server', new AbortController().signal);
    await controller.applyScene(scene('scene-retry'), new AbortController().signal);

    const event = {
      sourceId: 'sentinel-raster-a',
      tile: { tileID: { canonical: { x: 123, y: 456, z: 12 } } },
      error: {
        message: 'AJAXError: Service Unavailable (503): https://private.example/tile',
        status: 503,
      },
    } as unknown as Parameters<typeof controller.handleRasterSourceFailure>[0];
    expect(controller.handleRasterSourceFailure(event)).toEqual({
      state: 'scheduled',
      retryAttempt: 1,
      retryDelayMs: 1_000,
    });
    expect(controller.handleRasterSourceFailure(event)).toEqual({
      state: 'scheduled',
      retryAttempt: 1,
      retryDelayMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(map.refreshTilesCalls).toEqual([
      {
        sourceId: 'sentinel-raster-a',
        tileIds: [{ x: 123, y: 456, z: 12 }],
      },
    ]);
    expect(services.logger.getEvents().at(-1)).toMatchObject({
      name: 'satellite.imagery.retry-requested',
      data: { attempt: 1, count: 1, reason: 'http-server', status: 503 },
    });
    expect(JSON.stringify(services.logger.getEvents())).not.toContain(
      'private.example',
    );

    expect(controller.handleRasterSourceFailure(event)).toEqual({
      state: 'scheduled',
      retryAttempt: 2,
      retryDelayMs: 2_000,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.handleRasterSourceFailure(event)).toEqual({
      state: 'scheduled',
      retryAttempt: 3,
      retryDelayMs: 4_000,
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(map.refreshTilesCalls).toHaveLength(3);
    expect(controller.handleRasterSourceFailure(event)).toEqual({
      state: 'exhausted',
      retryAttempt: 3,
      retryDelayMs: 0,
    });

    controller.handleRasterSourceRecovered('sentinel-raster-a');
    expect(controller.handleRasterSourceFailure(event)).toEqual({
      state: 'scheduled',
      retryAttempt: 1,
      retryDelayMs: 1_000,
    });
  });

  it('requires successful data for the failed tile before declaring recovery', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(
      scene('scene-recovery-proof'),
      new AbortController().signal,
    );

    controller.handleRasterSourceFailure({
      sourceId: 'sentinel-raster-a',
      tile: { tileID: { canonical: { x: 123, y: 456, z: 12 } } },
      error: { message: 'AJAXError: Service Unavailable', status: 503 },
    } as never);

    expect(
      controller.handleRasterSourceData({
        sourceId: 'sentinel-raster-a',
        isSourceLoaded: true,
        sourceDataType: 'content',
        tile: { tileID: { canonical: { x: 124, y: 456, z: 12 } } },
      } as never),
    ).toBe(false);
    expect(
      controller.handleRasterSourceData({
        sourceId: 'sentinel-raster-a',
        isSourceLoaded: true,
        sourceDataType: 'content',
        tile: { tileID: { canonical: { x: 123, y: 456, z: 12 } } },
      } as never),
    ).toBe(true);
  });

  it('maps logical controls to allowlisted native style layers', () => {
    const services = createTestServices();
    const configuration = services.mapProviderConfiguration;
    expect(configuration.status).toBe('valid');
    if (configuration.status !== 'valid') return;
    const map = new FakeLayerMap();
    const controller = new MapLibreLayerController(
      configuration.value.satellite.renderer,
      configuration.value.terrain,
      {
        createDemTileUrl: () => 'test-dem://tiles/{z}/{x}/{y}',
        createTileUrl: (intervalMeters) =>
          `test-contour://tiles/{z}/{x}/{y}?minor=${String(intervalMeters)}&major=200`,
        setFilterEnabled: (enabled) => {
          void enabled;
        },
        setInteractionActive: () => undefined,
        getStatus: () => 'inline',
        getQueueState: () => ({
          executionMode: 'inline',
          activeCount: 0,
          queuedContourCount: 0,
          queueCapacity: 0,
        }),
        subscribeStatus: () => () => undefined,
        subscribeQueueState: () => () => undefined,
        subscribeMetrics: () => () => undefined,
        dispose: () => undefined,
      },
      {
        registerScene: () => undefined,
        createTileUrl: (sceneKey) =>
          `test-satellite-cog://tiles/${encodeURIComponent(sceneKey)}/{z}/{x}/{y}.webp`,
        dispose: () => undefined,
      },
      services.logger,
      services.idGenerator,
      services.sentinelQueryDiagnostics,
      services.database,
    );
    controller.attach(map as unknown as MapLibreMap);

    expect(controller.setLayerVisibility('roads', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(mapLayerIds.roadCasings)).toBe('none');
    expect(map.visibility.get(mapLayerIds.roads)).toBe('none');
    expect(map.visibility.get(mapLayerIds.roadLabels)).toBe('none');
    expect(map.visibility.get(mapLayerIds.hikingPaths)).toBe('visible');
    expect(mapLayerStore.getState().visibility.roads).toBe(false);

    expect(controller.setLayerVisibility('terrain-relief', false)).toEqual({
      status: 'success',
    });
    expect(controller.setLayerVisibility('elevation-isolines', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(terrainOverlayLayerIds.reliefShade)).toBe('none');
    expect(map.visibility.get(terrainOverlayLayerIds.contourMinor)).toBe('none');
    expect(map.visibility.get(terrainOverlayLayerIds.contourIndex)).toBe('none');
    expect(map.visibility.get(terrainOverlayLayerIds.contourLabels)).toBe('none');

    expect(controller.setLayerVisibility('natural-features', false)).toEqual({
      status: 'success',
    });
    expect(controller.setLayerVisibility('restricted-areas', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(mapLayerIds.landcover)).toBe('none');
    expect(map.visibility.get(mapLayerIds.glacierAreas)).toBe('none');
    expect(map.visibility.get(mapLayerIds.waterways)).toBe('none');
    expect(map.visibility.get(mapLayerIds.ridges)).toBe('none');
    expect(map.visibility.get(mapLayerIds.riverLabels)).toBe('none');
    expect(map.visibility.get(mapLayerIds.ridgeLabels)).toBe('none');
    expect(map.visibility.get(mapLayerIds.water)).toBe('none');
    expect(map.visibility.get(mapLayerIds.waterLabels)).toBe('none');
    expect(map.visibility.get(mapLayerIds.restrictedAreas)).toBe('none');
  });

  it('keeps Google and Sentinel imagery mutually exclusive and persists the active choice', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(
      scene('sentinel-before-google'),
      new AbortController().signal,
    );

    expect(controller.setLayerVisibility('google-satellite', true)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(satelliteBasemapLayerIds.imagery)).toBe('visible');
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('none');
    expect(mapLayerStore.getState()).toMatchObject({
      visibility: { 'google-satellite': true, 'satellite-imagery': false },
      appliedImagery: { status: 'hidden', visible: false },
    });

    expect(controller.setLayerVisibility('satellite-imagery', true)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(satelliteBasemapLayerIds.imagery)).toBe('none');
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('visible');
    expect(mapLayerStore.getState().visibility).toMatchObject({
      'google-satellite': false,
      'satellite-imagery': true,
    });

    expect(controller.setLayerVisibility('satellite-imagery', false)).toEqual({
      status: 'success',
    });
    expect(mapLayerStore.getState().visibility).toMatchObject({
      'google-satellite': false,
      'satellite-imagery': false,
    });
    expect(controller.setLayerVisibility('google-satellite', true)).toEqual({
      status: 'success',
    });
    expect(controller.setLayerVisibility('google-satellite', false)).toEqual({
      status: 'success',
    });
    expect(mapLayerStore.getState().visibility).toMatchObject({
      'google-satellite': false,
      'satellite-imagery': false,
    });

    expect(controller.setLayerVisibility('google-satellite', true)).toEqual({
      status: 'success',
    });
    await controller.applyScene(
      scene('sentinel-replaces-google'),
      new AbortController().signal,
    );
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        visibility: { 'google-satellite': false, 'satellite-imagery': true },
      });
    });
  });

  it('applies each map layer preset atomically without resetting independent layers', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('preset-scene'), new AbortController().signal);
    expect(controller.setLayerVisibility('roads', false)).toEqual({
      status: 'success',
    });
    const savePreferences = vi
      .spyOn(services.database, 'saveMapLayerPreferences')
      .mockResolvedValue(undefined);
    const log = vi.spyOn(services.logger, 'log');

    expect(controller.setMapLayerPreset('vector-osm')).toEqual({
      status: 'success',
    });
    expect(mapLayerStore.getState()).toMatchObject({
      visibility: {
        'google-satellite': false,
        'satellite-imagery': false,
        roads: false,
      },
      openStreetMapOpacity: 1,
      appliedImagery: { status: 'hidden', sceneId: 'preset-scene', visible: false },
    });
    expect(map.visibility.get(satelliteBasemapLayerIds.imagery)).toBe('none');
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('none');

    expect(controller.setMapLayerPreset('google-satellite-hybrid')).toEqual({
      status: 'success',
    });
    expect(mapLayerStore.getState()).toMatchObject({
      visibility: {
        'google-satellite': true,
        'satellite-imagery': false,
        roads: false,
      },
      openStreetMapOpacity: 1,
    });
    expect(map.visibility.get(satelliteBasemapLayerIds.imagery)).toBe('visible');
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('none');

    expect(controller.setMapLayerPreset('google-satellite')).toEqual({
      status: 'success',
    });
    expect(mapLayerStore.getState()).toMatchObject({
      visibility: {
        'google-satellite': true,
        'satellite-imagery': false,
        roads: false,
      },
      openStreetMapOpacity: 0,
    });

    expect(controller.setMapLayerPreset('sentinel-2-hybrid')).toEqual({
      status: 'success',
    });
    expect(mapLayerStore.getState()).toMatchObject({
      visibility: {
        'google-satellite': false,
        'satellite-imagery': true,
        roads: false,
      },
      openStreetMapOpacity: 1,
      appliedImagery: { status: 'ready', sceneId: 'preset-scene', visible: true },
    });
    expect(controller.getAppliedScene()).toMatchObject({ id: 'preset-scene' });
    expect(map.visibility.get(satelliteBasemapLayerIds.imagery)).toBe('none');
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('visible');
    expect(savePreferences).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenLastCalledWith({
      level: 'info',
      name: 'map.layer-preset.changed',
      data: { preset: 'sentinel-2-hybrid' },
    });
  });

  it('rejects the Sentinel preset without an applied scene or native changes', () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    const visibility = mapLayerStore.getState().visibility;
    const nativeVisibility = new Map(map.visibility);
    const savePreferences = vi
      .spyOn(services.database, 'saveMapLayerPreferences')
      .mockResolvedValue(undefined);

    expect(controller.setMapLayerPreset('sentinel-2-hybrid')).toEqual({
      status: 'failed',
      message: 'Apply a Sentinel scene before choosing this preset.',
    });
    expect(mapLayerStore.getState().visibility).toBe(visibility);
    expect(map.visibility).toEqual(nativeVisibility);
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it('preserves vector paints until Google source content arrives and orders relief around it', () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    expect(controller.setLayerVisibility('google-satellite', true)).toEqual({
      status: 'success',
    });
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(1);

    map.fire('sourcedata', {
      sourceId: mapSourceIds.satelliteBasemap,
      sourceDataType: 'content',
    });
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(
      mapVisualModePaint.satellite[mapLayerIds.landcover]['fill-opacity'],
    );
    const belowOrder = [...map.layers.keys()];
    expect(belowOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeLessThan(
      belowOrder.indexOf(satelliteBasemapLayerIds.imagery),
    );

    expect(
      controller.setTerrainOverlayPreferences({
        contourIntervalMeters: 50,
        filterInvalidDemPixels: true,
        shadeAboveSatellite: true,
      }),
    ).toEqual({ status: 'success' });
    const aboveOrder = [...map.layers.keys()];
    expect(aboveOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeGreaterThan(
      aboveOrder.indexOf(satelliteBasemapLayerIds.imagery),
    );
    expect(aboveOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeLessThan(
      aboveOrder.indexOf(terrainOverlayLayerIds.contourMinor),
    );
  });

  it('renders independent imported-track lines with shared visibility and opacity', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    expect(
      controller.setImportedTrackGeometry([
        [
          [44, 42],
          [44.1, 42.1],
        ],
        [
          [45, 43],
          [45.1, 43.1],
        ],
      ]),
    ).toEqual({ status: 'success' });

    const source = map.sources.get('imported-track');
    expect(source).toHaveProperty('data.geometry.coordinates', [
      [
        [44, 42],
        [44.1, 42.1],
      ],
      [
        [45, 43],
        [45.1, 43.1],
      ],
    ]);
    expect(map.layers.get(importedTrackLayerIds.casing)).toHaveProperty(
      'paint.line-width',
      7,
    );
    expect(map.layers.get(importedTrackLayerIds.line)).toHaveProperty(
      'paint.line-width',
      4,
    );
    expect(map.layers.get(importedTrackLayerIds.highlight)).toHaveProperty(
      'paint.line-width',
      4,
    );
    const importedTrackLineLayerIdsInOrder = [
      importedTrackLayerIds.casing,
      importedTrackLayerIds.line,
      importedTrackLayerIds.highlight,
    ].map((layerId) => [...map.layers.keys()].indexOf(layerId));
    expect(importedTrackLineLayerIdsInOrder).toEqual(
      [...importedTrackLineLayerIdsInOrder].sort((left, right) => left - right),
    );
    const labelLayerIds = [
      mapLayerIds.hikingPoiLabels,
      mapLayerIds.peakLabels,
      mapLayerIds.roadLabels,
      mapLayerIds.riverLabels,
      mapLayerIds.waterLabels,
      mapLayerIds.placeLabels,
    ];
    const labelLayerIndices = labelLayerIds.map((layerId) =>
      [...map.layers.keys()].indexOf(layerId),
    );
    expect(Math.max(...importedTrackLineLayerIdsInOrder)).toBeLessThan(
      Math.min(...labelLayerIndices),
    );
    expect([...map.layers.keys()].indexOf(importedTrackLayerIds.trace)).toBeGreaterThan(
      Math.max(...labelLayerIndices),
    );
    const moveCount = map.moves.length;
    map.fire('styledata', {});
    expect(map.moves).toHaveLength(moveCount);
    expect(controller.setImportedTrackOpacity(0.45)).toEqual({ status: 'success' });
    expect(map.paintProperties.get(`${importedTrackLayerIds.line}.line-opacity`)).toBe(
      0.45,
    );
    expect(
      map.paintProperties.get(`${importedTrackLayerIds.highlight}.line-opacity`),
    ).toBe(0.45);
    expect(controller.setLayerVisibility('imported-tracks', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(importedTrackLayerIds.casing)).toBe('none');
    expect(map.visibility.get(importedTrackLayerIds.line)).toBe('none');
    expect(map.visibility.get(importedTrackLayerIds.highlight)).toBe('none');
    expect(map.visibility.get(importedTrackLayerIds.trace)).toBe('none');
    await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
      visibility: { 'imported-tracks': false },
      importedTrackOpacity: 0.45,
    });

    controller.clearImportedTrackGeometry();
    expect(map.sources.get('imported-track')).toHaveProperty(
      'data.geometry.coordinates',
      [],
    );
  });

  it('renders and gates a multicolor imported-track grade zebra', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    const zebra = [
      {
        color: '#D6A100',
        coordinates: [
          [44.2, 42.2],
          [44.3, 42.3],
        ] as const,
      },
      {
        color: '#0F766E',
        coordinates: [
          [44.3, 42.3],
          [44.4, 42.4],
        ] as const,
      },
    ];
    controller.setImportedTrackHighlight(zebra);

    expect(map.sources.get('imported-track-highlight')).toHaveProperty(
      'data.features',
      [
        {
          type: 'Feature',
          properties: { color: '#D6A100' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [44.2, 42.2],
              [44.3, 42.3],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { color: '#0F766E' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [44.3, 42.3],
              [44.4, 42.4],
            ],
          },
        },
      ],
    );
    expect(map.layers.get(importedTrackLayerIds.highlight)).toMatchObject({
      type: 'line',
      source: 'imported-track-highlight',
      paint: { 'line-color': ['get', 'color'] },
    });
    expect(controller.setLayerVisibility('imported-tracks', true)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(importedTrackLayerIds.casing)).toBe('visible');
    expect(map.visibility.get(importedTrackLayerIds.line)).toBe('visible');
    expect(map.visibility.get(importedTrackLayerIds.highlight)).toBe('visible');
    expect(map.visibility.get(importedTrackLayerIds.trace)).toBe('visible');

    expect(controller.setLayerVisibility('track-elevation-gradient', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(importedTrackLayerIds.casing)).toBe('visible');
    expect(map.visibility.get(importedTrackLayerIds.line)).toBe('visible');
    expect(map.visibility.get(importedTrackLayerIds.highlight)).toBe('none');
    expect(map.visibility.get(importedTrackLayerIds.trace)).toBe('visible');

    expect(controller.setLayerVisibility('track-elevation-gradient', true)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(importedTrackLayerIds.highlight)).toBe('visible');

    expect(controller.setLayerVisibility('imported-tracks', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(importedTrackLayerIds.casing)).toBe('none');
    expect(map.visibility.get(importedTrackLayerIds.line)).toBe('none');
    expect(map.visibility.get(importedTrackLayerIds.highlight)).toBe('none');
    expect(map.visibility.get(importedTrackLayerIds.trace)).toBe('none');

    expect(controller.setLayerVisibility('track-elevation-gradient', false)).toEqual({
      status: 'success',
    });
    expect(controller.setLayerVisibility('track-elevation-gradient', true)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(importedTrackLayerIds.highlight)).toBe('none');

    expect(controller.setLayerVisibility('imported-tracks', true)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(importedTrackLayerIds.highlight)).toBe('visible');
    controller.attach(map as unknown as MapLibreMap);
    expect(map.visibility.get(importedTrackLayerIds.highlight)).toBe('visible');
    await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
      visibility: {
        'imported-tracks': true,
        'track-elevation-gradient': true,
      },
    });
    const paintUpdateCount = map.paintUpdateCount;
    controller.setImportedTrackHighlight(zebra);
    expect(map.paintUpdateCount).toBe(paintUpdateCount);

    controller.setImportedTrackHighlight(null);
    expect(map.sources.get('imported-track-highlight')).toHaveProperty(
      'data.features',
      [],
    );
  });

  it('moves and clears the imported-track trace point', () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    controller.setImportedTrackTracePoint([44.5, 42.5]);

    expect(map.sources.get('imported-track-trace')).toHaveProperty(
      'data.features.0.geometry.coordinates',
      [44.5, 42.5],
    );
    expect(map.layers.get(importedTrackLayerIds.trace)).toMatchObject({
      type: 'circle',
      source: 'imported-track-trace',
    });

    controller.setImportedTrackTracePoint(null);
    expect(map.sources.get('imported-track-trace')).toHaveProperty('data.features', []);
  });

  it('applies one opacity preference to every map reference layer over satellite imagery', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    expect(controller.setOpenStreetMapOpacity(0.5)).toEqual({ status: 'success' });
    expect(map.paintProperties.get(`${mapLayerIds.roads}.line-opacity`)).toBe(0.86);

    await controller.applyScene(scene('opacity-scene'), new AbortController().signal);

    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(0);
    expect(map.paintProperties.get(`${mapLayerIds.restrictedAreas}.line-opacity`)).toBe(
      0.4,
    );
    expect(map.paintProperties.get(`${mapLayerIds.waterways}.line-opacity`)).toBe(0.5);
    expect(map.paintProperties.get(`${mapLayerIds.boundaries}.line-opacity`)).toBe(
      0.35,
    );
    expect(map.paintProperties.get(`${mapLayerIds.roads}.line-opacity`)).toBe(0.48);
    expect(map.paintProperties.get(`${mapLayerIds.hikingPois}.circle-opacity`)).toBe(
      0.38,
    );
    expect(map.paintProperties.get(`${mapLayerIds.waterLabels}.text-opacity`)).toBe(
      0.5,
    );
    expect(map.paintProperties.get(`${mapLayerIds.riverLabels}.text-opacity`)).toBe(
      0.5,
    );
    expect(map.paintProperties.get(`${mapLayerIds.placeLabels}.text-opacity`)).toBe(
      0.5,
    );
    expect(
      map.paintProperties.get(`${terrainOverlayLayerIds.contourMinor}.line-opacity`),
    ).toBe(0.36);
    expect(
      map.paintProperties.get(`${terrainOverlayLayerIds.contourIndex}.line-opacity`),
    ).toBe(0.45);
    expect(
      map.paintProperties.get(`${terrainOverlayLayerIds.contourLabels}.text-opacity`),
    ).toBe(0.5);
    expect(mapLayerStore.getState().openStreetMapOpacity).toBe(0.5);
    await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
      openStreetMapOpacity: 0.5,
    });
  });

  it('creates one relief layer and deterministically orders it around satellite imagery', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();

    controller.attach(map as unknown as MapLibreMap);
    controller.attach(map as unknown as MapLibreMap);

    expect(map.sources.has('terrain-dem')).toBe(true);
    expect(map.layers.has('terrain-relief-shade')).toBe(true);
    expect(
      [...map.layers.keys()].filter((id) => id === 'terrain-relief-shade'),
    ).toHaveLength(1);

    await controller.applyScene(scene('scene-relief-a'), new AbortController().signal);
    const visibleOrder = [...map.layers.keys()];
    expect(visibleOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeLessThan(
      visibleOrder.indexOf(sentinelMapLayerIds.rasterA),
    );

    expect(controller.setLayerVisibility('satellite-imagery', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('none');
    const hiddenOrder = [...map.layers.keys()];
    for (const basemapLayerId of [
      mapLayerIds.landcover,
      mapLayerIds.glacierAreas,
      mapLayerIds.landuse,
    ]) {
      expect(hiddenOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeGreaterThan(
        hiddenOrder.indexOf(basemapLayerId),
      );
    }
    expect(
      hiddenOrder[hiddenOrder.indexOf(terrainOverlayLayerIds.reliefShade) + 1],
    ).toBe(terrainOverlayLayerIds.contourMinor);

    expect(controller.setLayerVisibility('satellite-imagery', true)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('visible');
    const restoredOrder = [...map.layers.keys()];
    expect(restoredOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeLessThan(
      restoredOrder.indexOf(sentinelMapLayerIds.rasterA),
    );

    expect(controller.setLayerVisibility('satellite-imagery', false)).toEqual({
      status: 'success',
    });
    await controller.applyScene(scene('scene-relief-b'), new AbortController().signal);
    expect(map.layers.get(sentinelMapLayerIds.rasterA)).toMatchObject({
      layout: { visibility: 'visible' },
    });
    expect(mapLayerStore.getState()).toMatchObject({
      appliedImagery: {
        status: 'ready',
        sceneId: 'scene-relief-b',
        visible: true,
      },
      visibility: { 'satellite-imagery': true },
    });
    const replacementOrder = [...map.layers.keys()];
    expect(replacementOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeLessThan(
      replacementOrder.indexOf(sentinelMapLayerIds.rasterA),
    );

    expect(
      controller.setTerrainOverlayPreferences({
        contourIntervalMeters: 50,
        filterInvalidDemPixels: true,
        shadeAboveSatellite: true,
      }),
    ).toEqual({ status: 'success' });
    const aboveOrder = [...map.layers.keys()];
    expect(aboveOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeGreaterThan(
      aboveOrder.indexOf(sentinelMapLayerIds.rasterA),
    );
    expect(aboveOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeLessThan(
      aboveOrder.indexOf(mapLayerIds.boundaries),
    );
    expect(aboveOrder.indexOf(terrainOverlayLayerIds.reliefShade)).toBeGreaterThan(
      aboveOrder.indexOf(mapLayerIds.landcover),
    );
    expect(mapLayerStore.getState().terrainOverlays).toMatchObject({
      initialized: true,
      preferences: { shadeAboveSatellite: true },
    });
  });

  it('renders bounded minor, index, and labeled contours and updates their interval atomically', () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    const contourSource = map.sources.get('terrain-contours') as {
      readonly tiles: readonly string[];
      readonly minzoom: number;
      readonly maxzoom: number;
    };
    expect(contourSource).toMatchObject({ minzoom: 11, maxzoom: 15 });
    expect(contourSource.tiles[0]).toContain('minor=50&major=200');
    expect(map.layers.get('terrain-contour-minor')).toMatchObject({
      minzoom: 11,
      filter: ['==', ['get', 'level'], 0],
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.42, 15, 0.72],
      },
    });
    expect(map.layers.get('terrain-contour-index')).toMatchObject({
      filter: ['>', ['get', 'level'], 0],
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.72, 15, 1.15],
      },
    });
    expect(map.layers.get('terrain-contour-labels')).toMatchObject({
      filter: ['>', ['get', 'level'], 0],
    });
    const layerOrder = [...map.layers.keys()];
    expect(layerOrder.indexOf(terrainOverlayLayerIds.contourMinor)).toBeGreaterThan(
      layerOrder.indexOf(mapLayerIds.waterways),
    );
    expect(layerOrder.indexOf(terrainOverlayLayerIds.contourLabels)).toBeLessThan(
      layerOrder.indexOf(mapLayerIds.water),
    );

    expect(
      controller.setTerrainOverlayPreferences({
        contourIntervalMeters: 25,
        filterInvalidDemPixels: true,
        shadeAboveSatellite: false,
      }),
    ).toEqual({ status: 'success' });
    const updatedSource = map.sources.get('terrain-contours') as {
      readonly tiles: readonly string[];
    };
    expect(updatedSource.tiles[0]).toContain('minor=25&major=200');
    expect(map.layers.has('terrain-contour-minor')).toBe(true);
  });

  it('reloads the shared DEM and contour sources when filtering changes', () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    expect(map.sources.get('terrain-dem')).toMatchObject({
      tiles: [expect.stringContaining('filter=on')],
    });
    expect(map.sources.get('terrain-contours')).toMatchObject({
      tiles: [expect.stringContaining('filter=on')],
    });

    expect(
      controller.setTerrainOverlayPreferences({
        contourIntervalMeters: 50,
        filterInvalidDemPixels: false,
        shadeAboveSatellite: false,
      }),
    ).toEqual({ status: 'success' });

    expect(map.sources.get('terrain-dem')).toMatchObject({
      tiles: [expect.stringContaining('filter=off')],
    });
    expect(map.sources.get('terrain-contours')).toMatchObject({
      tiles: [expect.stringContaining('filter=off')],
    });
    expect(controller.getTerrainOverlayPreferences().filterInvalidDemPixels).toBe(
      false,
    );
  });

  it('applies a georeferenced tile source, footprint, visibility, and fit command', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    expect(controller).not.toBeNull();
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    await expect(
      controller.applyScene(scene('scene-a'), new AbortController().signal),
    ).resolves.toEqual({ status: 'success' });

    const raster = map.sources.get('sentinel-raster-a') as {
      readonly tiles: readonly string[];
      readonly bounds: readonly number[];
    };
    expect(raster.tiles[0]).toContain('titiler.xyz/stac/tiles/WebMercatorQuad');
    expect(raster.tiles[0]).toContain(
      encodeURIComponent('https://earth-search.example.test/items/scene-a'),
    );
    const originCacheKey = `${window.location.protocol}-${window.location.host}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
    expect(raster.tiles[0]).toContain(`application_origin=${originCacheKey}`);
    expect(raster.bounds).toEqual([44, 42, 45, 43]);
    expect(map.layers.has(sentinelMapLayerIds.footprint)).toBe(true);
    expect(mapLayerStore.getState().appliedImagery).toMatchObject({
      status: 'ready',
      sceneId: 'scene-a',
    });
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(
      mapVisualModePaint.satellite[mapLayerIds.landcover]['fill-opacity'],
    );
    expect(
      map.paintProperties.get(`${terrainOverlayLayerIds.contourIndex}.line-opacity`),
    ).toBe(
      mapVisualModePaint.satellite[terrainOverlayLayerIds.contourIndex]['line-opacity'],
    );
    const paintUpdates = map.paintUpdateCount;
    map.fire('styledata', {});
    expect(map.paintUpdateCount).toBe(paintUpdates);

    expect(controller.setLayerVisibility('satellite-imagery', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('none');
    expect(mapLayerStore.getState().appliedImagery.status).toBe('hidden');
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(
      mapVisualModePaint.vector[mapLayerIds.landcover]['fill-opacity'],
    );

    await expect(
      controller.applyScene(scene('scene-b'), new AbortController().signal),
    ).resolves.toEqual({ status: 'success' });
    expect(map.layers.has(sentinelMapLayerIds.rasterA)).toBe(true);
    expect(map.layers.has(sentinelMapLayerIds.rasterB)).toBe(false);
    expect(mapLayerStore.getState()).toMatchObject({
      appliedImagery: { status: 'ready', sceneId: 'scene-b' },
      visibility: { 'satellite-imagery': true },
    });

    expect(controller.fitFootprint()).toEqual({ status: 'success' });
    expect(map.fitOptions).toMatchObject({ bearing: 17, pitch: 34, padding: 56 });
  });

  it('adds the application-origin cache partition only when the renderer opts in', async () => {
    const services = createTestServices();
    const configuration = services.mapProviderConfiguration;
    if (configuration.status !== 'valid') return;
    const map = new FakeLayerMap();
    const controller = new MapLibreLayerController(
      {
        ...configuration.value.satellite.renderer,
        cachePartition: 'none',
      },
      configuration.value.terrain,
      {
        createDemTileUrl: () => 'test-dem://tiles/{z}/{x}/{y}',
        createTileUrl: () => 'test-contour://tiles/{z}/{x}/{y}',
        setFilterEnabled: () => undefined,
        setInteractionActive: () => undefined,
        getStatus: () => 'worker',
        getQueueState: () => ({
          executionMode: 'worker',
          activeCount: 0,
          queuedContourCount: 0,
          queueCapacity: 32,
        }),
        subscribeStatus: () => () => undefined,
        subscribeQueueState: () => () => undefined,
        subscribeMetrics: () => () => undefined,
        dispose: () => undefined,
      },
      {
        registerScene: () => undefined,
        createTileUrl: (sceneKey) =>
          `test-satellite-cog://tiles/${encodeURIComponent(sceneKey)}/{z}/{x}/{y}.webp`,
        dispose: () => undefined,
      },
      services.logger,
      services.idGenerator,
      services.sentinelQueryDiagnostics,
      services.database,
    );
    controller.attach(map as unknown as MapLibreMap);

    await controller.applyScene(
      scene('scene-without-partition'),
      new AbortController().signal,
    );

    const raster = map.sources.get('sentinel-raster-a') as {
      readonly tiles: readonly string[];
    };
    expect(raster.tiles[0]).not.toContain('application_origin=');
  });

  it('removes the prior scene immediately when a replacement source fails', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('scene-a'), new AbortController().signal);
    map.sourceLoaded = false;

    const replacement = controller.applyScene(
      scene('scene-b'),
      new AbortController().signal,
    );
    map.fire('error', {
      sourceId: 'sentinel-raster-a',
      error: { message: 'private provider detail' },
    });

    await expect(replacement).resolves.toEqual({
      status: 'failed',
      message:
        'The imagery renderer did not return a usable tile. The current map remains usable; retry or reset the imagery stretch.',
    });
    expect(map.layers.has(sentinelMapLayerIds.rasterA)).toBe(false);
    expect(map.layers.has(sentinelMapLayerIds.rasterB)).toBe(false);
    expect(mapLayerStore.getState().appliedImagery).toMatchObject({
      status: 'failed',
      previousSceneKey: null,
    });
    expect(JSON.stringify(services.logger.getEvents())).not.toContain(
      'private provider detail',
    );
  });

  it('does not let an aborted request remove the replacement that superseded it', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('scene-a'), new AbortController().signal);
    map.sourceLoaded = false;

    const staleController = new AbortController();
    const staleRequest = controller.applyScene(
      scene('scene-b'),
      staleController.signal,
    );
    staleController.abort();
    const currentRequest = controller.applyScene(
      scene('scene-c'),
      new AbortController().signal,
    );

    await expect(staleRequest).resolves.toEqual({ status: 'cancelled' });
    expect(map.layers.has(sentinelMapLayerIds.rasterA)).toBe(true);
    map.sourceLoaded = true;
    map.fire('sourcedata', {
      sourceId: 'sentinel-raster-a',
      isSourceLoaded: true,
      sourceDataType: 'content',
    });

    await expect(currentRequest).resolves.toEqual({ status: 'success' });
    expect(mapLayerStore.getState().appliedImagery).toMatchObject({
      status: 'ready',
      sceneId: 'scene-c',
    });
  });

  it('de-applies the current scene without writing scene data to preferences', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('scene-to-clear'), new AbortController().signal);

    expect(controller.clearScene()).toEqual({ status: 'success' });

    expect(controller.getAppliedScene()).toBeNull();
    expect(map.layers.has(sentinelMapLayerIds.rasterA)).toBe(false);
    expect(map.sources.has('sentinel-raster-a')).toBe(false);
    expect(map.layers.has(sentinelMapLayerIds.footprint)).toBe(false);
    expect(mapLayerStore.getState().appliedImagery).toEqual({ status: 'empty' });
    expect(mapLayerStore.getState().automaticAlternativeProviderState).toBe('inactive');
    await waitFor(async () => {
      await expect(services.database.settings.get('map.layers')).resolves.toBeDefined();
    });
    await expect(
      services.database.settings.get('map.layers'),
    ).resolves.not.toHaveProperty('value.appliedScene');
  });

  it('publishes the selected scene before its replacement raster finishes', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    map.sourceLoaded = false;
    controller.attach(map as unknown as MapLibreMap);
    const selectedScene = scene('selected-while-rendering');

    const application = controller.applyScene(
      selectedScene,
      new AbortController().signal,
    );

    expect(controller.getSelectedScene()).toEqual(selectedScene);
    expect(mapLayerStore.getState().selectedScene).toEqual(selectedScene);
    expect(mapLayerStore.getState().appliedImagery).toMatchObject({
      status: 'loading',
      sceneKey: 'sentinel-2-l2a:selected-while-rendering',
    });
    map.sourceLoaded = true;
    map.fire('sourcedata', { sourceId: 'sentinel-raster-a', isSourceLoaded: true });
    await expect(application).resolves.toEqual({ status: 'success' });
  });

  it('reports a safe actionable reason when the renderer rejects a tile request', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('scene-a'), new AbortController().signal);
    map.sourceLoaded = false;

    const replacement = controller.applyScene(
      scene('scene-b'),
      new AbortController().signal,
    );
    map.fire('error', {
      sourceId: 'sentinel-raster-a',
      error: {
        message:
          'AJAXError: 400 Bad Request: https://renderer.example/private-item-and-token',
      },
    });

    await expect(replacement).resolves.toEqual({
      status: 'failed',
      message:
        'The imagery renderer rejected these stretch values (HTTP 400). Reset the imagery stretch or try less extreme values.',
    });
    const diagnosticText = JSON.stringify(services.logger.getEvents());
    expect(diagnosticText).toContain('rejected these stretch values');
    expect(diagnosticText).not.toContain('private-item-and-token');
  });

  it('uses only the direct visual COG when direct rendering is selected', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    await expect(
      controller.setRenderingMode('direct', new AbortController().signal),
    ).resolves.toEqual({ status: 'success' });
    await expect(
      controller.applyScene(scene('direct-only'), new AbortController().signal),
    ).resolves.toEqual({ status: 'success' });

    const raster = map.sources.get('sentinel-raster-a') as {
      readonly tiles: readonly string[];
    };
    expect(raster.tiles).toEqual([
      expect.stringContaining('test-satellite-cog://tiles/'),
    ]);
    expect(raster.tiles[0]).not.toContain('titiler');
    expect(mapLayerStore.getState().automaticAlternativeProviderState).toBe('inactive');
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        satelliteRenderingMode: 'direct',
      });
    });
  });

  it('keeps direct rendering pending without imposing a render timeout', async () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.setRenderingMode('direct', new AbortController().signal);
    map.sourceLoaded = false;

    const abortController = new AbortController();
    const request = controller.applyScene(
      scene('slow-direct-render'),
      abortController.signal,
    );
    expect(
      (
        map.layers.get(sentinelMapLayerIds.rasterA)?.paint as
          Record<string, unknown> | undefined
      )?.['raster-opacity'],
    ).toBe(1);
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(
      mapVisualModePaint.vector[mapLayerIds.landcover]['fill-opacity'],
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mapLayerStore.getState().appliedImagery.status).toBe('loading');
    abortController.abort();
    await expect(request).resolves.toEqual({ status: 'cancelled' });
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(
      mapVisualModePaint.vector[mapLayerIds.landcover]['fill-opacity'],
    );
  });

  it('keeps server mode on TiTiler without direct fallback', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.setRenderingMode('server', new AbortController().signal);
    await controller.applyScene(scene('scene-a'), new AbortController().signal);
    map.sourceLoaded = false;

    const replacement = controller.applyScene(
      scene('server-only'),
      new AbortController().signal,
    );
    expect(
      map.paintProperties.get(`${sentinelMapLayerIds.rasterA}.raster-opacity`),
    ).toBe(1);
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(
      mapVisualModePaint.vector[mapLayerIds.landcover]['fill-opacity'],
    );
    map.fire('error', {
      sourceId: 'sentinel-raster-a',
      error: { message: 'AJAXError: Too Many Requests', status: 429 },
    });

    await expect(replacement).resolves.toEqual({
      status: 'failed',
      message:
        'The imagery renderer is rate-limiting requests (HTTP 429). The current map remains usable; wait briefly, then retry.',
    });
    expect(map.directRasterSourceAdds).toBe(0);
    expect(map.refreshTilesCalls).toHaveLength(0);
  });

  it('cancels and restarts an in-flight scene when rendering mode changes', async () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const savePreferences = vi
      .spyOn(services.database, 'saveMapLayerPreferences')
      .mockResolvedValue(undefined);
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    map.sourceLoaded = false;

    const initial = controller.applyScene(
      scene('midflight-mode-change'),
      new AbortController().signal,
    );
    const switched = controller.setRenderingMode(
      'direct',
      new AbortController().signal,
    );

    await expect(initial).resolves.toEqual({ status: 'cancelled' });
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ satelliteRenderingMode: 'direct' }),
    );
    const raster = map.sources.get('sentinel-raster-a') as {
      readonly tiles: readonly string[];
    };
    expect(raster.tiles).toEqual([
      expect.stringContaining('test-satellite-cog://tiles/'),
    ]);
    map.sourceLoaded = true;
    map.fire('sourcedata', {
      sourceId: 'sentinel-raster-a',
      isSourceLoaded: true,
      sourceDataType: 'content',
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(switched).resolves.toEqual({ status: 'success' });
    expect(controller.getRenderingMode()).toBe('direct');
    expect(controller.getAppliedScene()?.id).toBe('midflight-mode-change');
  });

  it('removes the active provider layer before rendering the same scene in another mode', async () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(
      scene('provider-mode-change'),
      new AbortController().signal,
    );
    map.sourceLoaded = false;

    const switched = controller.setRenderingMode(
      'direct',
      new AbortController().signal,
    );

    expect(map.layers.has(sentinelMapLayerIds.rasterA)).toBe(true);
    expect(map.layers.has(sentinelMapLayerIds.rasterB)).toBe(false);
    expect(map.sources.has('sentinel-raster-a')).toBe(true);
    expect(map.sources.has('sentinel-raster-b')).toBe(false);
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(
      mapVisualModePaint.vector[mapLayerIds.landcover]['fill-opacity'],
    );
    map.sourceLoaded = true;
    map.fire('sourcedata', {
      sourceId: 'sentinel-raster-a',
      isSourceLoaded: true,
      sourceDataType: 'content',
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(switched).resolves.toEqual({ status: 'success' });
    expect(controller.getAppliedScene()?.id).toBe('provider-mode-change');
  });

  it('marks late unscoped direct-render errors as expected after switching to auto', async () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.setRenderingMode('direct', new AbortController().signal);
    await controller.applyScene(scene('direct-to-auto'), new AbortController().signal);

    await controller.setRenderingMode('auto', new AbortController().signal);
    const lateError = {
      error: { message: 'Failed to load canceled custom protocol tile.' },
    } as unknown as Parameters<typeof controller.isExpectedRasterCancellation>[0];
    expect(controller.isExpectedRasterCancellation(lateError)).toBe(true);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(controller.isExpectedRasterCancellation(lateError)).toBe(false);
  });

  it('switches a CORS-opaque TiTiler failure to direct visual imagery', async () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('scene-a'), new AbortController().signal);
    map.sourceLoaded = false;

    const replacement = controller.applyScene(
      scene('scene-b'),
      new AbortController().signal,
    );
    map.fire('error', {
      sourceId: 'sentinel-raster-a',
      tile: { tileID: { canonical: { x: 123, y: 456, z: 12 } } },
      error: { message: 'AJAXError: Failed to fetch', status: 0 },
    });
    await Promise.resolve();

    expect(map.refreshTilesCalls).toHaveLength(0);
    expect(map.directRasterSourceAdds).toBe(1);
    expect(
      map.paintProperties.get(`${sentinelMapLayerIds.rasterA}.raster-opacity`),
    ).toBe(1);
    expect(map.paintProperties.get(`${mapLayerIds.landcover}.fill-opacity`)).toBe(
      mapVisualModePaint.vector[mapLayerIds.landcover]['fill-opacity'],
    );
    expect(
      (map.sources.get('sentinel-raster-a') as { readonly tiles: readonly string[] })
        .tiles[0],
    ).toContain('test-satellite-cog://tiles/');

    map.sourceLoaded = true;
    map.fire('sourcedata', {
      sourceId: 'sentinel-raster-a',
      isSourceLoaded: true,
      sourceDataType: 'content',
      // MapLibre can request a different tile set after switching templates.
      tile: { tileID: { canonical: { x: 61, y: 92, z: 11 } } },
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(replacement).resolves.toEqual({ status: 'success' });
    expect(mapLayerStore.getState().appliedImagery).toMatchObject({
      status: 'ready',
      sceneId: 'scene-b',
    });
  });

  it('switches a source-less TiTiler 429 to direct visual imagery', async () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('scene-a'), new AbortController().signal);
    map.sourceLoaded = false;

    const replacement = controller.applyScene(
      scene('scene-b'),
      new AbortController().signal,
    );
    const failureEvent = {
      tile: { tileID: { canonical: { x: 123, y: 456, z: 12 } } },
      error: { message: 'AJAXError: Too Many Requests', status: 429 },
    };
    map.fire('error', failureEvent);
    await Promise.resolve();

    expect(map.refreshTilesCalls).toHaveLength(0);
    expect(map.directRasterSourceAdds).toBe(1);
    expect(
      controller.handleRasterSourceFailure(
        failureEvent as unknown as MapLibreErrorEvent,
      ),
    ).toEqual({
      state: 'alternative-provider',
      retryAttempt: 0,
      retryDelayMs: 0,
    });
    expect(map.directRasterSourceAdds).toBe(1);
    expect(
      controller.handleRasterSourceFailure({
        error: {
          message: 'AJAXError: Too Many Requests',
          status: 429,
          url: 'https://titiler.xyz/stac/tiles/WebMercatorQuad/12/123/456.webp',
        },
      } as unknown as MapLibreErrorEvent),
    ).toEqual({
      state: 'alternative-provider',
      retryAttempt: 0,
      retryDelayMs: 0,
    });
    expect(map.directRasterSourceAdds).toBe(1);
    map.sourceLoaded = true;
    map.fire('sourcedata', {
      sourceId: 'sentinel-raster-a',
      isSourceLoaded: true,
      sourceDataType: 'content',
      // The replacement template is allowed to settle with a different tile set.
      tile: { tileID: { canonical: { x: 61, y: 92, z: 11 } } },
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(replacement).resolves.toEqual({ status: 'success' });
    expect(controller.getAppliedScene()?.id).toBe('scene-b');
    expect(mapLayerStore.getState().automaticAlternativeProviderState).toBe('active');
  });

  it('switches to direct imagery after bounded TiTiler retries are exhausted', async () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('scene-a'), new AbortController().signal);
    map.sourceLoaded = false;

    const replacement = controller.applyScene(
      scene('scene-b'),
      new AbortController().signal,
    );
    const event = {
      sourceId: 'sentinel-raster-a',
      error: { message: 'AJAXError: Service Unavailable', status: 503 },
    };
    map.fire('error', event);
    await vi.advanceTimersByTimeAsync(1_000);
    map.fire('error', event);
    await vi.advanceTimersByTimeAsync(2_000);
    map.fire('error', event);
    await vi.advanceTimersByTimeAsync(4_000);
    map.fire('error', event);
    expect(map.directRasterSourceAdds).toBe(1);
    map.sourceLoaded = true;
    map.fire('sourcedata', {
      sourceId: 'sentinel-raster-a',
      isSourceLoaded: true,
      sourceDataType: 'content',
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(replacement).resolves.toEqual({ status: 'success' });
    expect(mapLayerStore.getState().appliedImagery).toMatchObject({
      status: 'ready',
      sceneId: 'scene-b',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(map.refreshTilesCalls).toHaveLength(3);
    expect(mapLayerStore.getState().automaticAlternativeProviderState).toBe('active');
  });

  it('restores presentation preferences without restoring satellite imagery', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    await services.database.saveMapLayerPreferences({
      visibility: {
        'google-satellite': false,
        'satellite-imagery': false,
        'scene-footprint': true,
        'terrain-relief': false,
        'elevation-isolines': false,
        'natural-features': true,
        'restricted-areas': false,
        'hiking-paths': true,
        roads: false,
        'places-and-pois': true,
        'imported-tracks': false,
        'track-elevation-gradient': false,
      },
      openStreetMapOpacity: 0.55,
      importedTrackOpacity: 0.6,
      satelliteRenderingMode: 'auto',
      renderingTuning: { reflectanceMax: 6_500, gamma: 1.6, saturation: 1.2 },
      terrainOverlays: {
        contourIntervalMeters: 25,
        filterInvalidDemPixels: false,
        shadeAboveSatellite: true,
      },
    });
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    await controller.restorePersistedState();

    expect(map.sources.has('sentinel-raster-a')).toBe(false);
    expect(map.visibility.get(mapLayerIds.roads)).toBe('none');
    expect(map.visibility.get(mapLayerIds.restrictedAreas)).toBe('none');
    expect(map.visibility.get(terrainOverlayLayerIds.reliefShade)).toBe('none');
    expect(map.visibility.get(terrainOverlayLayerIds.contourMinor)).toBe('none');
    expect(mapLayerStore.getState()).toMatchObject({
      visibility: {
        'satellite-imagery': false,
        roads: false,
        'imported-tracks': false,
        'track-elevation-gradient': false,
      },
      importedTrackOpacity: 0.6,
      appliedImagery: { status: 'empty' },
    });
    expect(controller.getRenderingTuning()).toEqual({
      reflectanceMax: 6_500,
      gamma: 1.6,
      saturation: 1.2,
    });
    expect(controller.getTerrainOverlayPreferences()).toEqual({
      contourIntervalMeters: 25,
      filterInvalidDemPixels: false,
      shadeAboveSatellite: true,
    });
  });

  it('normalizes persisted Google and Sentinel visibility to Google-only', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    await services.database.saveMapLayerPreferences({
      visibility: {
        ...mapLayerStore.getState().visibility,
        'google-satellite': true,
        'satellite-imagery': true,
      },
      openStreetMapOpacity: mapLayerStore.getState().openStreetMapOpacity,
      importedTrackOpacity: mapLayerStore.getState().importedTrackOpacity,
      satelliteRenderingMode: controller.getRenderingMode(),
      renderingTuning: controller.getRenderingTuning(),
      terrainOverlays: controller.getTerrainOverlayPreferences(),
    });
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    await controller.restorePersistedState();

    expect(map.visibility.get(satelliteBasemapLayerIds.imagery)).toBe('visible');
    expect(mapLayerStore.getState().visibility).toMatchObject({
      'google-satellite': true,
      'satellite-imagery': false,
    });
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        visibility: { 'google-satellite': true, 'satellite-imagery': false },
      });
    });
  });

  it('does not restore legacy persisted imagery after the map style becomes ready', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    await services.database.saveMapLayerPreferences({
      visibility: mapLayerStore.getState().visibility,
      openStreetMapOpacity: mapLayerStore.getState().openStreetMapOpacity,
      importedTrackOpacity: mapLayerStore.getState().importedTrackOpacity,
      satelliteRenderingMode: 'auto',
      renderingTuning: controller.getRenderingTuning(),
      terrainOverlays: controller.getTerrainOverlayPreferences(),
    });
    const map = new FakeLayerMap();
    map.styleLoaded = false;
    controller.attach(map as unknown as MapLibreMap);

    await controller.restorePersistedState();

    expect(map.sources.has('sentinel-raster-a')).toBe(false);
    expect(
      services.logger
        .getEvents()
        .filter((event) => event.name === 'satellite.imagery.apply-failed'),
    ).toHaveLength(0);

    map.styleLoaded = true;
    controller.attach(map as unknown as MapLibreMap);
    expect(mapLayerStore.getState().appliedImagery).toEqual({ status: 'empty' });
  });

  it('atomically reapplies and persists user imagery stretch values', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    await controller.applyScene(scene('tuned-scene'), new AbortController().signal);

    await expect(
      controller.setRenderingTuning(
        { reflectanceMax: 6_250, gamma: 1.55, saturation: 1.25 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: 'success' });

    const raster = map.sources.get('sentinel-raster-b') as {
      readonly tiles: readonly string[];
    };
    expect(raster.tiles[0]).toContain('rescale=0%2C6250');
    expect(raster.tiles[0]).toContain('Gamma%20RGB%201.55');
    expect(raster.tiles[0]).toContain('Saturation%201.25');
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        renderingTuning: { reflectanceMax: 6_250, gamma: 1.55, saturation: 1.25 },
      });
    });
  });

  it('renders deterministic saved-marker symbols with unique generated images', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    const createIcon = vi
      .spyOn(markerCatalog, 'createMarkerIconImage')
      .mockResolvedValue({} as HTMLImageElement);
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);
    const markers: readonly SavedMarker[] = [
      {
        schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
        id: 'bravo',
        name: 'Bravo',
        normalizedName: 'bravo',
        coordinate: [44.9, 41.8],
        iconKey: 'hiking',
        colorKey: 'red',
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
      {
        schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
        id: 'alpha',
        name: 'Alpha',
        normalizedName: 'alpha',
        coordinate: [44.8, 41.7],
        iconKey: 'place',
        colorKey: 'blue',
        createdAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:00.000Z',
      },
      {
        schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
        id: 'charlie',
        name: 'Charlie',
        normalizedName: 'charlie',
        coordinate: [44.7, 41.6],
        iconKey: 'hiking',
        colorKey: 'red',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
    ];

    controller.setSavedMarkers(markers);
    await waitFor(() => {
      expect(createIcon).toHaveBeenCalledTimes(2);
      expect(map.images.size).toBe(2);
    });
    const source = map.sources.get(mapSourceIds.savedMarkers) as {
      readonly data: { readonly features: readonly { readonly properties: unknown }[] };
    };
    expect(source.data.features.map((feature) => feature.properties)).toEqual([
      { id: 'alpha', name: 'Alpha', iconKey: 'place', colorKey: 'blue' },
      { id: 'bravo', name: 'Bravo', iconKey: 'hiking', colorKey: 'red' },
      { id: 'charlie', name: 'Charlie', iconKey: 'hiking', colorKey: 'red' },
    ]);
    expect(map.layers.get(savedMarkerLayerIds.symbols)).toMatchObject({
      layout: {
        'icon-image': [
          'concat',
          'saved-marker-',
          ['get', 'iconKey'],
          '-',
          ['get', 'colorKey'],
        ],
        'icon-size': 0.7,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.2],
        'text-allow-overlap': true,
      },
      paint: {
        'text-halo-color': '#FFFFFF',
        'text-halo-width': 2,
        'text-halo-blur': 0.5,
      },
    });
    expect(map.getStyle().layers.at(-1)?.id).toBe(savedMarkerLayerIds.symbols);

    controller.setSavedMarkers([]);
    const emptySource = map.sources.get(mapSourceIds.savedMarkers) as {
      readonly data: { readonly features: readonly unknown[] };
    };
    expect(emptySource.data.features).toEqual([]);
  });
});
