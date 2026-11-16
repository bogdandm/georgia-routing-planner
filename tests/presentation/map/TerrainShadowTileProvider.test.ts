import { addProtocol, type AddProtocolAction, removeProtocol } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type { WorkerRpcEndpoint } from '@/infrastructure/runtime/WorkerRpc';
import {
  type TerrainShadowTileMetrics,
  terrainShadowUnavailableErrorCode,
} from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import {
  MapLibreTerrainShadowTileProvider,
  type TerrainShadowAvailability,
  type TerrainShadowPrefetchProgress,
  terrainShadowProtocolId,
} from '@/presentation/map/TerrainShadowTileProvider';

vi.mock('maplibre-gl', () => ({ addProtocol: vi.fn(), removeProtocol: vi.fn() }));

const terrain: MapProviderConfiguration['terrain'] = {
  id: 'synthetic-terrain',
  label: 'Synthetic terrain',
  tileUrl: 'https://tiles.example/{z}/{x}/{y}.webp',
  encoding: 'terrarium',
  tileSize: 512,
  minZoom: 0,
  maxZoom: 12,
  attribution: 'Synthetic',
  exaggeration: 1,
  overlays: { contourMinZoom: 11, contourMaxZoom: 12, contourCacheSize: 32 },
};

const instantMs = Date.UTC(2026, 5, 21, 8, 30, 45, 500);
const epochMinute = Math.floor(instantMs / 60_000);
const tileUrl = `${terrainShadowProtocolId}://${String(epochMinute)}/12/2541/1514`;

const renderedMetrics: TerrainShadowTileMetrics = {
  computeMs: 40,
  demFetchMs: 10,
  cacheHit: false,
  demTilesFetched: 9,
  memoryBytes: 100,
  cachedMasks: 1,
  cachedDemTiles: 9,
};

class FakeImageBitmap {
  public readonly width = 512;
}

interface SentRequest {
  readonly requestId: number;
  readonly method: unknown;
  readonly payload: unknown;
}

/** Worker double that records RPC requests and answers them on demand. */
class FakeShadowWorker implements WorkerRpcEndpoint {
  public readonly requests: SentRequest[] = [];
  public readonly canceledRequestIds: number[] = [];
  public terminated = false;
  readonly #listeners = new Map<string, Set<EventListener>>();

  public postMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return;
    const { type, requestId, method, payload } = message as Readonly<
      Record<string, unknown>
    >;
    if (typeof requestId !== 'number') return;
    if (type === 'request') this.requests.push({ requestId, method, payload });
    if (type === 'cancel') this.canceledRequestIds.push(requestId);
  }

  public addEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public respond(index: number, value: unknown): void {
    this.dispatchMessage({ type: 'result', requestId: this.requestId(index), value });
  }

  public fail(
    index: number,
    failure: { name: string; message: string; code?: string },
  ): void {
    this.dispatchMessage({
      type: 'failure',
      requestId: this.requestId(index),
      failure,
    });
  }

  public failTransport(): void {
    for (const listener of this.#listeners.get('error') ?? [])
      listener(new Event('error'));
  }

  private requestId(index: number): number {
    const request = this.requests[index];
    if (request === undefined) throw new Error(`No worker request ${String(index)}.`);
    return request.requestId;
  }

  private dispatchMessage(data: unknown): void {
    for (const listener of this.#listeners.get('message') ?? []) {
      listener(new MessageEvent('message', { data }));
    }
  }
}

function registeredLoader(): AddProtocolAction {
  const loader = vi.mocked(addProtocol).mock.calls.at(-1)?.[1];
  if (loader === undefined)
    throw new Error('The terrain shadow protocol is not registered.');
  return loader;
}

function loadTile(url = tileUrl, controller = new AbortController()) {
  return registeredLoader()({ url, type: 'image' }, controller);
}

function createProvider(worker = new FakeShadowWorker()) {
  const workerFactory = vi.fn(() => worker);
  const provider = new MapLibreTerrainShadowTileProvider(terrain, workerFactory);
  return { provider, worker, workerFactory };
}

beforeEach(() => {
  vi.stubGlobal('ImageBitmap', FakeImageBitmap);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(addProtocol).mockClear();
  vi.mocked(removeProtocol).mockClear();
});

