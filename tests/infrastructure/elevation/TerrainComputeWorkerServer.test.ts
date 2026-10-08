import { describe, expect, it, vi } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type {
  TerrainComputeQueueState,
  TerrainContourOptions,
  TerrainContourTile,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import { toTerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';
import {
  TerrainComputeWorkerServer,
  type TerrainWorkerEngineFactory,
} from '@/infrastructure/elevation/TerrainComputeWorkerServer';
import {
  terrainWorkerEventNames,
  type TerrainWorkerInitializeRequest,
} from '@/infrastructure/elevation/TerrainComputeProtocol';
import { WorkerRpcClient } from '@/infrastructure/runtime/WorkerRpc';
import { createMemoryWorkerRpcEndpointPair } from '@test/helpers/MemoryWorkerRpcEndpoint';

function initialization(): TerrainWorkerInitializeRequest {
  const terrain = parseMapProviderConfiguration(
    defaultMapProviderConfigurationInput,
    'https://example.test/',
  ).terrain;
  return {
    configuration: toTerrainComputeConfiguration(terrain, 10_000),
    interactionActive: false,
  };
}

describe('TerrainComputeWorkerServer', () => {
  it('initializes one engine and returns owned transferable contour results', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const contourBuffer = new Uint8Array([4, 5, 6]).buffer;
    const engine = {
      fetchContourTile: vi.fn(
        (
          _zoom: number,
          _x: number,
          _y: number,
          _options: TerrainContourOptions,
          _abortController: AbortController,
        ): Promise<TerrainContourTile> =>
          Promise.resolve({ arrayBuffer: contourBuffer }),
      ),
      dispose: vi.fn(),
    };
    const factory = vi.fn<TerrainWorkerEngineFactory>(() => engine);
    const server = new TerrainComputeWorkerServer(serverEndpoint, factory);
    const client = new WorkerRpcClient(clientEndpoint);
    await client.request('initialize', initialization());

    const firstContour = await client.request<{ readonly data: ArrayBuffer }>(
      'contour',
      contourRequest(8),
    );
    const secondContour = await client.request<{ readonly data: ArrayBuffer }>(
      'contour',
      contourRequest(8),
    );

    expect(Array.from(new Uint8Array(firstContour.data))).toEqual([4, 5, 6]);
    expect(Array.from(new Uint8Array(secondContour.data))).toEqual([4, 5, 6]);
    expect(firstContour.data).not.toBe(secondContour.data);
    expect(contourBuffer.byteLength).toBe(3);
    expect(engine.fetchContourTile).toHaveBeenCalledWith(
      5,
      8,
      9,
      { levels: [50, 200] },
      expect.any(AbortController),
    );
    expect(engine.fetchContourTile).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledOnce();
    client.dispose();
    server.dispose();
  });

  it('forwards cancellation of a running contour request to the engine', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const fetchContourTile = vi.fn(
      (
        _zoom: number,
        _x: number,
        _y: number,
        _options: TerrainContourOptions,
        abortController: AbortController,
      ) =>
        new Promise<TerrainContourTile>((_resolve, reject) => {
          abortController.signal.addEventListener('abort', () => {
            reject(
              abortController.signal.reason instanceof Error
                ? abortController.signal.reason
                : new DOMException('Canceled', 'AbortError'),
            );
          });
        }),
    );
    const factory: TerrainWorkerEngineFactory = () => ({
      fetchContourTile,
      dispose: vi.fn(),
    });
    const server = new TerrainComputeWorkerServer(serverEndpoint, factory);
    const client = new WorkerRpcClient(clientEndpoint);
    await client.request('initialize', initialization());
    const controller = new AbortController();
    const canceled = client.request('contour', contourRequest(8), controller.signal);
    await vi.waitFor(() => {
      expect(fetchContourTile).toHaveBeenCalledOnce();
    });

    controller.abort();

    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    client.dispose();
    server.dispose();
  });

  it('bounds contours during movement, cancels, and drains them sequentially', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const contourCalls: number[] = [];
    const contourFinishes = new Map<number, (value: TerrainContourTile) => void>();
    const fetchContourTile = vi.fn(
      (
        _zoom: number,
        x: number,
        _y: number,
        _options: TerrainContourOptions,
        _abortController: AbortController,
      ) =>
        new Promise<TerrainContourTile>((resolve) => {
          contourCalls.push(x);
          contourFinishes.set(x, resolve);
        }),
    );
    const factory: TerrainWorkerEngineFactory = () => ({
      fetchContourTile,
      dispose: vi.fn(),
    });
    const server = new TerrainComputeWorkerServer(serverEndpoint, factory, () => 0, 2);
    const client = new WorkerRpcClient(clientEndpoint);
    const queueStates: TerrainComputeQueueState[] = [];
    client.subscribeEvent(terrainWorkerEventNames.queueState, (payload) => {
      queueStates.push(payload as TerrainComputeQueueState);
    });
    await client.request('initialize', initialization());
    await client.request('interaction', { active: true });

    const first = client.request('contour', contourRequest(1));
    const secondController = new AbortController();
    const second = client.request(
      'contour',
      contourRequest(2),
      secondController.signal,
    );
    const third = client.request('contour', contourRequest(3));

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    const fourth = client.request('contour', contourRequest(4));
    expect(fetchContourTile).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(queueStates.at(-1)).toEqual({
        executionMode: 'worker',
        activeCount: 0,
        queuedContourCount: 2,
        queueCapacity: 2,
      });
    });

    await client.request('interaction', { active: false });
    await vi.waitFor(() => {
      expect(contourCalls).toEqual([3]);
      expect(queueStates.at(-1)).toMatchObject({
        activeCount: 1,
        queuedContourCount: 1,
      });
    });
    contourFinishes.get(3)?.({ arrayBuffer: new Uint8Array([3]).buffer });
    await expect(third).resolves.toMatchObject({ kind: 'contour' });
    await vi.waitFor(() => {
      expect(contourCalls).toEqual([3, 4]);
    });
    contourFinishes.get(4)?.({ arrayBuffer: new Uint8Array([4]).buffer });
    await expect(fourth).resolves.toMatchObject({ kind: 'contour' });
    await vi.waitFor(() => {
      expect(queueStates.at(-1)).toMatchObject({
        activeCount: 0,
        queuedContourCount: 0,
      });
    });

    client.dispose();
    server.dispose();
  });
});
function contourRequest(x: number) {
  return {
    zoom: 5,
    x,
    y: 9,
    options: { levels: [50, 200] },
  };
}
