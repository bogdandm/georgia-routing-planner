import { describe, expect, it, vi } from 'vitest';

import { WorkerRpcClient } from '@/infrastructure/runtime/WorkerRpc';
import type {
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
  color: [27, 36, 51],
};

describe('TerrainShadowWorkerServer', () => {
  it('rejects untrusted payloads before rendering', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const render = vi.fn();
    const server = new TerrainShadowWorkerServer(serverEndpoint, {
      render,
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
});
