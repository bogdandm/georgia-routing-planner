import ky from 'ky';

import type { ElevationProvider } from '@/application/ports/ElevationProvider';
import type {
  TrailRouteProgress,
  TrailRouteProgressListener,
  TrailRouteRequest,
  TrailRouteResult,
  TrailRouteSuccess,
} from '@/application/ports/TrailRouter';
import { RasterDemElevationProvider } from '@/infrastructure/elevation/RasterDemElevationProvider';
import {
  parseRoutingWorkerInitializeRequest,
  parseRoutingWorkerRouteRequest,
  routingWorkerEvents,
  routingWorkerMethods,
  type RoutingWorkerInitializeRequest,
  type RoutingWorkerInitializeResult,
} from '@/infrastructure/routing/RoutingWorkerProtocol';
import {
  RoutingTileLoader,
  routingPaddingMeters,
  type RoutingTileLoaderInitialization,
  type RoutingTileLoadResult,
} from '@/infrastructure/routing/routingTiles';
import {
  buildTrailGraph,
  routeTrailGraph,
  sampleTrailGraphTerrain,
  type TrailGraph,
  type TrailGraphTerrain,
} from '@/infrastructure/routing/trailGraph';
import {
  type WorkerRpcEndpoint,
  WorkerRpcServer,
} from '@/infrastructure/runtime/WorkerRpc';

type RoutingTileLoaderInitializer = (
  configuration: RoutingWorkerInitializeRequest,
  signal: AbortSignal,
) => Promise<RoutingTileLoaderInitialization>;

export interface RoutingAreaLoader {
  loadArea(
    start: TrailRouteRequest['start'],
    destination: TrailRouteRequest['destination'],
    paddingMeters: number,
    signal: AbortSignal,
    onProgress?: (loadedTileCount: number, totalTileCount: number) => void,
  ): Promise<RoutingTileLoadResult>;
}

async function yieldForCancellation(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  signal.throwIfAborted();
}

