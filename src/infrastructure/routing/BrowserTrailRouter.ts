import { ZodError } from 'zod';

import type {
  TrailRouteProgressListener,
  TrailRouteRequest,
  TrailRouteResult,
  TrailRouter,
} from '@/application/ports/TrailRouter';
import {
  parseRoutingWorkerInitializeResult,
  parseRoutingWorkerProgressEvent,
  parseTrailRouteResult,
  routingWorkerEvents,
  routingWorkerMethods,
  type RoutingWorkerInitializeRequest,
  type RoutingWorkerInitializeResult,
} from '@/infrastructure/routing/RoutingWorkerProtocol';
import {
  type WorkerRpcEndpoint,
  WorkerRpcClient,
} from '@/infrastructure/runtime/WorkerRpc';

type RoutingWorkerFactory = () => WorkerRpcEndpoint;

export const ROUTE_CALCULATION_TIMEOUT_MS = 60_000;

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

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Route request canceled.', 'AbortError'),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(
          error instanceof Error
            ? error
            : new Error('Routing initialization failed.', { cause: error }),
        );
      },
    );
  });
}

/** Owns one browser routing worker and validates every value crossing its RPC channel. */
export class BrowserTrailRouter implements TrailRouter {
  readonly #rpc: WorkerRpcClient | null;
  readonly #initialized: Promise<RoutingWorkerInitializeResult>;
  #disposed = false;
  #nextProgressToken = 1;

  public constructor(
    initialization: RoutingWorkerInitializeRequest,
    workerFactory: RoutingWorkerFactory = createRoutingWorker,
    private readonly routeTimeoutMs = ROUTE_CALCULATION_TIMEOUT_MS,
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
    onProgress?: TrailRouteProgressListener,
  ): Promise<TrailRouteResult> {
    throwIfAborted(signal);
    const rpc = this.#rpc;
    if (this.#disposed || rpc === null) {
      return { status: 'failed', reason: 'routing-data-unavailable' };
    }

    const timeoutSignal = AbortSignal.timeout(this.routeTimeoutMs);
    const routeSignal = AbortSignal.any([signal, timeoutSignal]);
    let initialized: RoutingWorkerInitializeResult;
    try {
      initialized = await waitForSignal(this.#initialized, routeSignal);
    } catch (error) {
      return this.routeFailure(error, signal, timeoutSignal);
    }
    if (this.isDisposed()) {
      throw new DOMException('Trail router disposed.', 'AbortError');
    }
    if (!initialized.initialized) {
      return { status: 'failed', reason: initialized.reason };
    }

    const progressToken = this.#nextProgressToken;
    this.#nextProgressToken += 1;
    const unsubscribe = rpc.subscribeEvent(routingWorkerEvents.progress, (payload) => {
      try {
        const event = parseRoutingWorkerProgressEvent(payload);
        if (event.progressToken === progressToken) onProgress?.(event.progress);
      } catch {
        return;
      }
    });
    try {
      const result = await rpc.request<unknown>(
        routingWorkerMethods.route,
        { request, progressToken },
        routeSignal,
      );
      return parseTrailRouteResult(result);
    } catch (error) {
      return this.routeFailure(error, signal, timeoutSignal);
    } finally {
      unsubscribe();
    }
  }

  private routeFailure(
    error: unknown,
    signal: AbortSignal,
    timeoutSignal: AbortSignal,
  ): TrailRouteResult {
    if (this.isDisposed()) {
      throw new DOMException('Trail router disposed.', 'AbortError');
    }
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Route request canceled.', 'AbortError');
    }
    if (timeoutSignal.aborted) {
      return { status: 'failed', reason: 'routing-timeout' };
    }
    return {
      status: 'failed',
      reason:
        error instanceof ZodError ? 'routing-data-invalid' : 'routing-data-unavailable',
    };
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
