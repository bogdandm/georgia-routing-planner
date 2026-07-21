import type { WorkerRpcEndpoint } from '@/infrastructure/runtime/WorkerRpc';

/** In-memory worker transport with browser-equivalent structured cloning and transfer. */
export class MemoryWorkerRpcEndpoint implements WorkerRpcEndpoint {
  readonly #messageListeners = new Set<EventListener>();
  readonly #errorListeners = new Map<'error' | 'messageerror', Set<EventListener>>();
  #peer: MemoryWorkerRpcEndpoint | null = null;

  public terminated = false;
  public closed = false;

  public connect(peer: MemoryWorkerRpcEndpoint): void {
    this.#peer = peer;
  }

  public postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.terminated || this.closed) return;
    const peer = this.#peer;
    if (peer === null) return;

    // Clone synchronously so transferred buffers detach at the same point as postMessage.
    const clonedMessage = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (peer.terminated || peer.closed) return;
      for (const listener of peer.#messageListeners) {
        listener(new MessageEvent('message', { data: clonedMessage }));
      }
    });
  }

  public addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void {
    if (type === 'message') {
      this.#messageListeners.add(listener);
      return;
    }
    const listeners = this.#errorListeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#errorListeners.set(type, listeners);
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
    for (const listener of this.#errorListeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }
}

export function createMemoryWorkerRpcEndpointPair(): readonly [
  MemoryWorkerRpcEndpoint,
  MemoryWorkerRpcEndpoint,
] {
  const client = new MemoryWorkerRpcEndpoint();
  const server = new MemoryWorkerRpcEndpoint();
  client.connect(server);
  server.connect(client);
  return [client, server];
}
