import type { LineString } from 'geojson';

import type { TrackCoordinate } from '@/domain/tracks/gpx';

export interface TrailRouteRequest {
  readonly start: TrackCoordinate;
  readonly destination: TrackCoordinate;
}

export type TrailRouteProgressPhase =
  'loading-tiles' | 'building-graph' | 'searching-route';

export interface TrailRouteProgress {
  readonly phase: TrailRouteProgressPhase;
  readonly attempt: 1 | 2;
  readonly loadedTileCount: number;
  readonly totalTileCount: number;
  readonly graphProgress: number;
}

export type TrailRouteProgressListener = (progress: TrailRouteProgress) => void;

export interface TrailRouteSuccess {
  readonly status: 'ready';
  readonly geometry: LineString;
  readonly networkDistanceMeters: number;
  readonly snappedStart: TrackCoordinate;
  readonly snappedDestination: TrackCoordinate;
  readonly loadedTileCount: number;
  readonly graphNodeCount: number;
  readonly graphEdgeCount: number;
  readonly expandedAreaRetryUsed: boolean;
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
  readonly endpoint?: 'start' | 'destination' | 'both';
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
