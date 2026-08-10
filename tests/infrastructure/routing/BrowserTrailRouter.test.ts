import { describe, expect, it, vi } from 'vitest';

import type {
  TrailRouteProgress,
  TrailRouteSuccess,
} from '@/application/ports/TrailRouter';
import { BrowserTrailRouter } from '@/infrastructure/routing/BrowserTrailRouter';
import { RoutingWorkerServer } from '@/infrastructure/routing/RoutingWorkerServer';
import {
  routingWorkerEvents,
  routingWorkerMethods,
} from '@/infrastructure/routing/RoutingWorkerProtocol';
import { RoutingTileLoader } from '@/infrastructure/routing/routingTiles';
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
      request: {
        start: [44, 42],
        destination: [45, 43],
      },
      progressToken: 1,
    });
    expect(clonedInitialization).not.toHaveProperty('postMessage');
    expect(clonedRequest).not.toHaveProperty('postMessage');

    router.dispose();
    server.dispose();
  });

  it('aborts one concurrent request without canceling the other', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const firstStarted = deferred<undefined>();
    const secondStarted = deferred<undefined>();
    const secondResult = deferred<TrailRouteSuccess>();
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: () => ({ initialized: true }),
      [routingWorkerMethods.route]: (payload, context): Promise<TrailRouteSuccess> => {
        const { request } = payload as {
          readonly request: {
            readonly destination: readonly [number, number];
          };
        };
        if (request.destination[0] === 45) {
          firstStarted.resolve(undefined);
          return new Promise<TrailRouteSuccess>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => {
                reject(new DOMException('Canceled.', 'AbortError'));
              },
              { once: true },
            );
          });
        }
        secondStarted.resolve(undefined);
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
    const routeStarted = deferred<undefined>();
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: () => ({ initialized: true }),
      [routingWorkerMethods.route]: (_payload, context) => {
        routeStarted.resolve(undefined);
        return new Promise<TrailRouteSuccess>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Disposed.', 'AbortError'));
            },
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

  it('forwards progress for the matching route request only', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: () => ({ initialized: true }),
      [routingWorkerMethods.route]: (payload) => {
        const { progressToken } = payload as { readonly progressToken: number };
        server.publishEvent(routingWorkerEvents.progress, {
          progressToken: progressToken + 1,
          progress: {
            phase: 'loading-tiles',
            attempt: 1,
            loadedTileCount: 99,
            totalTileCount: 99,
          },
        });
        server.publishEvent(routingWorkerEvents.progress, {
          progressToken,
          progress: {
            phase: 'loading-tiles',
            attempt: 1,
            loadedTileCount: 4,
            totalTileCount: 9,
          },
        });
        return success();
      },
    });
    const router = new BrowserTrailRouter(initialization, () => clientEndpoint);
    const progress: TrailRouteProgress[] = [];

    await expect(
      router.route(
        { start: [44, 42], destination: [45, 43] },
        new AbortController().signal,
        (value) => {
          progress.push(value);
        },
      ),
    ).resolves.toEqual(success());
    expect(progress).toEqual([
      {
        phase: 'loading-tiles',
        attempt: 1,
        loadedTileCount: 4,
        totalTileCount: 9,
      },
    ]);

    router.dispose();
    server.dispose();
  });

  it('returns a recoverable failure when calculation exceeds its time budget', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const requestAborted = deferred<undefined>();
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: () => ({ initialized: true }),
      [routingWorkerMethods.route]: (_payload, context) =>
        new Promise<TrailRouteSuccess>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              requestAborted.resolve(undefined);
              reject(new DOMException('Timed out.', 'AbortError'));
            },
            { once: true },
          );
        }),
    });
    const router = new BrowserTrailRouter(initialization, () => clientEndpoint, 10);

    await expect(
      router.route(
        { start: [44, 42], destination: [45, 43] },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'routing-timeout' });
    await requestAborted.promise;

    router.dispose();
    server.dispose();
  });

  it('applies cancellation and the time budget while initialization is pending', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const initializationPending = deferred<{ readonly initialized: true }>();
    const route = vi.fn();
    const server = new WorkerRpcServer(serverEndpoint, {
      [routingWorkerMethods.initialize]: () => initializationPending.promise,
      [routingWorkerMethods.route]: route,
    });
    const router = new BrowserTrailRouter(initialization, () => clientEndpoint, 10);

    await expect(
      router.route(
        { start: [44, 42], destination: [45, 43] },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'routing-timeout' });
    const controller = new AbortController();
    const canceled = router.route(
      { start: [44, 42], destination: [45, 43] },
      controller.signal,
    );
    controller.abort(new DOMException('Canceled.', 'AbortError'));
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    expect(route).not.toHaveBeenCalled();

    router.dispose();
    server.dispose();
  });

  it('disposes a loader that resolves after the routing worker shuts down', async () => {
    const initializedLoader = await RoutingTileLoader.initialize(
      initialization,
      new AbortController().signal,
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            tilejson: '3.0.0',
            tiles: ['https://routing.test/tiles/{z}/{x}/{y}.pbf'],
            minzoom: 0,
            maxzoom: 14,
          }),
        ),
      ),
    );
    if (initializedLoader.status === 'failed') {
      throw new Error(initializedLoader.reason);
    }
    const dispose = vi.spyOn(initializedLoader.loader, 'dispose');
    const initializationStarted = deferred<undefined>();
    const initializationPending =
      deferred<Awaited<ReturnType<typeof RoutingTileLoader.initialize>>>();
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new RoutingWorkerServer(serverEndpoint, () => {
      initializationStarted.resolve(undefined);
      return initializationPending.promise;
    });
    const router = new BrowserTrailRouter(initialization, () => clientEndpoint);
    const route = router.route(
      { start: [44, 42], destination: [45, 43] },
      new AbortController().signal,
    );
    await initializationStarted.promise;

    router.dispose();
    server.dispose();
    initializationPending.resolve(initializedLoader);

    await expect(route).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => {
      expect(dispose).toHaveBeenCalledOnce();
    });
  });
});