/** Terrain failures degrade to distance-only routing; only cancellation propagates. */
async function loadGraphTerrain(
  graph: TrailGraph,
  elevation: Pick<ElevationProvider, 'sampleMany'> | null,
  signal: AbortSignal,
): Promise<TrailGraphTerrain | null> {
  if (elevation === null) return null;
  try {
    return await sampleTrailGraphTerrain(graph, async (coordinates) =>
      (
        await elevation.sampleMany(
          coordinates.map(([longitude, latitude]) => ({ longitude, latitude })),
          signal,
        )
      ).map((sample) => (sample.status === 'available' ? sample.meters : null)),
    );
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

export async function executeTrailRoute(
  loader: RoutingAreaLoader,
  elevation: Pick<ElevationProvider, 'sampleMany'> | null,
  request: TrailRouteRequest,
  signal: AbortSignal,
  onProgress?: TrailRouteProgressListener,
): Promise<TrailRouteResult> {
  const initialPaddingMeters = routingPaddingMeters(request.start, request.destination);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let loadedTileCount = 0;
    let totalTileCount = 0;
    let graphProgress = 0;
    const report = (phase: TrailRouteProgress['phase']): void => {
      onProgress?.({
        phase,
        attempt: attempt === 0 ? 1 : 2,
        loadedTileCount,
        totalTileCount,
        graphProgress,
      });
    };
    report('loading-tiles');
    const areaResult = await loader.loadArea(
      request.start,
      request.destination,
      initialPaddingMeters * (attempt + 1),
      signal,
      (loaded, total) => {
        loadedTileCount = loaded;
        totalTileCount = total;
        report('loading-tiles');
      },
    );
    if (areaResult.status === 'failed') return areaResult;

    loadedTileCount = areaResult.area.tiles.length;
    totalTileCount = areaResult.area.tiles.length;
    graphProgress = 0;
    report('building-graph');
    await yieldForCancellation(signal);

    const graph = await buildTrailGraph(
      areaResult.area.lines,
      areaResult.area.rectangle,
      async (progress) => {
        graphProgress = progress;
        report('building-graph');
        await yieldForCancellation(signal);
      },
    );
    await yieldForCancellation(signal);
    report('loading-terrain');
    const terrain = await loadGraphTerrain(graph, elevation, signal);
    await yieldForCancellation(signal);
    report('searching-route');
    await yieldForCancellation(signal);
    const route = routeTrailGraph(graph, request.start, request.destination, {
      terrain,
      includeSearchTrace: request.includeSearchTrace,
    });
    await yieldForCancellation(signal);
    if (route.status === 'ready') {
      const result: TrailRouteSuccess = {
        status: 'ready',
        geometry: {
          type: 'LineString',
          coordinates: route.coordinates.map((coordinate) => [
            coordinate[0],
            coordinate[1],
          ]),
        },
        networkDistanceMeters: route.networkDistanceMeters,
        snappedStart: route.snappedStart,
        snappedDestination: route.snappedDestination,
        loadedTileCount: areaResult.area.tiles.length,
        graphNodeCount: graph.nodes.size,
        graphEdgeCount: graph.edges.size,
        expandedAreaRetryUsed: attempt === 1,
        ...(route.searchTrace === undefined ? {} : { searchTrace: route.searchTrace }),
      };
      return result;
    }
    if (route.reason === 'no-nearby-trail') {
      return {
        status: 'failed',
        reason: route.reason,
        endpoint: route.endpoint,
      };
    }
    if (!route.visitedBoundary || attempt === 1) {
      return {
        status: 'failed',
        reason: 'no-route',
        ...(route.searchTrace === undefined ? {} : { searchTrace: route.searchTrace }),
      };
    }
  }
  return { status: 'failed', reason: 'no-route' };
}

/** Validates and executes the two-method routing protocol inside one module worker. */
export class RoutingWorkerServer {
  readonly #rpc: WorkerRpcServer;
  #loader: RoutingTileLoader | null = null;
  #elevation: RasterDemElevationProvider | null = null;
  #initializationGeneration = 0;
  #disposed = false;

  public constructor(
    endpoint: WorkerRpcEndpoint,
    initializeLoader: RoutingTileLoaderInitializer = (configuration, signal) =>
      RoutingTileLoader.initialize(configuration, signal),
  ) {
    this.#rpc = new WorkerRpcServer(
      endpoint,
      {
        [routingWorkerMethods.initialize]: async (
          payload,
          context,
        ): Promise<RoutingWorkerInitializeResult> => {
          const request = parseRoutingWorkerInitializeRequest(payload);
          const generation = this.#initializationGeneration + 1;
          this.#initializationGeneration = generation;
          this.#loader?.dispose();
          this.#loader = null;
          this.#elevation = null;
          const initialization = await initializeLoader(request, context.signal);
          if (initialization.status === 'failed') {
            return { initialized: false, reason: initialization.reason };
          }
          if (
            this.#disposed ||
            context.signal.aborted ||
            generation !== this.#initializationGeneration
          ) {
            initialization.loader.dispose();
            context.signal.throwIfAborted();
            return { initialized: false, reason: 'routing-data-unavailable' };
          }
          this.#loader = initialization.loader;
          this.#elevation = new RasterDemElevationProvider(
            ky.create({ retry: { limit: 0 }, timeout: request.requestTimeoutMs }),
            request.terrain,
            { generate: () => crypto.randomUUID() },
          );
          return { initialized: true };
        },
        [routingWorkerMethods.route]: async (payload, context) => {
          const { request, progressToken } = parseRoutingWorkerRouteRequest(payload);
          if (this.#loader === null) {
            return { status: 'failed', reason: 'routing-data-unavailable' };
          }
          return executeTrailRoute(
            this.#loader,
            this.#elevation,
            request,
            context.signal,
            (progress) => {
              this.#rpc.publishEvent(routingWorkerEvents.progress, {
                progressToken,
                progress,
              });
            },
          );
        },
      },
      () => {
        this.#disposed = true;
        this.#initializationGeneration += 1;
        this.#loader?.dispose();
        this.#loader = null;
        this.#elevation = null;
      },
    );
  }

  public dispose(): void {
    this.#rpc.dispose();
  }
}
