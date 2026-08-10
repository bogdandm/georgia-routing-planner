import type {
  TrailRouteFailure,
  TrailRouteProgress,
  TrailRouteResult,
} from '@/application/ports/TrailRouter';
import type { TrackCoordinate, TrackSegment } from '@/domain/tracks/gpx';
import {
  calculateTrackMetrics,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';
import type { ElevationProfile } from '@/domain/tracks/elevationProfile';

export type RoutePlanSegmentMode = 'routes' | 'line';
export type RoutePlanStatus =
  | 'selecting-start'
  | 'selecting-destination'
  | 'calculating'
  | 'route-ready'
  | 'elevation-enriching'
  | 'elevation-ready'
  | 'elevation-failed'
  | 'saving'
  | 'failed';

export interface RoutePlanSection {
  readonly kind: 'routed' | 'direct';
  readonly coordinates: readonly TrackCoordinate[];
}

export interface RoutePlanLeg {
  readonly mode: RoutePlanSegmentMode;
  readonly rawStart: TrackCoordinate;
  readonly rawDestination: TrackCoordinate;
  readonly sections: readonly RoutePlanSection[];
  readonly coordinates: readonly TrackCoordinate[];
}

export interface RoutePlanDraft {
  readonly kind: 'route-plan';
  readonly id: string;
  readonly name: string;
  readonly waypoints: readonly TrackCoordinate[];
  readonly queuedWaypoints: readonly TrackCoordinate[];
  readonly legs: readonly RoutePlanLeg[];
  readonly nextSegmentMode: RoutePlanSegmentMode;
  readonly requestGeneration: number;
  readonly pendingRequest: PendingRoutePlanRequest | null;
  readonly status: RoutePlanStatus;
  readonly failure: TrailRouteFailure | null;
  readonly routeProgress: TrailRouteProgress | null;
  readonly segment: TrackSegment | null;
  readonly metrics: TrackMetrics | null;
  readonly profile: ElevationProfile | null;
}

export interface PendingRoutePlanRequest {
  readonly generation: number;
  readonly start: TrackCoordinate;
  readonly destination: TrackCoordinate;
}

function coordinatesEqual(left: TrackCoordinate, right: TrackCoordinate): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function deduplicateAdjacentCoordinates(
  coordinates: readonly TrackCoordinate[],
): readonly TrackCoordinate[] {
  const deduplicated: TrackCoordinate[] = [];
  for (const coordinate of coordinates) {
    const previous = deduplicated.at(-1);
    if (previous === undefined || !coordinatesEqual(previous, coordinate)) {
      deduplicated.push(coordinate);
    }
  }
  return deduplicated;
}

function flattenSections(
  sections: readonly RoutePlanSection[],
): readonly TrackCoordinate[] {
  return deduplicateAdjacentCoordinates(
    sections.flatMap((section) => section.coordinates),
  );
}

export function flattenRoutePlanCoordinates(
  legs: readonly RoutePlanLeg[],
): readonly TrackCoordinate[] {
  return deduplicateAdjacentCoordinates(legs.flatMap((leg) => leg.coordinates));
}

function geometryState(legs: readonly RoutePlanLeg[]): {
  readonly segment: TrackSegment | null;
  readonly metrics: TrackMetrics | null;
  readonly profile: null;
} {
  const coordinates = flattenRoutePlanCoordinates(legs);
  if (coordinates.length < 2) return { segment: null, metrics: null, profile: null };
  const segment: TrackSegment = {
    points: coordinates.map((coordinate) => ({ coordinate })),
  };
  return {
    segment,
    metrics: calculateTrackMetrics([segment]),
    profile: null,
  };
}

function statusForWaypointCount(count: number): RoutePlanStatus {
  if (count === 0) return 'selecting-start';
  if (count === 1) return 'selecting-destination';
  return 'route-ready';
}

export function startRoutePlan(id: string): RoutePlanDraft {
  return {
    kind: 'route-plan',
    id,
    name: 'New route',
    waypoints: [],
    legs: [],
    queuedWaypoints: [],
    nextSegmentMode: 'routes',
    requestGeneration: 0,
    pendingRequest: null,
    status: 'selecting-start',
    failure: null,
    routeProgress: null,
    segment: null,
    metrics: null,
    profile: null,
  };
}

export function setRoutePlanName(draft: RoutePlanDraft, name: string): RoutePlanDraft {
  return draft.status === 'saving' ? draft : { ...draft, name };
}

export function setNextSegmentMode(
  draft: RoutePlanDraft,
  nextSegmentMode: RoutePlanSegmentMode,
): RoutePlanDraft {
  if (
    draft.status === 'saving' ||
    draft.pendingRequest !== null ||
    draft.queuedWaypoints.length > 0
  ) {
    return draft;
  }
  return { ...draft, nextSegmentMode };
}

function advanceRoutePlanQueue(draft: RoutePlanDraft): RoutePlanDraft {
  if (
    draft.pendingRequest !== null ||
    draft.status === 'saving' ||
    draft.queuedWaypoints.length === 0
  ) {
    return draft;
  }

  let next = draft;
  while (next.pendingRequest === null && next.queuedWaypoints.length > 0) {
    const destination = next.queuedWaypoints[0];
    if (destination === undefined) return next;
    const queuedWaypoints = next.queuedWaypoints.slice(1);
    const generation = next.requestGeneration + 1;
    const start = next.waypoints.at(-1);
    if (start === undefined) {
      next = {
        ...next,
        waypoints: [destination],
        queuedWaypoints,
        requestGeneration: generation,
        status: 'selecting-destination',
        failure: null,
        routeProgress: null,
      };
      continue;
    }
    if (next.nextSegmentMode === 'line') {
      const leg: RoutePlanLeg = {
        mode: 'line',
        rawStart: start,
        rawDestination: destination,
        sections: [{ kind: 'direct', coordinates: [start, destination] }],
        coordinates: [start, destination],
      };
      const legs = [...next.legs, leg];
      next = {
        ...next,
        waypoints: [...next.waypoints, destination],
        queuedWaypoints,
        legs,
        requestGeneration: generation,
        status: 'route-ready',
        failure: null,
        routeProgress: null,
        ...geometryState(legs),
      };
      continue;
    }
    const request: PendingRoutePlanRequest = { generation, start, destination };
    return {
      ...next,
      requestGeneration: generation,
      pendingRequest: request,
      status: 'calculating',
      failure: null,
      routeProgress: {
        phase: 'loading-tiles',
        attempt: 1,
        loadedTileCount: 0,
        totalTileCount: 0,
      },
    };
  }
  return next;
}

export function enqueueRoutePlanPoint(
  draft: RoutePlanDraft,
  coordinate: TrackCoordinate,
): RoutePlanDraft {
  if (draft.status === 'saving') return draft;
  return advanceRoutePlanQueue({
    ...draft,
    queuedWaypoints: [...draft.queuedWaypoints, coordinate],
  });
}

export function updateRoutePlanProgress(
  draft: RoutePlanDraft,
  generation: number,
  progress: TrailRouteProgress,
): RoutePlanDraft {
  if (
    draft.status !== 'calculating' ||
    draft.requestGeneration !== generation ||
    draft.pendingRequest?.generation !== generation
  ) {
    return draft;
  }
  return { ...draft, routeProgress: progress };
}

export function completeRoutePlanPoint(
  draft: RoutePlanDraft,
  request: PendingRoutePlanRequest,
  result: TrailRouteResult,
): RoutePlanDraft {
  const previousWaypoint = draft.waypoints.at(-1);
  if (
    draft.status !== 'calculating' ||
    draft.requestGeneration !== request.generation ||
    draft.pendingRequest !== request ||
    draft.queuedWaypoints[0] !== request.destination ||
    previousWaypoint === undefined ||
    !coordinatesEqual(previousWaypoint, request.start)
  ) {
    return draft;
  }
  if (result.status === 'failed') {
    return {
      ...draft,
      queuedWaypoints: [],
      pendingRequest: null,
      status: 'failed',
      failure: result,
      routeProgress: null,
    };
  }

  const routedCoordinates = result.geometry.coordinates.map(
    (coordinate): TrackCoordinate => {
      const longitude = coordinate[0];
      const latitude = coordinate[1];
      if (longitude === undefined || latitude === undefined) {
        throw new Error('Trail route geometry contains an invalid coordinate.');
      }
      return [longitude, latitude];
    },
  );
  const sections: RoutePlanSection[] = [];
  if (!coordinatesEqual(request.start, result.snappedStart)) {
    sections.push({
      kind: 'direct',
      coordinates: [request.start, result.snappedStart],
    });
  }
  sections.push({ kind: 'routed', coordinates: routedCoordinates });
  if (!coordinatesEqual(result.snappedDestination, request.destination)) {
    sections.push({
      kind: 'direct',
      coordinates: [result.snappedDestination, request.destination],
    });
  }
  const leg: RoutePlanLeg = {
    mode: 'routes',
    rawStart: request.start,
    rawDestination: request.destination,
    sections,
    coordinates: flattenSections(sections),
  };
  const legs = [...draft.legs, leg];
  return advanceRoutePlanQueue({
    ...draft,
    waypoints: [...draft.waypoints, request.destination],
    queuedWaypoints: draft.queuedWaypoints.slice(1),
    pendingRequest: null,
    legs,
    status: 'route-ready',
    failure: null,
    routeProgress: null,
    ...geometryState(legs),
  });
}

export function undoLastRoutePlanPoint(draft: RoutePlanDraft): RoutePlanDraft {
  if (draft.status === 'saving') return draft;
  const generation = draft.requestGeneration + 1;
  if (draft.status === 'calculating') {
    return {
      ...draft,
      queuedWaypoints: [],
      pendingRequest: null,
      requestGeneration: generation,
      status: statusForWaypointCount(draft.waypoints.length),
      failure: null,
      routeProgress: null,
    };
  }
  const waypoints = draft.waypoints.slice(0, -1);
  const legs = draft.legs.slice(0, Math.max(0, waypoints.length - 1));
  return {
    ...draft,
    waypoints,
    queuedWaypoints: [],
    pendingRequest: null,
    legs,
    requestGeneration: generation,
    status: statusForWaypointCount(waypoints.length),
    failure: null,
    routeProgress: null,
    ...geometryState(legs),
  };
}

export function clearRoutePlan(draft: RoutePlanDraft): RoutePlanDraft {
  if (draft.status === 'saving') return draft;
  return {
    ...draft,
    waypoints: [],
    queuedWaypoints: [],
    pendingRequest: null,
    legs: [],
    requestGeneration: draft.requestGeneration + 1,
    status: 'selecting-start',
    failure: null,
    routeProgress: null,
    segment: null,
    metrics: null,
    profile: null,
  };
}

export function beginRoutePlanElevation(draft: RoutePlanDraft): RoutePlanDraft {
  if (draft.status !== 'route-ready' || draft.segment === null) return draft;
  return { ...draft, status: 'elevation-enriching' };
}

export function finishRoutePlanElevation(
  draft: RoutePlanDraft,
  segment: TrackSegment | null,
  profile: ElevationProfile | null,
): RoutePlanDraft {
  if (draft.status !== 'elevation-enriching') return draft;
  if (segment === null || profile === null) {
    return { ...draft, status: 'elevation-failed', profile: null };
  }
  return {
    ...draft,
    status: 'elevation-ready',
    segment,
    metrics: calculateTrackMetrics([segment]),
    profile,
  };
}

export function canSaveRoutePlan(draft: RoutePlanDraft): boolean {
  return (
    draft.status !== 'selecting-start' &&
    draft.status !== 'calculating' &&
    draft.status !== 'saving' &&
    draft.pendingRequest === null &&
    draft.queuedWaypoints.length === 0 &&
    draft.segment !== null &&
    draft.segment.points.length >= 2 &&
    draft.metrics !== null &&
    draft.metrics.distanceMeters > 0
  );
}
