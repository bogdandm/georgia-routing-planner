import { ZodError } from 'zod';

import type {
  TrailRouteRequest,
  TrailRouteResult,
  TrailRouter,
} from '@/application/ports/TrailRouter';
import {
  parseRoutingWorkerInitializeResult,
  parseTrailRouteResult,
  routingWorkerMethods,
  type RoutingWorkerInitializeRequest,
  type RoutingWorkerInitializeResult,
} from '@/infrastructure/routing/RoutingWorkerProtocol';
import {
  type WorkerRpcEndpoint,
  WorkerRpcClient,
} from '@/infrastructure/runtime/WorkerRpc';

type RoutingWorkerFactory = () => WorkerRpcEndpoint;

function createRoutingWorker(): WorkerRpcEndpoint {
  return new Worker(new URL('./routing.worker.ts', import.meta.url), {
    type: 'module',
    name: 'trail-routing',
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Route request canceled.', 'AbortError');
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
  );
}

/** Owns one browser routing worker and validates every value crossing its RPC channel. */
export class BrowserTrailRouter implements TrailRouter {
  readonly #rpc: WorkerRpcClient | null;
  readonly #initialized: Promise<RoutingWorkerInitializeResult>;
  #disposed = false;

  public constructor(
    initialization: RoutingWorkerInitializeRequest,
    workerFactory: RoutingWorkerFactory = createRoutingWorker,
  ) {
    try {
      this.#rpc = new WorkerRpcClient(workerFactory());
      this.#initialized = this.#rpc
        .request<unknown>(routingWorkerMethods.initialize, initialization)
        .then(parseRoutingWorkerInitializeResult)
        .catch((error: unknown) => ({
          initialized: false,
          reason:
            error instanceof ZodError
              ? 'routing-data-invalid'
              : 'routing-data-unavailable',
        }));
    } catch {
      this.#rpc = null;
      this.#initialized = Promise.resolve({
        initialized: false,
        reason: 'routing-data-unavailable',
      });
    }
  }

  public async route(
    request: TrailRouteRequest,
    signal: AbortSignal,
  ): Promise<TrailRouteResult> {
    throwIfAborted(signal);
    if (this.#disposed || this.#rpc === null) {
      return { status: 'failed', reason: 'routing-data-unavailable' };
    }

    const initialized = await this.#initialized;
    throwIfAborted(signal);
    if (this.isDisposed()) {
      throw new DOMException('Trail router disposed.', 'AbortError');
    }
    if (!initialized.initialized) {
      return { status: 'failed', reason: initialized.reason };
    }

    try {
      const result = await this.#rpc.request<unknown>(
        routingWorkerMethods.route,
        request,
        signal,
      );
      return parseTrailRouteResult(result);
    } catch (error) {
      if (this.isDisposed()) {
        throw new DOMException('Trail router disposed.', 'AbortError');
      }
      if (isAbortError(error, signal)) {
        throw signal.reason instanceof Error ? signal.reason : error;
      }
      return {
        status: 'failed',
        reason:
          error instanceof ZodError
            ? 'routing-data-invalid'
            : 'routing-data-unavailable',
      };
    }
  }

  private isDisposed(): boolean {
    return this.#disposed;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rpc?.dispose();
  }
}
