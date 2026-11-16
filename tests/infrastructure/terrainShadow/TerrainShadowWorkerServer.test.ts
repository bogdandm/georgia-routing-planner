import { describe, expect, it, vi } from 'vitest';

import { WorkerRpcClient } from '@/infrastructure/runtime/WorkerRpc';
import type {
  TerrainShadowTileMetrics,
  TerrainShadowTileRequest,
  TerrainShadowTileResult,
} from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import {
  terrainShadowWorkerMethods,
  TerrainShadowWorkerServer,
} from '@/infrastructure/terrainShadow/TerrainShadowWorkerServer';
import { createMemoryWorkerRpcEndpointPair } from '@test/helpers/MemoryWorkerRpcEndpoint';

const request: TerrainShadowTileRequest = {
  z: 12,
  x: 2_541,
  y: 1_514,
  instantMs: Date.UTC(2026, 5, 21, 8, 30),
  tileSize: 512,
  demTileUrl: 'https://tiles.example/{z}/{x}/{y}.webp',
  demMinZoom: 0,
  demMaxZoom: 12,
  shadowColor: [27, 36, 51],
  highlightColor: [255, 247, 230],
  highlightOpacity: 0.6,
  goldenShadowColor: [70, 53, 110],
  lowSunShadowColor: [46, 63, 122],
  lowSunShadowLift: 0.4,
  lowSunGlowOpacity: 0.35,
  alpenglowColor: [240, 163, 184],
  alpenglowOpacity: 0.4,
  nightSky: true,
};

describe('TerrainShadowWorkerServer', () => {
  it('rejects untrusted payloads before rendering', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const render = vi.fn();
    const server = new TerrainShadowWorkerServer(serverEndpoint, {
      render,
      prefetch: vi.fn(),
      dispose: vi.fn(),
    });
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(terrainShadowWorkerMethods.renderTile, {
        ...request,
        demTileUrl: 'http://private.example/{z}/{x}/{y}.webp',
      }),
    ).rejects.toThrow();
    expect(render).not.toHaveBeenCalled();

    client.dispose();
    server.dispose();
  });

  it('closes the bitmap of a tile canceled while it was rendering', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const close = vi.fn();
    const bitmap = { close } as unknown as ImageBitmap;
    const renderSignals: AbortSignal[] = [];
    const finishRenders: (() => void)[] = [];
    const render = vi.fn(
      (_request: TerrainShadowTileRequest, signal: AbortSignal) =>
        new Promise<TerrainShadowTileResult>((resolve) => {
          renderSignals.push(signal);
          finishRenders.push(() => {
            resolve({ bitmap } as TerrainShadowTileResult);
          });
        }),
    );
    const server = new TerrainShadowWorkerServer(serverEndpoint, {
      render,
      prefetch: vi.fn(),
      dispose: vi.fn(),
    });
    const client = new WorkerRpcClient(clientEndpoint);
    const controller = new AbortController();

    const tile = client.request(
      terrainShadowWorkerMethods.renderTile,
      request,
      controller.signal,
    );
    await vi.waitFor(() => {
      expect(renderSignals).toHaveLength(1);
    });
    controller.abort();
    await expect(tile).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => {
      expect(renderSignals[0]?.aborted).toBe(true);
    });
    finishRenders[0]?.();
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });

    client.dispose();
    server.dispose();
  });

  it('validates prefetch payloads and answers with the cached tile metrics', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const metrics: TerrainShadowTileMetrics = {
      computeMs: 40,
      demFetchMs: 0,
      cacheHit: false,
      demTilesFetched: 0,
      memoryBytes: 1_048_576,
      cachedMasks: 1,
      cachedDemTiles: 27,
    };
    const prefetch = vi.fn(() => Promise.resolve(metrics));
    const server = new TerrainShadowWorkerServer(serverEndpoint, {
      render: vi.fn(),
      prefetch,
      dispose: vi.fn(),
    });
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(terrainShadowWorkerMethods.prefetchTile, { ...request, z: 13 }),
    ).rejects.toThrow();
    expect(prefetch).not.toHaveBeenCalled();
    await expect(
      client.request(terrainShadowWorkerMethods.prefetchTile, request),
    ).resolves.toEqual(metrics);
    expect(prefetch).toHaveBeenCalledExactlyOnceWith(request, expect.any(AbortSignal));

    client.dispose();
    server.dispose();
  });
});
