import type {
  TrailRouteRequest,
  TrailRouteResult,
  TrailRouteSuccess,
} from '@/application/ports/TrailRouter';
import {
  parseRoutingWorkerInitializeRequest,
  parseTrailRouteRequest,
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
import { buildTrailGraph, routeTrailGraph } from '@/infrastructure/routing/trailGraph';
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
  ): Promise<RoutingTileLoadResult>;
}

export async function executeTrailRoute(
  loader: RoutingAreaLoader,
  request: TrailRouteRequest,
  signal: AbortSignal,
): Promise<TrailRouteResult> {
  const initialPaddingMeters = routingPaddingMeters(request.start, request.destination);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const areaResult = await loader.loadArea(
      request.start,
      request.destination,
      initialPaddingMeters * (attempt + 1),
      signal,
    );
    if (areaResult.status === 'failed') return areaResult;

    const graph = buildTrailGraph(areaResult.area.lines, areaResult.area.rectangle);
    const route = routeTrailGraph(graph, request.start, request.destination);
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
      return { status: 'failed', reason: 'no-route' };
    }
  }
  return { status: 'failed', reason: 'no-route' };
}

/** Validates and executes the two-method routing protocol inside one module worker. */
export class RoutingWorkerServer {
  readonly #rpc: WorkerRpcServer;
  #loader: RoutingTileLoader | null = null;

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
          this.#loader?.dispose();
          this.#loader = null;
          const initialization = await initializeLoader(request, context.signal);
          if (initialization.status === 'failed') {
            return { initialized: false, reason: initialization.reason };
          }
          this.#loader = initialization.loader;
          return { initialized: true };
        },
        [routingWorkerMethods.route]: async (payload, context) => {
          const request = parseTrailRouteRequest(payload);
          if (this.#loader === null) {
            return { status: 'failed', reason: 'routing-data-unavailable' };
          }
          return executeTrailRoute(this.#loader, request, context.signal);
        },
      },
      () => {
        this.#loader?.dispose();
        this.#loader = null;
      },
    );
  }

  public dispose(): void {
    this.#rpc.dispose();
  }
}
