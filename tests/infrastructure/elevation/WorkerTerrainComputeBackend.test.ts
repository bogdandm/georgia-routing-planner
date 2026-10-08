import { describe, expect, it, vi } from 'vitest';

import type {
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type {
  TerrainComputeBackend,
  TerrainComputeMetrics,
  TerrainComputeQueueState,
  TerrainComputeStatus,
  TerrainContourOptions,
  TerrainContourTile,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import {
  parseTerrainWorkerInitializeRequest,
  terrainWorkerEventNames,
  type TerrainWorkerInitializeRequest,
} from '@/infrastructure/elevation/TerrainComputeProtocol';
import { WorkerTerrainComputeBackend } from '@/infrastructure/elevation/WorkerTerrainComputeBackend';
import { WorkerRpcServer } from '@/infrastructure/runtime/WorkerRpc';
import {
  createMemoryWorkerRpcEndpointPair,
  type MemoryWorkerRpcEndpoint,
} from '@test/helpers/MemoryWorkerRpcEndpoint';

class FakeInlineBackend implements TerrainComputeBackend {
  public readonly loaded = Promise.resolve();
  readonly setInteractionActive = vi.fn();
  readonly dispose = vi.fn();

  public fetchContourTile(
    _zoom: number,
    _x: number,
    _y: number,
    _options: TerrainContourOptions,
    _abortController: AbortController,
  ): Promise<TerrainContourTile> {
    return Promise.resolve({ arrayBuffer: new Uint8Array([9]).buffer });
  }

  public getStatus(): TerrainComputeStatus {
    return 'inline';
  }

  public getQueueState(): TerrainComputeQueueState {
    return {
      executionMode: 'inline',
      activeCount: 0,
      queuedContourCount: 0,
      queueCapacity: 0,
    };
  }

  public subscribeStatus(): () => void {
    return () => undefined;
  }

  public subscribeQueueState(
    _listener: (state: TerrainComputeQueueState) => void,
  ): () => void {
    return () => undefined;
  }

  public subscribeMetrics(
    _listener: (metrics: TerrainComputeMetrics) => void,
  ): () => void {
    return () => undefined;
  }
}

function terrain() {
  return parseMapProviderConfiguration(
    defaultMapProviderConfigurationInput,
    'https://example.test/',
  ).terrain;
}

function silentLogger(): DiagnosticLogger {
  return {
    log: vi.fn(),
    getEvents: () => [],
    subscribe: () => () => undefined,
  };
}

function requestContour(
  backend: WorkerTerrainComputeBackend,
  x = 8,
  abortController = new AbortController(),
): Promise<TerrainContourTile> {
  return backend.fetchContourTile(5, x, 9, { levels: [50, 200] }, abortController);
}

describe('WorkerTerrainComputeBackend', () => {
  it('initializes the current canonical configuration without inline fallback', async () => {
    const servers: WorkerRpcServer[] = [];
    const initializations: TerrainWorkerInitializeRequest[] = [];
    const workerFactory = vi.fn(() => {
      const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
      servers.push(
        new WorkerRpcServer(serverEndpoint, {
          initialize: (payload) => {
            const request = parseTerrainWorkerInitializeRequest(payload);
            initializations.push(request);
            return { initialized: true };
          },
        }),
      );
      return clientEndpoint;
    });
    const inlineFactory = vi.fn(() => new FakeInlineBackend());

    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      silentLogger(),
      workerFactory,
      inlineFactory,
    );
    await backend.loaded;

    expect(backend.getStatus()).toBe('worker');
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(inlineFactory).not.toHaveBeenCalled();
    expect(initializations[0]?.configuration).toMatchObject({
      schemaVersion: 2,
      maximumSourceZoom: 12,
    });
    backend.dispose();
    for (const server of servers) server.dispose();
  });

  it('replays interaction state, retries once on a fresh worker, then keeps contours through inline fallback', async () => {
    const clients: MemoryWorkerRpcEndpoint[] = [];
    const servers: WorkerRpcServer[] = [];
    const initializations: TerrainWorkerInitializeRequest[] = [];
    const contourCalls: number[] = [];
    const secondWorkerContour = vi.fn();
    const workerFactory = () => {
      const workerIndex = clients.length;
      const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
      clients.push(clientEndpoint);
      let calls = 0;
      const server = new WorkerRpcServer(serverEndpoint, {
        initialize: (payload) => {
          initializations.push(payload as TerrainWorkerInitializeRequest);
          return { initialized: true };
        },
        interaction: () => ({ accepted: true }),
        contour: () => {
          calls += 1;
          contourCalls.push(workerIndex);
          if (workerIndex === 0 || (workerIndex === 1 && calls === 2)) {
            return new Promise(() => undefined);
          }
          secondWorkerContour();
          return { kind: 'contour', data: new Uint8Array([2]).buffer };
        },
      });
      servers.push(server);
      return clientEndpoint;
    };
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const logger: DiagnosticLogger = {
      log,
      getEvents: () => [],
      subscribe: () => () => undefined,
    };
    const inline = new FakeInlineBackend();
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      logger,
      workerFactory,
      () => inline,
    );
    await backend.loaded;
    backend.setInteractionActive(true);
    const firstRequest = requestContour(backend);
    await vi.waitFor(() => {
      expect(contourCalls).toEqual([0]);
    });

    clients[0]?.fail();
    const recovered = await firstRequest;

    expect(Array.from(new Uint8Array(recovered.arrayBuffer))).toEqual([2]);
    expect(secondWorkerContour).toHaveBeenCalledOnce();
    expect(initializations[1]).toMatchObject({ interactionActive: true });
    expect(backend.getStatus()).toBe('worker');

    const secondRequest = requestContour(backend, 9);
    await vi.waitFor(() => {
      expect(contourCalls).toEqual([0, 1, 1]);
    });
    clients[1]?.fail();
    const fallback = await secondRequest;

    expect(Array.from(new Uint8Array(fallback.arrayBuffer))).toEqual([9]);
    expect(backend.getStatus()).toBe('inline');
    expect(inline.setInteractionActive).toHaveBeenCalledWith(true);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'map.terrain-worker.fallback' }),
    );
    backend.dispose();
    for (const server of servers) server.dispose();
  });

  it('does not restart the worker for an ordinary tile failure', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {
      initialize: () => ({ initialized: true }),
      contour: () => {
        throw new Error('Provider unavailable');
      },
    });
    const workerFactory = vi.fn(() => clientEndpoint);
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      silentLogger(),
      workerFactory,
      () => new FakeInlineBackend(),
    );
    await backend.loaded;

    await expect(requestContour(backend)).rejects.toThrow('Provider unavailable');
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(backend.getStatus()).toBe('worker');
    backend.dispose();
    server.dispose();
  });

  it('restarts and retries after a malformed contour result', async () => {
    const servers: WorkerRpcServer[] = [];
    let workerIndex = 0;
    const workerFactory = vi.fn(() => {
      const currentWorker = workerIndex;
      workerIndex += 1;
      const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
      servers.push(
        new WorkerRpcServer(serverEndpoint, {
          initialize: () => ({ initialized: true }),
          contour: () =>
            currentWorker === 0
              ? { kind: 'invalid' }
              : { kind: 'contour', data: new Uint8Array([3]).buffer },
        }),
      );
      return clientEndpoint;
    });
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      silentLogger(),
      workerFactory,
      () => new FakeInlineBackend(),
    );
    await backend.loaded;

    const result = await requestContour(backend);

    expect(Array.from(new Uint8Array(result.arrayBuffer))).toEqual([3]);
    expect(workerFactory).toHaveBeenCalledTimes(2);
    expect(backend.getStatus()).toBe('worker');
    backend.dispose();
    for (const server of servers) server.dispose();
  });

  it('uses terminal inline fallback after a second malformed result', async () => {
    const servers: WorkerRpcServer[] = [];
    const workerFactory = vi.fn(() => {
      const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
      servers.push(
        new WorkerRpcServer(serverEndpoint, {
          initialize: () => ({ initialized: true }),
          contour: () => ({ kind: 'invalid' }),
        }),
      );
      return clientEndpoint;
    });
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      silentLogger(),
      workerFactory,
      () => new FakeInlineBackend(),
    );
    await backend.loaded;

    const result = await requestContour(backend);

    expect(Array.from(new Uint8Array(result.arrayBuffer))).toEqual([9]);
    expect(workerFactory).toHaveBeenCalledTimes(2);
    expect(backend.getStatus()).toBe('inline');
    backend.dispose();
    for (const server of servers) server.dispose();
  });

  it('keeps request cancellation out of worker recovery', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const started = vi.fn();
    const canceled = vi.fn();
    const server = new WorkerRpcServer(serverEndpoint, {
      initialize: () => ({ initialized: true }),
      contour: (_payload, context) =>
        new Promise((_resolve, reject) => {
          started();
          context.signal.addEventListener('abort', () => {
            canceled();
            reject(new DOMException('Canceled', 'AbortError'));
          });
        }),
    });
    const workerFactory = vi.fn(() => clientEndpoint);
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      silentLogger(),
      workerFactory,
      () => new FakeInlineBackend(),
    );
    await backend.loaded;
    const controller = new AbortController();
    const request = requestContour(backend, 8, controller);
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalledOnce();
    });

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => {
      expect(canceled).toHaveBeenCalledOnce();
    });
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(backend.getStatus()).toBe('worker');
    backend.dispose();
    server.dispose();
  });

  it('makes disposal terminal for active and subsequent requests', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const started = vi.fn();
    const server = new WorkerRpcServer(serverEndpoint, {
      initialize: () => ({ initialized: true }),
      contour: () =>
        new Promise(() => {
          started();
        }),
    });
    const workerFactory = vi.fn(() => clientEndpoint);
    const inlineFactory = vi.fn(() => new FakeInlineBackend());
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      silentLogger(),
      workerFactory,
      inlineFactory,
    );
    await backend.loaded;
    const activeRequest = requestContour(backend);
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalledOnce();
    });

    backend.dispose();

    await expect(activeRequest).rejects.toMatchObject({ name: 'AbortError' });
    await expect(requestContour(backend, 9)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(inlineFactory).not.toHaveBeenCalled();
    server.dispose();
  });

  it('publishes validated live contour queue state without exposing tile details', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {
      initialize: () => ({ initialized: true }),
    });
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      silentLogger(),
      () => clientEndpoint,
      () => new FakeInlineBackend(),
    );
    await backend.loaded;
    const listener = vi.fn<(state: TerrainComputeQueueState) => void>();
    backend.subscribeQueueState(listener);

    server.publishEvent(terrainWorkerEventNames.queueState, {
      executionMode: 'worker',
      activeCount: 1,
      queuedContourCount: 4,
      queueCapacity: 32,
    });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({
        executionMode: 'worker',
        activeCount: 1,
        queuedContourCount: 4,
        queueCapacity: 32,
      });
    });
    expect(backend.getQueueState()).toEqual(listener.mock.calls.at(-1)?.[0]);

    backend.dispose();
    server.dispose();
  });
});
