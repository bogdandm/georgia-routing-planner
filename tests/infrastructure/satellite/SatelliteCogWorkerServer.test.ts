import { describe, expect, it, vi } from 'vitest';

import type { SatelliteCogTileRequest } from '@/infrastructure/satellite/SatelliteCogProtocol';
import {
  satelliteCogWorkerMethods,
  SatelliteCogWorkerServer,
} from '@/infrastructure/satellite/SatelliteCogWorkerServer';
import { WorkerRpcClient } from '@/infrastructure/runtime/WorkerRpc';
import { createMemoryWorkerRpcEndpointPair } from '@test/helpers/MemoryWorkerRpcEndpoint';

const request: SatelliteCogTileRequest = {
  sceneKey: 'sentinel-2-l2a:scene-a',
  visualHref: 'https://sentinel.example/visual.tif',
  projectionEpsg: 32_638,
  z: 12,
  x: 2_538,
  y: 1_509,
  tileSize: 256,
};

describe('SatelliteCogWorkerServer', () => {
  it('validates and transfers a rendered browser tile', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const data = new Uint8Array([1, 2, 3]).buffer;
    const render = vi.fn(() => Promise.resolve(data));
    const server = new SatelliteCogWorkerServer(serverEndpoint, { render });
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(satelliteCogWorkerMethods.renderTile, request),
    ).resolves.toEqual({ data });
    expect(render).toHaveBeenCalledWith(request, expect.any(AbortSignal));

    client.dispose();
    server.dispose();
  });

  it('rejects untrusted worker payloads before rasterization', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const render = vi.fn();
    const server = new SatelliteCogWorkerServer(serverEndpoint, { render });
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(satelliteCogWorkerMethods.renderTile, {
        ...request,
        visualHref: 'http://private.example/visual.tif',
      }),
    ).rejects.toThrow();
    expect(render).not.toHaveBeenCalled();

    client.dispose();
    server.dispose();
  });
});
