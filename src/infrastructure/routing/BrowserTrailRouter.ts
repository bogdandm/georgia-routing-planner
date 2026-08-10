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
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Route request canceled.', 'AbortError');
    }
    if (this.#disposed || this.#rpc === null) {
      return { status: 'failed', reason: 'routing-data-unavailable' };
    }

    const initialized = await this.#initialized;
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Route request canceled.', 'AbortError');
    }
    if (this.#disposed) {
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
      if (this.#disposed) {
        throw new DOMException('Trail router disposed.', 'AbortError');
      }
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
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

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rpc?.dispose();
  }
}
