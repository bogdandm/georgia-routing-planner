import type { LineString } from 'geojson';

import type { TrackCoordinate } from '@/domain/tracks/gpx';

/** Upper bound on the points one route request visits. */
export const MAXIMUM_TRAIL_ROUTE_WAYPOINTS = 16;

export interface TrailRouteRequest {
  /** Ordered points to visit, 2..MAXIMUM_TRAIL_ROUTE_WAYPOINTS. */
  readonly waypoints: readonly TrackCoordinate[];
  /** Developer visualization: return the arcs the search explored. */
  readonly includeSearchTrace: boolean;
}

/** One explored arc as `[from, to]`, drawn as a straight segment. */
export type TrailRouteSearchArc = readonly [from: TrackCoordinate, to: TrackCoordinate];

/** Arcs relaxed by each direction of the bidirectional search, in expansion order. */
export interface TrailRouteSearchTrace {
  readonly forward: readonly TrailRouteSearchArc[];
  readonly backward: readonly TrailRouteSearchArc[];
}

export type TrailRouteProgressPhase =
  'loading-tiles' | 'building-graph' | 'loading-terrain' | 'searching-route';

export interface TrailRouteProgress {
  readonly phase: TrailRouteProgressPhase;
  readonly attempt: 1 | 2;
  readonly loadedTileCount: number;
  readonly totalTileCount: number;
  readonly graphProgress: number;
}

export type TrailRouteProgressListener = (progress: TrailRouteProgress) => void;

/** The routed connection between two consecutive waypoints. */
export interface TrailRouteLeg {
  /** Begins at `snappedStart` and ends at `snappedDestination`. */
  readonly geometry: LineString;
  readonly networkDistanceMeters: number;
  readonly snappedStart: TrackCoordinate;
  readonly snappedDestination: TrackCoordinate;
}

export interface TrailRouteSuccess {
  readonly status: 'ready';
  /**
   * One leg per consecutive waypoint pair; each leg's `snappedDestination` equals the
   * next leg's `snappedStart`.
   */
  readonly legs: readonly TrailRouteLeg[];
  readonly loadedTileCount: number;
  readonly graphNodeCount: number;
  readonly graphEdgeCount: number;
  readonly expandedAreaRetryUsed: boolean;
  /** Arcs explored by every leg's search, concatenated in leg order. */
  readonly searchTrace?: TrailRouteSearchTrace;
}

export type TrailRouteFailureReason =
  | 'no-nearby-trail'
  | 'no-route'
  | 'area-too-large'
  | 'routing-data-unavailable'
  | 'routing-data-invalid'
  | 'routing-timeout';

export interface TrailRouteFailure {
  readonly status: 'failed';
  readonly reason: TrailRouteFailureReason;
  /**
   * `no-nearby-trail` only: indexes into `request.waypoints` with no trail within the
   * snap distance, ascending and non-empty.
   */
  readonly waypointIndexes?: readonly number[];
  /** `no-route` only: index of the first leg without a connection. */
  readonly legIndex?: number;
  /** Present only for `no-route` when the request asked for a trace. */
  readonly searchTrace?: TrailRouteSearchTrace;
}

export type TrailRouteResult = TrailRouteSuccess | TrailRouteFailure;

export interface TrailRouter {
  route(
    request: TrailRouteRequest,
    signal: AbortSignal,
    onProgress?: TrailRouteProgressListener,
  ): Promise<TrailRouteResult>;
  dispose(): void;
}
