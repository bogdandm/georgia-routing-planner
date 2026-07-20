import { describe, expect, it, vi } from 'vitest';

import {
  WorkerRpcClient,
  type WorkerRpcRemoteError,
  WorkerRpcServer,
  type WorkerRpcTransferResult,
  WorkerRpcTransportError,
} from '@/infrastructure/runtime/WorkerRpc';
import { createMemoryWorkerRpcEndpointPair } from '../../../test/helpers/MemoryWorkerRpcEndpoint';

describe('WorkerRpc', () => {
  it('correlates concurrent responses and forwards structured failures', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
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
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
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

  it('structured-clones messages and detaches transferred buffers', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const transferred = new Uint8Array([7, 8, 9]).buffer;
    const server = new WorkerRpcServer(serverEndpoint, {
      bytes: () =>
        ({
          value: { data: transferred },
          transfer: [transferred],
        }) satisfies WorkerRpcTransferResult,
    });
    const client = new WorkerRpcClient(clientEndpoint);

    const result = await client.request<{ readonly data: ArrayBuffer }>('bytes', null);

    expect(transferred.byteLength).toBe(0);
    expect(Array.from(new Uint8Array(result.data))).toEqual([7, 8, 9]);
    client.dispose();
    server.dispose();
  });

  it.each(['error', 'messageerror'] as const)(
    'rejects pending work after a worker %s event',
    async (failureType) => {
      const [clientEndpoint] = createMemoryWorkerRpcEndpointPair();
      const client = new WorkerRpcClient(clientEndpoint);
      const request = client.request('pending', null);

      clientEndpoint.fail(failureType);

      await expect(request).rejects.toBeInstanceOf(WorkerRpcTransportError);
      client.dispose();
    },
  );

  it('publishes events and deterministically closes both endpoints', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
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
