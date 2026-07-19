import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { MapLibreFacade } from '@/presentation/map/MapLibreFacade';
import type { PointInspectorPopup } from '@/presentation/map/MapLibrePointInspector';
import type { MapPointInspection } from '@/presentation/map/mapTypes';
import { createTestServices } from '../../../test/helpers/createTestServices';

type TestListener = (event?: unknown) => void;

class FakePointInspector implements PointInspectorPopup {
  public attached = false;
  public closed = false;
  public destroyed = false;
  public lastInspection: Exclude<MapPointInspection, { status: 'closed' }> | null =
    null;

  public attach(): void {
    this.attached = true;
  }

  public show(inspection: Exclude<MapPointInspection, { status: 'closed' }>): void {
    this.lastInspection = inspection;
  }

  public close(): void {
    this.closed = true;
  }

  public destroy(): void {
    this.destroyed = true;
  }
}

class FakeNativeMap {
  readonly #listeners = new Map<string, Set<TestListener>>();
  readonly #canvas = document.createElement('canvas');
  public showTileBoundaries = false;
  public showCollisionBoxes = false;
  public sourceLoaded = true;
  public addSourceCalls = 0;
  public readonly terrainValues: unknown[] = [];
  public readonly easeCalls: Record<string, unknown>[] = [];
  public repaintCalls = 0;
  public terrainElevation: number | null = null;
  public readonly sourceFeatures: unknown[] = [];
  readonly #sources = new Map<string, unknown>();
  #longitude = 44.8;
  #latitude = 41.7;
  #zoom = 8;
  #bearing = 12;
  #pitch = 35;

  public on(type: string, listener: TestListener): this {
    const listeners = this.#listeners.get(type) ?? new Set<TestListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
    return this;
  }

  public off(type: string, listener: TestListener): this {
    this.#listeners.get(type)?.delete(listener);
    return this;
  }

  public getCanvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  public getCanvasContainer(): HTMLCanvasElement {
    return this.#canvas;
  }

  public loaded(): boolean {
    return false;
  }

  public getStyle() {
    return {
      version: 8 as const,
      name: 'fixture-style',
      sources: Object.fromEntries(this.#sources),
      layers: [{ id: 'background', type: 'background' as const }],
    };
  }

  public getCenter() {
    return { lng: this.#longitude, lat: this.#latitude };
  }

  public getBounds() {
    return {
      getWest: () => 44.2,
      getSouth: () => 41.4,
      getEast: () => 45.4,
      getNorth: () => 42.2,
    };
  }

  public getZoom(): number {
    return this.#zoom;
  }

  public getBearing(): number {
    return this.#bearing;
  }

  public getPitch(): number {
    return this.#pitch;
  }

  public getSource(id: string): unknown {
    return this.#sources.get(id);
  }

  public querySourceFeatures(): unknown[] {
    return this.sourceFeatures;
  }

  public queryTerrainElevation(): number | null {
    return this.terrainElevation;
  }

  public addSource(id: string, source: unknown): void {
    this.addSourceCalls += 1;
    this.#sources.set(id, source);
  }

  public removeSource(id: string): void {
    this.#sources.delete(id);
  }

  public isSourceLoaded(): boolean {
    return this.sourceLoaded;
  }

  public setTerrain(value: unknown): void {
    this.terrainValues.push(value);
  }

  public easeTo(options: Record<string, unknown>): void {
    this.easeCalls.push(options);
    const center = options.center;
    if (Array.isArray(center)) {
      this.#longitude = Number(center[0]);
      this.#latitude = Number(center[1]);
    }
    if (typeof options.zoom === 'number') this.#zoom = options.zoom;
    if (typeof options.bearing === 'number') this.#bearing = options.bearing;
    if (typeof options.pitch === 'number') this.#pitch = options.pitch;
  }

  public triggerRepaint(): void {
    this.repaintCalls += 1;
  }

  public fire(type: string, event?: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }

  public listenerCount(): number {
    return [...this.#listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }
}

describe('MapLibreFacade', () => {
  it('owns lifecycle listeners, updates snapshots, and cleans up deterministically', async () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const onCameraSettled = vi.fn();
    const facade = new MapLibreFacade(services.logger, onCameraSettled);

    facade.attach(nativeMap as unknown as MapLibreMap);
    facade.attach(nativeMap as unknown as MapLibreMap);
    expect(nativeMap.listenerCount()).toBe(6);

    nativeMap.fire('load');
    nativeMap.addSource('late-style-source', { type: 'geojson' });
    nativeMap.fire('styledata');
    await Promise.resolve();
    nativeMap.fire('idle');
    nativeMap.fire('moveend');

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'ready',
      styleId: 'fixture-style',
      sourceIds: ['late-style-source'],
      layerIds: ['background'],
      webGlContext: 'available',
      camera: {
        longitude: 44.8,
        latitude: 41.7,
        zoom: 8,
        bearing: 12,
        pitch: 35,
      },
    });

    facade.setDebugOptions({
      showCollisionBoxes: true,
      showTileBoundaries: true,
    });
    expect(nativeMap.showCollisionBoxes).toBe(true);
    expect(nativeMap.showTileBoundaries).toBe(true);
    expect(onCameraSettled).toHaveBeenCalledOnce();
    expect(onCameraSettled).toHaveBeenCalledWith({
      longitude: 44.8,
      latitude: 41.7,
      zoom: 8,
      bearing: 12,
      pitch: 35,
    });
    expect(facade.getViewportSnapshot()).toEqual({
      bounds: { west: 44.2, south: 41.4, east: 45.4, north: 42.2 },
      center: { longitude: 44.8, latitude: 41.7 },
    });

    facade.destroy();
    expect(facade.getViewportSnapshot()).toBeNull();
    expect(nativeMap.listenerCount()).toBe(0);
    expect(
      services.logger
        .getEvents()
        .filter((event) => event.name === 'map.lifecycle.mounted'),
    ).toHaveLength(1);
  });

  it('preserves subscribers while the native ref detaches and reattaches', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger);
    const subscriber = vi.fn();
    const unsubscribe = facade.subscribe(subscriber);

    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');
    const notificationsBeforeDetach = subscriber.mock.calls.length;

    facade.detachMap();
    expect(nativeMap.listenerCount()).toBe(0);
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');

    expect(subscriber.mock.calls.length).toBeGreaterThan(notificationsBeforeDetach);
    expect(facade.getDiagnosticsSnapshot().lifecycle).toBe('ready');
    unsubscribe();
    facade.destroy();
  });

