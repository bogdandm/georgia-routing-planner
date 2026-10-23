import ky from 'ky';

import type { ElevationProvider } from '@/application/ports/ElevationProvider';
import type {
  TrailRouteFailure,
  TrailRouteLeg,
  TrailRouteProgress,
  TrailRouteProgressListener,
  TrailRouteRequest,
  TrailRouteResult,
  TrailRouteSearchArc,
  TrailRouteSuccess,
} from '@/application/ports/TrailRouter';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
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
  routingLegBounds,
  type RoutingBounds,
  type RoutingTileLoaderInitialization,
  type RoutingTileLoadResult,
} from '@/infrastructure/routing/routingTiles';
import {
  buildTrailGraph,
  routeTrailGraph,
  sampleTrailGraphTerrain,
  snapCoordinateToTrailGraph,
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
    areas: readonly RoutingBounds[],
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

type TrailRouteSuccessBuilder = {
  -readonly [Key in keyof TrailRouteSuccess]: TrailRouteSuccess[Key];
};
type TrailRouteFailureBuilder = {
  -readonly [Key in keyof TrailRouteFailure]: TrailRouteFailure[Key];
};

/**
 * Routes every consecutive waypoint pair on one graph per attempt: tiles, graph, and
 * terrain load once, then each leg runs its own search. The second attempt doubles every
 * leg's padding when a leg's exhausted search reached the covered tiles' edge.
 */
export async function executeTrailRoute(
  loader: RoutingAreaLoader,
  elevation: Pick<ElevationProvider, 'sampleMany'> | null,
  request: TrailRouteRequest,
  signal: AbortSignal,
  onProgress?: TrailRouteProgressListener,
): Promise<TrailRouteResult> {
  const { waypoints, includeSearchTrace } = request;
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
      routingLegBounds(waypoints, attempt + 1),
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
      areaResult.area.tiles,
      async (progress) => {
        graphProgress = progress;
        report('building-graph');
        await yieldForCancellation(signal);
      },
    );
    await yieldForCancellation(signal);

    // Each waypoint snaps once, so a leg ends exactly where the next one begins.
    const snapped: TrackCoordinate[] = [];
    const unsnappableIndexes: number[] = [];
    for (const [index, waypoint] of waypoints.entries()) {
      const snap = snapCoordinateToTrailGraph(graph, waypoint);
      if (snap === null) unsnappableIndexes.push(index);
      else snapped.push(snap);
    }
    if (unsnappableIndexes.length > 0) {
      return {
        status: 'failed',
        reason: 'no-nearby-trail',
        waypointIndexes: unsnappableIndexes,
      };
    }

    report('loading-terrain');
    const terrain = await loadGraphTerrain(graph, elevation, signal);
    await yieldForCancellation(signal);

    const legs: TrailRouteLeg[] = [];
    const forwardTrace: TrailRouteSearchArc[] = [];
    const backwardTrace: TrailRouteSearchArc[] = [];
    let retryWithExpandedArea = false;
    for (let legIndex = 0; legIndex + 1 < waypoints.length; legIndex += 1) {
      const start = waypoints[legIndex];
      const destination = waypoints[legIndex + 1];
      const snappedStart = snapped[legIndex];
      const snappedDestination = snapped[legIndex + 1];
      if (
        start === undefined ||
        destination === undefined ||
        snappedStart === undefined ||
        snappedDestination === undefined
      ) {
        throw new Error('Route waypoints and their snaps are misaligned.');
      }
      report('searching-route');
      await yieldForCancellation(signal);
      const route = routeTrailGraph(graph, start, destination, {
        terrain,
        includeSearchTrace,
      });
      if (route.status === 'failed' && route.reason === 'no-nearby-trail') {
        // Unreachable after the snap check above; kept exhaustive for the graph API.
        return {
          status: 'failed',
          reason: 'no-nearby-trail',
          waypointIndexes:
            route.endpoint === 'both'
              ? [legIndex, legIndex + 1]
              : [route.endpoint === 'start' ? legIndex : legIndex + 1],
        };
      }
      if (route.searchTrace !== undefined) {
        for (const arc of route.searchTrace.forward) forwardTrace.push(arc);
        for (const arc of route.searchTrace.backward) backwardTrace.push(arc);
      }
      if (route.status === 'failed') {
        if (route.visitedBoundary && attempt === 0) {
          retryWithExpandedArea = true;
          break;
        }
        const failure: TrailRouteFailureBuilder = {
          status: 'failed',
          reason: 'no-route',
          legIndex,
        };
        if (includeSearchTrace) {
          failure.searchTrace = { forward: forwardTrace, backward: backwardTrace };
        }
        return failure;
      }
      // The graph search snaps identically; pinning the ends to the shared snaps also
      // covers a destination merged onto a colocated start snap.
      legs.push({
        geometry: {
          type: 'LineString',
          coordinates: [
            [snappedStart[0], snappedStart[1]],
            ...route.coordinates
              .slice(1, -1)
              .map((coordinate) => [coordinate[0], coordinate[1]]),
            [snappedDestination[0], snappedDestination[1]],
          ],
        },
        networkDistanceMeters: route.networkDistanceMeters,
        snappedStart,
        snappedDestination,
      });
    }
    if (retryWithExpandedArea) continue;
    await yieldForCancellation(signal);

    const result: TrailRouteSuccessBuilder = {
      status: 'ready',
      legs,
      loadedTileCount: areaResult.area.tiles.length,
      graphNodeCount: graph.nodes.size,
      graphEdgeCount: graph.edges.size,
      expandedAreaRetryUsed: attempt === 1,
    };
    if (includeSearchTrace) {
      result.searchTrace = { forward: forwardTrace, backward: backwardTrace };
    }
    return result;
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
