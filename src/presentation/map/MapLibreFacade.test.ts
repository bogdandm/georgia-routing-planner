import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MapLibreFacade } from '@/presentation/map/MapLibreFacade';
import type { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import { createTestServices } from '../../../test/helpers/createTestServices';

type TestListener = (event?: unknown) => void;

afterEach(() => {
  vi.useRealTimers();
});

class FakeNativeMap {
  readonly #listeners = new Map<string, Set<TestListener>>();
  readonly #canvas = document.createElement('canvas');
  public showTileBoundaries = false;
  public showCollisionBoxes = false;
  public sourceLoaded = true;
  public addSourceCalls = 0;
  public readonly terrainTileUpdates: string[][] = [];
  public readonly terrainValues: unknown[] = [];
  public readonly easeCalls: Record<string, unknown>[] = [];
  public repaintCalls = 0;
  public terrainElevation: number | null = null;
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

  public addSource(id: string, source: unknown): void {
    this.addSourceCalls += 1;
    this.#sources.set(
      id,
      id === 'terrain-dem'
        ? {
            ...(source as Record<string, unknown>),
            setTiles: (tiles: string[]) => {
              this.terrainTileUpdates.push(tiles);
            },
          }
        : source,
    );
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

  public queryTerrainElevation(): number | null {
    return this.terrainElevation;
  }

  public querySourceFeatures(): [] {
    return [];
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
    const setTerrainInteractionActive = vi.fn();
    const layerController = {
      attach: vi.fn(),
      detach: vi.fn(),
      handleRasterSourceData: vi.fn(() => false),
      handleRasterSourceFailure: vi.fn(),
      handleRasterSourceRecovered: vi.fn(),
      isRasterSourceRecoveryComplete: vi.fn(() => false),
      setTerrainInteractionActive,
    };
    const facade = new MapLibreFacade(
      services.logger,
      onCameraSettled,
      undefined,
      undefined,
      layerController,
    );

    facade.attach(nativeMap as unknown as MapLibreMap);
    facade.attach(nativeMap as unknown as MapLibreMap);
    expect(nativeMap.listenerCount()).toBe(8);

    nativeMap.fire('load');
    nativeMap.addSource('late-style-source', { type: 'geojson' });
    nativeMap.fire('styledata');
    await Promise.resolve();
    nativeMap.fire('idle');
    nativeMap.fire('movestart');
    nativeMap.fire('moveend');

    expect(setTerrainInteractionActive).toHaveBeenNthCalledWith(1, true);
    expect(setTerrainInteractionActive).toHaveBeenNthCalledWith(2, false);

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
      camera: {
        longitude: 44.8,
        latitude: 41.7,
        zoom: 8,
        bearing: 12,
        pitch: 35,
      },
      terrainMode: 'flat',
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
      demTileUrl: 'test-dem://tiles/{z}/{x}/{y}',
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
      bearing: 0,
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
      demTileUrl: 'test-dem://tiles/{z}/{x}/{y}',
      requestTimeoutMs: 1_000,
      equivalentErrorWindowMs: 10_000,
    });
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');

    const transition = facade.setTerrainMode('terrain');
    expect(nativeMap.listenerCount()).toBe(10);
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
    expect(nativeMap.listenerCount()).toBe(10);
    expect(nativeMap.terrainTileUpdates).toEqual([
      ['test-dem://tiles/{z}/{x}/{y}?terrainEnableRetry=1'],
    ]);
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
        {
          category: 'base-vector',
          sourceId: 'basemap-vector',
          reason: 'unknown',
          httpStatus: null,
          count: 3,
          recoveryState: 'not-applicable',
          retryAttempt: 0,
        },
      ],
    });
    expect(
      services.logger.getEvents().filter((event) => event.name === 'map.source.failed'),
    ).toHaveLength(1);
    expect(JSON.stringify(services.logger.getEvents())).not.toContain('private');
  });

  it('shows a safe exact satellite HTTP failure and records source recovery', () => {
    vi.useFakeTimers();
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    let failedTileRecovered = false;
    const layerController = {
      attach: vi.fn(),
      detach: vi.fn(),
      handleRasterSourceFailure: vi.fn(() => ({
        state: 'scheduled' as const,
        retryAttempt: 1,
        retryDelayMs: 1_000,
      })),
      handleRasterSourceData: vi.fn((event: unknown) => {
        const tile = (
          event as {
            readonly tile?: {
              readonly tileID?: { readonly canonical?: unknown };
            };
          }
        ).tile?.tileID?.canonical;
        if (tile !== undefined) failedTileRecovered = true;
        return failedTileRecovered;
      }),
      isRasterSourceRecoveryComplete: vi.fn(() => failedTileRecovered),
      handleRasterSourceRecovered: vi.fn(),
    } as unknown as MapLibreLayerController;
    const facade = new MapLibreFacade(
      services.logger,
      undefined,
      undefined,
      undefined,
      layerController,
    );
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');
    nativeMap.addSource('sentinel-raster-a', { type: 'raster' });

    nativeMap.fire('error', {
      error: {
        message: 'AJAXError: Service Unavailable (503): https://private.example/tile',
        status: 503,
      },
      sourceId: 'sentinel-raster-a',
      tile: { tileID: { canonical: { x: 123, y: 456, z: 12 } } },
    });

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'degraded',
      message:
        'The satellite imagery renderer returned a server error (HTTP 503). Retrying automatically.',
      recoverableFailures: [
        {
          category: 'satellite-raster',
          sourceId: 'sentinel-raster-a',
          reason: 'http-server',
          httpStatus: 503,
          recoveryState: 'scheduled',
          retryAttempt: 1,
        },
      ],
    });
    expect(JSON.stringify(services.logger.getEvents())).not.toContain(
      'private.example',
    );

    nativeMap.fire('sourcedata', {
      sourceId: 'sentinel-raster-a',
      isSourceLoaded: true,
    });
    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'degraded',
      recoverableFailures: [{ recoveryState: 'scheduled' }],
    });
    vi.advanceTimersByTime(1_999);
    nativeMap.fire('error', {
      error: { message: 'AJAXError: Service Unavailable', status: 503 },
      sourceId: 'sentinel-raster-a',
      tile: { tileID: { canonical: { x: 123, y: 456, z: 12 } } },
    });
    vi.advanceTimersByTime(1);
    expect(facade.getDiagnosticsSnapshot().lifecycle).toBe('degraded');

    nativeMap.fire('sourcedata', {
      sourceId: 'sentinel-raster-a',
      isSourceLoaded: true,
      sourceDataType: 'content',
      tile: { tileID: { canonical: { x: 123, y: 456, z: 12 } } },
    });
    vi.advanceTimersByTime(2_000);
    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'ready',
      message: null,
      recoverableFailures: [{ recoveryState: 'recovered' }],
    });
    expect(services.logger.getEvents().at(-1)?.name).toBe('map.source.recovered');
  });

  it('shows status zero as terminal no-response evidence without claiming HTTP 0', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger);
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');
    nativeMap.addSource('sentinel-raster-a', { type: 'raster' });

    nativeMap.fire('error', {
      error: { message: 'AJAXError: Failed to fetch', status: 0 },
      sourceId: 'sentinel-raster-a',
    });

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'degraded',
      message:
        'The satellite imagery tile received no HTTP response (network, CORS, or provider connection failure).',
      recoverableFailures: [
        {
          reason: 'no-response',
          httpStatus: null,
        },
      ],
    });
    expect(facade.getDiagnosticsSnapshot().message).not.toContain('HTTP 0');
  });

  it('ignores a late satellite error after its staging source was removed', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger);
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');

    nativeMap.fire('error', {
      error: { message: 'AJAXError: Failed to fetch', status: 0 },
      sourceId: 'sentinel-raster-b',
    });

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'ready',
      message: null,
      recoverableFailures: [],
    });
    expect(
      services.logger.getEvents().filter((event) => event.name === 'map.source.failed'),
    ).toHaveLength(0);
  });

  it('ignores canceled source requests during tile-template replacement', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger);
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');

    nativeMap.fire('error', {
      error: new DOMException('The operation was aborted.', 'AbortError'),
      sourceId: 'terrain-dem',
    });

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'ready',
      recoverableFailures: [],
    });
  });

  it('ignores an unscoped late browser-raster error during a mode restart', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const layerController = {
      attach: vi.fn(),
      detach: vi.fn(),
      isExpectedRasterCancellation: vi.fn(() => true),
    } as unknown as MapLibreLayerController;
    const facade = new MapLibreFacade(
      services.logger,
      undefined,
      undefined,
      undefined,
      layerController,
    );
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');

    nativeMap.fire('error', {
      error: { message: 'Failed to load canceled custom protocol tile.' },
    });

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'ready',
      message: null,
      recoverableFailures: [],
    });
    expect(
      services.logger.getEvents().filter((event) => event.name === 'map.source.failed'),
    ).toHaveLength(0);
  });

  it('ignores routine cancelled tile requests without notifying subscribers', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const facade = new MapLibreFacade(services.logger);
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('load');
    const subscriber = vi.fn();
    facade.subscribe(subscriber);

    nativeMap.fire('error', {
      error: { name: 'AbortError', message: 'The tile request was aborted.' },
      sourceId: 'basemap-vector',
    });

    expect(subscriber).not.toHaveBeenCalled();
    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'ready',
      recoverableFailures: [],
    });
    expect(
      services.logger.getEvents().filter((event) => event.name === 'map.source.failed'),
    ).toHaveLength(0);
  });

  it('closes an open inspection on the next map click and opens another on the following click', async () => {
    const services = createTestServices();
    const provider = services.mapProviderConfiguration;
    expect(provider.status).toBe('valid');
    if (provider.status !== 'valid') return;
    const nativeMap = new FakeNativeMap();
    nativeMap.addSource('basemap-vector', { type: 'vector' });
    const samples: ((value: { status: 'available'; meters: number }) => void)[] = [];
    const elevationProvider = {
      sample: () =>
        new Promise<{ status: 'available'; meters: number }>((resolve) => {
          samples.push(resolve);
        }),
    };
    const popup = {
      attach: vi.fn(),
      show: vi.fn(),
      isVisible: vi.fn().mockReturnValue(true),
      close: vi.fn(),
      destroy: vi.fn(),
    };
    const facade = new MapLibreFacade(
      services.logger,
      undefined,
      {
        terrain: provider.value.terrain,
        demTileUrl: 'test-dem://tiles/{z}/{x}/{y}',
        sourceLayers: { pois: 'poi', peaks: 'mountain_peak' },
        requestTimeoutMs: 100,
        equivalentErrorWindowMs: 10_000,
      },
      undefined,
      undefined,
      elevationProvider,
      popup,
    );
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('click', { lngLat: { lng: 44.801234, lat: 41.712345 } });
    nativeMap.fire('click', { lngLat: { lng: 45.123456, lat: 42.234567 } });
    expect(facade.getPointInspection()).toEqual({ status: 'closed' });
    expect(popup.close).toHaveBeenCalledOnce();

    nativeMap.fire('click', { lngLat: { lng: 45.123456, lat: 42.234567 } });
    samples[1]?.({ status: 'available', meters: 900 });
    await Promise.resolve();
    samples[0]?.({ status: 'available', meters: 100 });
    await Promise.resolve();

    expect(facade.getPointInspection()).toMatchObject({
      coordinate: { longitude: 45.123456, latitude: 42.234567 },
      elevation: { status: 'available', meters: 900 },
      nearbyPoi: { status: 'none' },
    });
    expect(JSON.stringify(services.logger.getEvents())).not.toContain('45.123456');
    facade.closePointInspection();
    expect(facade.getPointInspection()).toEqual({ status: 'closed' });
  });

  it('replaces an inspection immediately when its popup is outside the map viewport', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const popup = {
      attach: vi.fn(),
      show: vi.fn(),
      isVisible: vi.fn().mockReturnValue(false),
      close: vi.fn(),
      destroy: vi.fn(),
    };
    const facade = new MapLibreFacade(
      services.logger,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      popup,
    );
    facade.attach(nativeMap as unknown as MapLibreMap);
    nativeMap.fire('click', { lngLat: { lng: 44.8, lat: 41.7 } });

    nativeMap.fire('click', { lngLat: { lng: 45.1, lat: 42.2 } });

    expect(popup.close).toHaveBeenCalledOnce();
    expect(facade.getPointInspection()).toMatchObject({
      status: 'open',
      coordinate: { longitude: 45.1, latitude: 42.2 },
    });
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
});
