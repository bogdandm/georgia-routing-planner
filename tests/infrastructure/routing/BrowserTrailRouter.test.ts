import { describe, expect, it, vi } from 'vitest';

import type { TrailRouteSuccess } from '@/application/ports/TrailRouter';
import { BrowserTrailRouter } from '@/infrastructure/routing/BrowserTrailRouter';
import { routingWorkerMethods } from '@/infrastructure/routing/RoutingWorkerProtocol';
import { WorkerRpcServer } from '@/infrastructure/runtime/WorkerRpc';
import { createMemoryWorkerRpcEndpointPair } from '@test/helpers/MemoryWorkerRpcEndpoint';

const initialization = {
  tileJsonUrl: 'https://routing.test/tilejson.json',
  transportationSourceLayer: 'transportation',
  requestTimeoutMs: 5_000,
} as const;

function success(startLongitude = 44, destinationLongitude = 45): TrailRouteSuccess {
  return {
    status: 'ready',
    geometry: {
      type: 'LineString',
      coordinates: [
        [startLongitude, 42],
        [destinationLongitude, 43],
      ],
    },
    networkDistanceMeters: 12_345,
    snappedStart: [startLongitude, 42],
    snappedDestination: [destinationLongitude, 43],
    loadedTileCount: 9,
    graphNodeCount: 120,
    graphEdgeCount: 130,
    expandedAreaRetryUsed: false,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
    },
  };
}

describe('BrowserTrailRouter', () => {
  it('initializes once and returns clone-safe validated route diagnostics', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const initialize = vi.fn(
      (_payload: unknown, _context: unknown) =>
        ({
          initialized: true,
        }) as const,
    );
    const route = vi.fn((_payload: unknown, _context: unknown) => success());
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: initialize,
      [routingWorkerMethods.route]: route,
    });
    const router = new BrowserTrailRouter(initialization, () => clientEndpoint);

    await expect(
      router.route(
        { start: [44, 42], destination: [45, 43] },
        new AbortController().signal,
      ),
    ).resolves.toEqual(success());
    await expect(
      router.route(
        { start: [44, 42], destination: [45, 43] },
        new AbortController().signal,
      ),
    ).resolves.toEqual(success());

    expect(initialize).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledWith(
      initialization,
      expect.objectContaining({ requestId: 1 }),
    );
    expect(route).toHaveBeenCalledTimes(2);
    const clonedInitialization = initialize.mock.calls[0]?.[0];
    const clonedRequest = route.mock.calls[0]?.[0];
    expect(structuredClone(clonedInitialization)).toEqual(initialization);
    expect(structuredClone(clonedRequest)).toEqual({
      start: [44, 42],
      destination: [45, 43],
    });
    expect(clonedInitialization).not.toHaveProperty('postMessage');
    expect(clonedRequest).not.toHaveProperty('postMessage');

    router.dispose();
    server.dispose();
  });

  it('aborts one concurrent request without canceling the other', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const secondResult = deferred<TrailRouteSuccess>();
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: () => ({ initialized: true }),
      [routingWorkerMethods.route]: (payload, context): Promise<TrailRouteSuccess> => {
        const request = payload as {
          readonly destination: readonly [number, number];
        };
        if (request.destination[0] === 45) {
          firstStarted.resolve();
          return new Promise<TrailRouteSuccess>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => reject(new DOMException('Canceled.', 'AbortError')),
              { once: true },
            );
          });
        }
        secondStarted.resolve();
        return secondResult.promise;
      },
    });
    const router = new BrowserTrailRouter(initialization, () => clientEndpoint);
    const firstController = new AbortController();
    const first = router.route(
      { start: [44, 42], destination: [45, 43] },
      firstController.signal,
    );
    const second = router.route(
      { start: [44, 42], destination: [46, 43] },
      new AbortController().signal,
    );
    await Promise.all([firstStarted.promise, secondStarted.promise]);

    firstController.abort(new DOMException('Canceled.', 'AbortError'));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    secondResult.resolve(success(44, 46));
    await expect(second).resolves.toEqual(success(44, 46));

    router.dispose();
    server.dispose();
  });

  it('rejects pending work and terminates the endpoint on dispose', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const routeStarted = deferred<void>();
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: () => ({ initialized: true }),
      [routingWorkerMethods.route]: (_payload, context) => {
        routeStarted.resolve();
        return new Promise<TrailRouteSuccess>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Disposed.', 'AbortError')),
            { once: true },
          );
        });
      },
    });
    const router = new BrowserTrailRouter(initialization, () => clientEndpoint);
    const pending = router.route(
      { start: [44, 42], destination: [45, 43] },
      new AbortController().signal,
    );
    await routeStarted.promise;

    router.dispose();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(clientEndpoint.terminated).toBe(true);
    server.dispose();
  });

  it('maps invalid clone-safe worker results to routing-data-invalid', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: () => ({ initialized: true }),
      [routingWorkerMethods.route]: () => ({ status: 'ready', geometry: null }),
    });
    const router = new BrowserTrailRouter(initialization, () => clientEndpoint);

    await expect(
      router.route(
        { start: [44, 42], destination: [45, 43] },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'routing-data-invalid' });

    router.dispose();
    server.dispose();
  });
});
