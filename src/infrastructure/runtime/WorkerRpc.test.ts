import { describe, expect, it, vi } from 'vitest';

import {
  WorkerRpcClient,
  type WorkerRpcEndpoint,
  type WorkerRpcRemoteError,
  WorkerRpcServer,
  WorkerRpcTransportError,
} from '@/infrastructure/runtime/WorkerRpc';

class MemoryWorkerEndpoint implements WorkerRpcEndpoint {
  readonly #messageListeners = new Set<EventListener>();
  readonly #errorListeners = new Map<'error' | 'messageerror', Set<EventListener>>();
  peer: MemoryWorkerEndpoint | null = null;
  terminated = false;
  closed = false;

  public postMessage(message: unknown): void {
    const peer = this.peer;
    if (peer === null) return;
    queueMicrotask(() => {
      for (const listener of peer.#messageListeners) {
        listener(new MessageEvent('message', { data: message }));
      }
    });
  }

  public addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void {
    if (type === 'message') this.#messageListeners.add(listener);
    else {
      const listeners = this.#errorListeners.get(type) ?? new Set();
      listeners.add(listener);
      this.#errorListeners.set(type, listeners);
    }
  }

  public removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void {
    if (type === 'message') this.#messageListeners.delete(listener);
    else this.#errorListeners.get(type)?.delete(listener);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public close(): void {
    this.closed = true;
  }

  public fail(type: 'error' | 'messageerror' = 'error'): void {
    for (const listener of this.#errorListeners.get(type) ?? [])
      listener(new Event(type));
  }
}

function endpointPair(): readonly [MemoryWorkerEndpoint, MemoryWorkerEndpoint] {
  const client = new MemoryWorkerEndpoint();
  const server = new MemoryWorkerEndpoint();
  client.peer = server;
  server.peer = client;
  return [client, server];
}

describe('WorkerRpc', () => {
  it('correlates concurrent responses and forwards structured failures', async () => {
    const [clientEndpoint, serverEndpoint] = endpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {
      echo: (payload) => payload,
      fail: () => {
        throw new TypeError('Bad request');
      },
    });
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      Promise.all([
        client.request<string>('echo', 'first'),
        client.request<string>('echo', 'second'),
      ]),
    ).resolves.toEqual(['first', 'second']);
    await expect(client.request('fail', null)).rejects.toEqual(
      expect.objectContaining<Partial<WorkerRpcRemoteError>>({
        name: 'TypeError',
        message: 'Bad request',
      }),
    );

    client.dispose();
    server.dispose();
  });

  it('forwards cancellation to the active server handler', async () => {
    const [clientEndpoint, serverEndpoint] = endpointPair();
    const canceled = vi.fn();
    const server = new WorkerRpcServer(serverEndpoint, {
      pending: (_payload, context) =>
        new Promise((_resolve, reject) => {
          const handleAbort = () => {
            canceled();
            reject(
              context.signal.reason instanceof Error
                ? context.signal.reason
                : new DOMException('Canceled', 'AbortError'),
            );
          };
          if (context.signal.aborted) handleAbort();
          else context.signal.addEventListener('abort', handleAbort);
        }),
    });
    const client = new WorkerRpcClient(clientEndpoint);
    const controller = new AbortController();
    const request = client.request('pending', null, controller.signal);

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => {
      expect(canceled).toHaveBeenCalledOnce();
    });
    client.dispose();
    server.dispose();
  });

  it.each(['error', 'messageerror'] as const)(
    'rejects pending work after a worker %s event',
    async (failureType) => {
      const [clientEndpoint] = endpointPair();
      const client = new WorkerRpcClient(clientEndpoint);
      const request = client.request('pending', null);

      clientEndpoint.fail(failureType);

      await expect(request).rejects.toBeInstanceOf(WorkerRpcTransportError);
      client.dispose();
    },
  );

  it('publishes events and deterministically closes both endpoints', async () => {
    const [clientEndpoint, serverEndpoint] = endpointPair();
    const disposed = vi.fn();
    const server = new WorkerRpcServer(serverEndpoint, {}, disposed);
    const client = new WorkerRpcClient(clientEndpoint);
    const listener = vi.fn();
    client.subscribeEvent('status', listener);

    server.publishEvent('status', { mode: 'worker' });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({ mode: 'worker' });
    });
    client.dispose();
    await vi.waitFor(() => {
      expect(disposed).toHaveBeenCalledOnce();
    });
    expect(clientEndpoint.terminated).toBe(true);
    expect(serverEndpoint.closed).toBe(true);
  });
});