describe('MapLibreTerrainShadowTileProvider', () => {
  it('quantizes tile templates to whole minutes', () => {
    const { provider } = createProvider();

    expect(provider.createTileUrl(instantMs)).toBe(
      `terrain-shadow://${String(epochMinute)}/{z}/{x}/{y}`,
    );
    expect(provider.createTileUrl(instantMs + 14_000)).toBe(
      provider.createTileUrl(instantMs),
    );
    provider.dispose();
  });

  it('creates the worker on the first tile and sends the quantized instant', async () => {
    const { provider, worker, workerFactory } = createProvider();
    expect(addProtocol).toHaveBeenCalledWith(
      terrainShadowProtocolId,
      expect.any(Function),
    );
    expect(workerFactory).not.toHaveBeenCalled();

    const bitmap = new FakeImageBitmap();
    const tile = loadTile();
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });
    worker.respond(0, { bitmap, metrics: renderedMetrics });

    await expect(tile).resolves.toEqual({ data: bitmap });
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(worker.requests[0]?.payload).toEqual({
      z: 12,
      x: 2_541,
      y: 1_514,
      instantMs: epochMinute * 60_000,
      tileSize: 512,
      demTileUrl: terrain.tileUrl,
      demMinZoom: 0,
      demMaxZoom: 12,
      shadowColor: [0x1b, 0x24, 0x33],
      highlightColor: [0xff, 0xf7, 0xe6],
      highlightOpacity: 0.6,
      lowSunShadowColor: [0x2e, 0x3f, 0x7a],
      lowSunShadowLift: 0.25,
      lowSunGlowOpacity: 0.4,
      neutralBrightness: 1.35,
      skyOcclusionStrength: 1,
      penumbraDegreesPerKm: 0,
    });

    const second = loadTile();
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(2);
    });
    worker.respond(1, { bitmap, metrics: { ...renderedMetrics, cacheHit: true } });
    await second;
    expect(workerFactory).toHaveBeenCalledOnce();
    provider.dispose();
  });

  it('rejects malformed tile addresses without starting the worker', async () => {
    const { provider, workerFactory } = createProvider();

    await expect(loadTile('terrain-shadow://now/12/1/1')).rejects.toThrow(
      'Invalid terrain shadow tile address.',
    );
    expect(workerFactory).not.toHaveBeenCalled();
    provider.dispose();
  });

  it('holds tile requests during map interaction and releases them afterwards', async () => {
    const { provider, worker } = createProvider();
    provider.setInteractionActive(true);

    const tile = loadTile();
    await Promise.resolve();
    await Promise.resolve();
    expect(worker.requests).toHaveLength(0);
    expect(provider.getMetrics().pendingTiles).toBe(1);

    provider.setInteractionActive(false);
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });
    worker.respond(0, { bitmap: new FakeImageBitmap(), metrics: renderedMetrics });
    await tile;
    expect(provider.getMetrics().pendingTiles).toBe(0);
    provider.dispose();
  });

  it('drops a gated tile aborted by MapLibre without counting a failure', async () => {
    const { provider, worker, workerFactory } = createProvider();
    provider.setInteractionActive(true);
    const controller = new AbortController();

    const tile = loadTile(tileUrl, controller);
    controller.abort();

    await expect(tile).rejects.toMatchObject({ name: 'AbortError' });
    provider.setInteractionActive(false);
    await Promise.resolve();
    expect(workerFactory).not.toHaveBeenCalled();
    expect(worker.requests).toHaveLength(0);
    expect(provider.getMetrics()).toMatchObject({ pendingTiles: 0, tilesFailed: 0 });
    provider.dispose();
  });

  it('becomes available after the first rendered tile', async () => {
    const { provider, worker } = createProvider();
    const seen: TerrainShadowAvailability[] = [];
    provider.subscribeAvailability((value) => seen.push(value));
    expect(provider.getAvailability()).toBe('unknown');

    const tile = loadTile();
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });
    worker.respond(0, { bitmap: new FakeImageBitmap(), metrics: renderedMetrics });
    await tile;

    expect(provider.getAvailability()).toBe('available');
    expect(seen).toEqual(['available']);
    provider.dispose();
  });

  it('becomes unavailable when the worker lacks WebGL2 float support', async () => {
    const { provider, worker } = createProvider();

    const tile = loadTile();
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });
    worker.fail(0, {
      name: 'TerrainShadowUnavailableError',
      message: 'WebGL2 float render targets are unavailable.',
      code: terrainShadowUnavailableErrorCode,
    });

    await expect(tile).rejects.toThrow('WebGL2 float render targets are unavailable.');
    expect(provider.getAvailability()).toBe('unavailable');
    await expect(loadTile()).rejects.toThrow('unavailable');
    expect(worker.requests).toHaveLength(1);
    provider.dispose();
  });

  it('becomes unavailable when the worker transport fails', async () => {
    const { provider, worker } = createProvider();
    const tile = loadTile();
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });

    worker.failTransport();

    await expect(tile).rejects.toThrow();
    expect(provider.getAvailability()).toBe('unavailable');
    provider.dispose();
  });

  it('starts unavailable for DEM encodings the GPU decoder does not support', () => {
    const provider = new MapLibreTerrainShadowTileProvider(
      { ...terrain, encoding: 'mapbox' },
      () => new FakeShadowWorker(),
    );

    expect(provider.getAvailability()).toBe('unavailable');
    provider.dispose();
  });

  it('aggregates worker metrics and keeps the GPU estimate across resets', async () => {
    const { provider, worker } = createProvider();
    const tiles = [loadTile(), loadTile(), loadTile()];
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(3);
    });

    worker.respond(0, { bitmap: new FakeImageBitmap(), metrics: renderedMetrics });
    worker.respond(1, {
      bitmap: new FakeImageBitmap(),
      metrics: {
        ...renderedMetrics,
        computeMs: 2,
        demFetchMs: 0,
        cacheHit: true,
        demTilesFetched: 0,
        memoryBytes: 120,
      },
    });
    worker.fail(2, {
      name: 'Error',
      message: 'DEM tile request failed with HTTP 500.',
    });
    const results = await Promise.allSettled(tiles);

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
    ]);
    expect(provider.getMetrics()).toEqual({
      tilesRendered: 1,
      tilesFromCache: 1,
      tilesFailed: 1,
      pendingTiles: 0,
      totalComputeMs: 42,
      maxComputeMs: 40,
      totalDemFetchMs: 10,
      demTilesFetched: 9,
      memoryBytes: 120,
    });
    expect(provider.getAvailability()).toBe('available');

    provider.resetMetrics();
    expect(provider.getMetrics()).toEqual({
      tilesRendered: 0,
      tilesFromCache: 0,
      tilesFailed: 0,
      pendingTiles: 0,
      totalComputeMs: 0,
      maxComputeMs: 0,
      totalDemFetchMs: 0,
      demTilesFetched: 0,
      memoryBytes: 120,
    });
    provider.dispose();
  });

  it('prefetches hour blocks in order, tile-major inside, with at most four requests in flight', async () => {
    const { provider, worker } = createProvider();
    const tiles = [
      { z: 12, x: 2541, y: 1514 },
      { z: 12, x: 2542, y: 1514 },
    ];
    // Two blocks: six instants, then two.
    const instants = Array.from(
      { length: 8 },
      (_, index) => instantMs + index * 10 * 60_000,
    );
    const onProgress = vi.fn<(progress: TerrainShadowPrefetchProgress) => void>();

    const prefetch = provider.prefetch(
      tiles,
      instants,
      new AbortController().signal,
      onProgress,
    );
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(4);
    });
    for (let index = 0; index < 16; index += 1) {
      await vi.waitFor(() => {
        expect(worker.requests.length).toBeGreaterThan(index);
      });
      expect(worker.requests.length - index).toBeLessThanOrEqual(4);
      worker.respond(index, renderedMetrics);
    }
    await expect(prefetch).resolves.toBeUndefined();

    expect(worker.requests.map((request) => request.method)).toEqual(
      Array<string>(16).fill('terrain-shadow.prefetch-tile'),
    );
    const minute = (index: number) =>
      Math.floor((instants[index] ?? 0) / 60_000) * 60_000;
    const [first, second] = [tiles[0]?.x, tiles[1]?.x];
    expect(
      worker.requests.map((request) => {
        const payload = request.payload as { x: number; instantMs: number };
        return [payload.x, payload.instantMs];
      }),
    ).toEqual([
      ...[0, 1, 2, 3, 4, 5].map((index) => [first, minute(index)]),
      ...[0, 1, 2, 3, 4, 5].map((index) => [second, minute(index)]),
      // The second block starts with the tile the first one ended with.
      ...[6, 7].map((index) => [second, minute(index)]),
      ...[6, 7].map((index) => [first, minute(index)]),
    ]);
    // A frame is ready once both tiles have it, in order.
    expect(
      onProgress.mock.calls.map(([progress]) => [
        progress.completed,
        progress.readyFrames,
      ]),
    ).toEqual(
      [0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 6, 6, 7, 8].map((ready, index) => [
        index + 1,
        ready,
      ]),
    );
    expect(onProgress).toHaveBeenLastCalledWith({
      completed: 16,
      total: 16,
      readyFrames: 8,
    });
    expect(provider.getMetrics().tilesRendered).toBe(16);
    provider.dispose();
  });

  it('rejects an aborted prefetch and cancels its requests in flight', async () => {
    const { provider, worker } = createProvider();
    const controller = new AbortController();
    const prefetch = provider.prefetch(
      [{ z: 12, x: 2541, y: 1514 }],
      [instantMs, instantMs + 600_000],
      controller.signal,
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(2);
    });

    controller.abort();

    await expect(prefetch).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.canceledRequestIds).toEqual(
      worker.requests.map((request) => request.requestId),
    );
    expect(provider.getMetrics().tilesFailed).toBe(0);
    provider.dispose();
  });

  it('rejects a prefetch and disables shadows when the worker cannot render', async () => {
    const { provider, worker } = createProvider();
    const prefetch = provider.prefetch(
      [{ z: 12, x: 2541, y: 1514 }],
      [instantMs],
      new AbortController().signal,
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });

    worker.fail(0, {
      name: 'TerrainShadowUnavailableError',
      message: 'WebGL2 is unavailable.',
      code: terrainShadowUnavailableErrorCode,
    });

    await expect(prefetch).rejects.toThrow('WebGL2 is unavailable.');
    expect(provider.getAvailability()).toBe('unavailable');
    provider.dispose();
  });

  it('removes the protocol and terminates the worker on dispose', async () => {
    const { provider, worker } = createProvider();
    const tile = loadTile();
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });

    provider.dispose();

    expect(removeProtocol).toHaveBeenCalledWith(terrainShadowProtocolId);
    expect(worker.terminated).toBe(true);
    await expect(tile).rejects.toThrow();
  });
});
