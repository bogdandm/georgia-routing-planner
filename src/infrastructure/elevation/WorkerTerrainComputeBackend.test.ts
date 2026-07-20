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
  TerrainDecodedDemTile,
  TerrainDemResponse,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import {
  terrainWorkerEventNames,
  type TerrainWorkerInitializeRequest,
} from '@/infrastructure/elevation/TerrainComputeProtocol';
import { WorkerTerrainComputeBackend } from '@/infrastructure/elevation/WorkerTerrainComputeBackend';
import {
  type WorkerRpcEndpoint,
  WorkerRpcServer,
} from '@/infrastructure/runtime/WorkerRpc';

class MemoryEndpoint implements WorkerRpcEndpoint {
  readonly messages = new Set<EventListener>();
  readonly errors = new Map<'error' | 'messageerror', Set<EventListener>>();
  peer: MemoryEndpoint | null = null;
  terminated = false;

  public postMessage(message: unknown): void {
    const peer = this.peer;
    queueMicrotask(() => {
      for (const listener of peer?.messages ?? []) {
        listener(new MessageEvent('message', { data: message }));
      }
    });
  }

  public addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void {
    if (type === 'message') this.messages.add(listener);
    else {
      const listeners = this.errors.get(type) ?? new Set();
      listeners.add(listener);
      this.errors.set(type, listeners);
    }
  }

  public removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void {
    if (type === 'message') this.messages.delete(listener);
    else this.errors.get(type)?.delete(listener);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public fail(): void {
    for (const listener of this.errors.get('error') ?? []) listener(new Event('error'));
  }
}

function pair(): readonly [MemoryEndpoint, MemoryEndpoint] {
  const client = new MemoryEndpoint();
  const server = new MemoryEndpoint();
  client.peer = server;
  server.peer = client;
  return [client, server];
}

class FakeInlineBackend implements TerrainComputeBackend {
  public readonly loaded = Promise.resolve();
  readonly setFilterEnabled = vi.fn();
  readonly setInteractionActive = vi.fn();
  readonly dispose = vi.fn();
  readonly fetchTile = vi.fn((): Promise<TerrainDemResponse> =>
    Promise.resolve({ data: new Blob([new Uint8Array([9])]) }),
  );

  public fetchAndParseTile(): Promise<TerrainDecodedDemTile> {
    return Promise.reject(new Error('Not used.'));
  }

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

  public subscribeDiagnostic(_listener: (input: DiagnosticInput) => void): () => void {
    return () => undefined;
  }
}

function terrain() {
  return parseMapProviderConfiguration(
    defaultMapProviderConfigurationInput,
    'https://example.test/',
  ).terrain;
}

describe('WorkerTerrainComputeBackend', () => {
  it('replays state, retries once on a fresh worker, then keeps features through inline fallback', async () => {
    const clients: MemoryEndpoint[] = [];
    const servers: WorkerRpcServer[] = [];
    const initializations: TerrainWorkerInitializeRequest[] = [];
    const demCalls: number[] = [];
    const secondWorkerDem = vi.fn();
    const workerFactory = () => {
      const workerIndex = clients.length;
      const [clientEndpoint, serverEndpoint] = pair();
      clients.push(clientEndpoint);
      let calls = 0;
      const server = new WorkerRpcServer(serverEndpoint, {
        initialize: (payload) => {
          initializations.push(payload as TerrainWorkerInitializeRequest);
          return { initialized: true };
        },
        'set-filter': () => ({ accepted: true }),
        interaction: () => ({ accepted: true }),
        dem: () => {
          calls += 1;
          demCalls.push(workerIndex);
          if (workerIndex === 0 || (workerIndex === 1 && calls === 2)) {
            return new Promise(() => undefined);
          }
          secondWorkerDem();
          return { kind: 'dem', data: new Uint8Array([2]).buffer };
        },
        contour: () => ({ kind: 'contour', data: new ArrayBuffer(0) }),
      });
      servers.push(server);
      return clientEndpoint;
    };
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const logger: DiagnosticLogger = { log, getEvents: () => [] };
    const inline = new FakeInlineBackend();
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      logger,
      workerFactory,
      () => inline,
    );
    await backend.loaded;
    backend.setFilterEnabled(false);
    const firstRequest = backend.fetchTile(5, 8, 9, new AbortController());
    await vi.waitFor(() => {
      expect(demCalls).toEqual([0]);
    });

    clients[0]?.fail();
    const recovered = await firstRequest;

    expect(Array.from(new Uint8Array(await recovered.data.arrayBuffer()))).toEqual([2]);
    expect(secondWorkerDem).toHaveBeenCalledOnce();
    expect(initializations[1]).toMatchObject({
      filterEnabled: false,
      revision: 1,
    });
    expect(backend.getStatus()).toBe('worker');

    const secondRequest = backend.fetchTile(5, 9, 9, new AbortController());
    await vi.waitFor(() => {
      expect(demCalls).toEqual([0, 1, 1]);
    });
    clients[1]?.fail();
    const fallback = await secondRequest;

    expect(Array.from(new Uint8Array(await fallback.data.arrayBuffer()))).toEqual([9]);
    expect(backend.getStatus()).toBe('inline');
    expect(inline.setFilterEnabled).toHaveBeenCalledWith(false);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'map.terrain-worker.fallback' }),
    );
    backend.dispose();
    for (const server of servers) server.dispose();
  });

  it('does not restart the worker for an ordinary tile failure', async () => {
    const [clientEndpoint, serverEndpoint] = pair();
    const server = new WorkerRpcServer(serverEndpoint, {
      initialize: () => ({ initialized: true }),
      dem: () => {
        throw new Error('Provider unavailable');
      },
    });
    const workerFactory = vi.fn(() => clientEndpoint);
    const logger: DiagnosticLogger = { log: vi.fn(), getEvents: () => [] };
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      logger,
      workerFactory,
      () => new FakeInlineBackend(),
    );
    await backend.loaded;

    await expect(backend.fetchTile(5, 8, 9, new AbortController())).rejects.toThrow(
      'Provider unavailable',
    );
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(backend.getStatus()).toBe('worker');
    backend.dispose();
    server.dispose();
  });

  it('publishes validated live contour queue state without exposing tile details', async () => {
    const [clientEndpoint, serverEndpoint] = pair();
    const server = new WorkerRpcServer(serverEndpoint, {
      initialize: () => ({ initialized: true }),
    });
    const logger: DiagnosticLogger = { log: vi.fn(), getEvents: () => [] };
    const backend = new WorkerTerrainComputeBackend(
      terrain(),
      10_000,
      logger,
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