  it('toggles terrain on one map while preserving camera intent and deduplicating the source', async () => {
    const services = createTestServices();
    const provider = services.mapProviderConfiguration;
    expect(provider.status).toBe('valid');
    if (provider.status !== 'valid') return;
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger, undefined, {
      terrain: provider.value.terrain,
      requestTimeoutMs: 100,
      equivalentErrorWindowMs: 10_000,
    });
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');

    const firstEnable = facade.setTerrainMode('terrain');
    const repeatedEnable = facade.setTerrainMode('terrain');
    expect(repeatedEnable).toBe(firstEnable);
    await expect(firstEnable).resolves.toEqual({
      status: 'success',
      mode: 'terrain',
    });
    expect(nativeMap.addSourceCalls).toBe(1);
    expect(nativeMap.terrainValues.at(-1)).toMatchObject({
      source: 'terrain-dem',
      exaggeration: 1.15,
    });

    await expect(facade.setTerrainMode('flat')).resolves.toEqual({
      status: 'success',
      mode: 'flat',
    });
    expect(nativeMap.terrainValues.at(-1)).toBeNull();
    expect(nativeMap.easeCalls.at(-1)).toMatchObject({
      center: [44.8, 41.7],
      zoom: 8,
      bearing: 12,
      pitch: 0,
    });

    await facade.setTerrainMode('terrain');
    expect(nativeMap.addSourceCalls).toBe(1);
    facade.destroy();
  });

  it('falls back to flat mode after a DEM source error and cleans pending listeners on teardown', async () => {
    const services = createTestServices();
    const provider = services.mapProviderConfiguration;
    expect(provider.status).toBe('valid');
    if (provider.status !== 'valid') return;
    const nativeMap = new FakeNativeMap();
    nativeMap.sourceLoaded = false;
    const facade = new MapLibreFacade(services.logger, undefined, {
      terrain: provider.value.terrain,
      requestTimeoutMs: 1_000,
      equivalentErrorWindowMs: 10_000,
    });
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');

    const transition = facade.setTerrainMode('terrain');
    expect(nativeMap.listenerCount()).toBe(8);
    nativeMap.fire('error', {
      error: { message: 'fixture DEM unavailable' },
      sourceId: 'terrain-dem',
    });
    await expect(transition).resolves.toMatchObject({ status: 'failed' });
    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'degraded',
      terrainMode: 'flat',
    });

    const retry = facade.setTerrainMode('terrain');
    expect(nativeMap.listenerCount()).toBe(8);
    facade.destroy();
    await expect(retry).resolves.toMatchObject({ status: 'failed' });
    expect(nativeMap.listenerCount()).toBe(0);
  });

  it('categorizes and aggregates recoverable source failures without retaining raw errors', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_721_260_800_000);
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger);
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');

    for (let occurrence = 0; occurrence < 3; occurrence += 1) {
      nativeMap.fire('error', {
        error: {
          message: 'Tile failed https://provider.invalid/5/18/11.pbf?token=private',
        },
        sourceId: 'basemap-vector',
      });
    }

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'degraded',
      recoverableFailures: [
        { category: 'base-vector', sourceId: 'basemap-vector', count: 3 },
      ],
    });
    expect(
      services.logger.getEvents().filter((event) => event.name === 'map.source.failed'),
    ).toHaveLength(1);
    expect(JSON.stringify(services.logger.getEvents())).not.toContain('private');
  });

  it('treats an unrecoverable pre-load style error as fatal', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger);
    facade.attach(nativeMap as unknown as MapLibreMap);

    nativeMap.fire('error', { error: { message: 'Style document is invalid' } });

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'fatal',
      recoverableFailures: [],
    });
    expect(services.logger.getEvents().at(-1)?.name).toBe('map.style.failed');
  });

  it('records WebGL context loss, permits restoration, and removes canvas listeners', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger);
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');
    const contextLost = new Event('webglcontextlost', { cancelable: true });

    nativeMap.getCanvas().dispatchEvent(contextLost);
    expect(contextLost.defaultPrevented).toBe(true);
    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'fatal',
      webGlContext: 'lost',
    });

    nativeMap.getCanvas().dispatchEvent(new Event('webglcontextrestored'));
    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'ready',
      webGlContext: 'restored',
    });
    const snapshotBeforeDestroy = facade.getDiagnosticsSnapshot();
    facade.destroy();
    nativeMap.getCanvas().dispatchEvent(new Event('webglcontextlost'));
    expect(facade.getDiagnosticsSnapshot()).toEqual(snapshotBeforeDestroy);
  });

  it('inspects a clicked point, chooses a nearby POI, and omits private details from diagnostics', async () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    nativeMap.addSource('basemap-vector', { type: 'vector' });
    nativeMap.sourceFeatures.push({
      type: 'Feature',
      id: 7,
      geometry: { type: 'Point', coordinates: [44.8002, 41.7002] },
      properties: { name: 'Private fixture hut', subclass: 'alpine_hut' },
      source: 'basemap-vector',
      sourceLayer: 'poi',
      state: {},
      layer: { id: 'fixture', type: 'circle', source: 'basemap-vector' },
    });
    const pointInspector = new FakePointInspector();
    const facade = new MapLibreFacade(
      services.logger,
      undefined,
      {
        terrain:
          services.mapProviderConfiguration.status === 'valid'
            ? services.mapProviderConfiguration.value.terrain
            : (() => {
                throw new Error('Expected valid fixture configuration.');
              })(),
        sourceLayers: { pois: 'poi', peaks: 'mountain_peak' },
        requestTimeoutMs: 100,
        equivalentErrorWindowMs: 10_000,
      },
      undefined,
      undefined,
      { sample: () => Promise.resolve({ status: 'available', meters: 1_234.4 }) },
      pointInspector,
    );
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('click', { lngLat: { lng: 44.8, lat: 41.7 } });

    expect(facade.getPointInspection()).toMatchObject({
      status: 'open',
      elevation: { status: 'loading' },
    });
    await vi.waitFor(() => {
      expect(facade.getPointInspection()).toMatchObject({
        status: 'open',
        elevation: { status: 'available', meters: 1_234.4 },
        nearbyPoi: {
          status: 'found',
          poi: { name: 'Private fixture hut', category: 'alpine_hut' },
        },
      });
    });

    const diagnosticJson = JSON.stringify(services.logger.getEvents());
    expect(diagnosticJson).not.toContain('44.8');
    expect(diagnosticJson).not.toContain('41.7');
    expect(diagnosticJson).not.toContain('Private fixture hut');
    facade.closePointInspection();
    expect(facade.getPointInspection()).toEqual({ status: 'closed' });
    expect(pointInspector).toMatchObject({ attached: true, closed: true });
  });

  it('cancels stale elevation work when a newer point is selected', async () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    nativeMap.addSource('basemap-vector', { type: 'vector' });
    const pending: {
      readonly signal: AbortSignal;
      readonly resolve: (value: { status: 'available'; meters: number }) => void;
    }[] = [];
    const provider = services.mapProviderConfiguration;
    expect(provider.status).toBe('valid');
    if (provider.status !== 'valid') return;
    const facade = new MapLibreFacade(
      services.logger,
      undefined,
      {
        terrain: provider.value.terrain,
        sourceLayers: { pois: 'poi', peaks: 'mountain_peak' },
        requestTimeoutMs: 100,
        equivalentErrorWindowMs: 10_000,
      },
      undefined,
      undefined,
      {
        sample: (_coordinate, signal) =>
          new Promise((resolve) => {
            pending.push({ signal, resolve });
          }),
      },
      new FakePointInspector(),
    );
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('click', { lngLat: { lng: 44.8, lat: 41.7 } });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    nativeMap.fire('click', { lngLat: { lng: 45.1, lat: 42.1 } });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    expect(pending[0]?.signal.aborted).toBe(true);

    if (pending[0] !== undefined) {
      pending[0].resolve({ status: 'available', meters: 99 });
    }
    if (pending[1] !== undefined) {
      pending[1].resolve({ status: 'available', meters: 555 });
    }
    await vi.waitFor(() => {
      expect(facade.getPointInspection()).toMatchObject({
        coordinate: { longitude: 45.1, latitude: 42.1 },
        elevation: { status: 'available', meters: 555 },
      });
    });
  });
});
