import type { Map as MapLibreMap } from 'maplibre-gl';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import { mapLayerIds, sentinelMapLayerIds } from '@/presentation/map/mapIds';
import { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import { createTestServices } from '../../../test/helpers/createTestServices';

type Listener = (event: never) => void;

class FakeLayerMap {
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly sources = new Map<string, unknown>();
  readonly layers = new Map<string, Record<string, unknown>>();
  readonly visibility = new Map<string, string>();
  readonly paint = new Map<string, unknown>();
  fitOptions: Record<string, unknown> | null = null;
  sourceLoaded = true;

  public constructor() {
    for (const id of Object.values(mapLayerIds)) this.layers.set(id, { id });
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

  public addLayer(layer: Record<string, unknown>): void {
    this.layers.set(String(layer.id), layer);
  }

  public removeLayer(id: string): void {
    this.layers.delete(id);
  }

  public setLayoutProperty(id: string, _name: string, value: unknown): void {
    this.visibility.set(id, String(value));
  }

  public setPaintProperty(id: string, _name: string, value: unknown): void {
    this.paint.set(id, value);
  }

  public getSource(id: string): unknown {
    return this.sources.get(id);
  }

  public addSource(id: string, source: unknown): void {
    this.sources.set(id, source);
  }

  public removeSource(id: string): void {
    this.sources.delete(id);
  }

  public isSourceLoaded(): boolean {
    return this.sourceLoaded;
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
      kind: 'sentinel-rgb-cogs',
      itemHref: `https://earth-search.example.test/items/${id}`,
      redHref: `https://sentinel.example.test/${id}/B04.tif`,
      greenHref: `https://sentinel.example.test/${id}/B03.tif`,
      blueHref: `https://sentinel.example.test/${id}/B02.tif`,
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

describe('MapLibreLayerController', () => {
  it('maps logical controls to allowlisted native style layers', () => {
    const services = createTestServices();
    const configuration = services.mapProviderConfiguration;
    expect(configuration.status).toBe('valid');
    if (configuration.status !== 'valid') return;
    const map = new FakeLayerMap();
    const controller = new MapLibreLayerController(
      configuration.value.satellite.renderer,
      services.logger,
      services.idGenerator,
      services.sentinelQueryDiagnostics,
      100,
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
    expect(raster.bounds).toEqual([44, 42, 45, 43]);
    expect(map.layers.has(sentinelMapLayerIds.footprint)).toBe(true);
    expect(mapLayerStore.getState().appliedImagery).toMatchObject({
      status: 'ready',
      sceneId: 'scene-a',
    });

    expect(controller.setLayerVisibility('satellite-imagery', false)).toEqual({
      status: 'success',
    });
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('none');
    expect(mapLayerStore.getState().appliedImagery.status).toBe('hidden');

    await expect(
      controller.applyScene(scene('scene-b'), new AbortController().signal),
    ).resolves.toEqual({ status: 'success' });
    expect(map.layers.has(sentinelMapLayerIds.rasterA)).toBe(false);
    expect(map.layers.has(sentinelMapLayerIds.rasterB)).toBe(true);
    expect(mapLayerStore.getState()).toMatchObject({
      appliedImagery: { status: 'ready', sceneId: 'scene-b' },
      visibility: { 'satellite-imagery': true },
    });

    expect(controller.fitFootprint()).toEqual({ status: 'success' });
    expect(map.fitOptions).toMatchObject({ bearing: 17, pitch: 34, padding: 56 });
  });

  it('keeps the prior raster when a replacement source fails', async () => {
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
      sourceId: 'sentinel-raster-b',
      error: { message: 'private provider detail' },
    });

    await expect(replacement).resolves.toMatchObject({ status: 'failed' });
    expect(map.layers.has(sentinelMapLayerIds.rasterA)).toBe(true);
    expect(map.layers.has(sentinelMapLayerIds.rasterB)).toBe(false);
    expect(mapLayerStore.getState().appliedImagery).toMatchObject({
      status: 'failed',
      previousSceneKey: 'sentinel-2-l2a:scene-a',
    });
    expect(JSON.stringify(services.logger.getEvents())).not.toContain(
      'private provider detail',
    );
  });

  it('restores the saved scene and visibility after a page refresh', async () => {
    const services = createTestServices();
    const controller = services.mapLayers;
    if (controller === null) return;
    await services.database.saveMapLayerPreferences({
      visibility: {
        'satellite-imagery': false,
        'scene-footprint': true,
        'hiking-paths': true,
        roads: false,
        'places-and-pois': true,
      },
      appliedScene: scene('saved-scene'),
    });
    const map = new FakeLayerMap();
    controller.attach(map as unknown as MapLibreMap);

    await controller.restorePersistedState();

    expect(map.sources.has('sentinel-raster-a')).toBe(true);
    expect(map.visibility.get(sentinelMapLayerIds.rasterA)).toBe('none');
    expect(map.visibility.get(mapLayerIds.roads)).toBe('none');
    expect(mapLayerStore.getState()).toMatchObject({
      visibility: { 'satellite-imagery': false, roads: false },
      appliedImagery: { status: 'hidden', sceneId: 'saved-scene' },
    });
  });
});
