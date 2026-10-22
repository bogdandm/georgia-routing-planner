import {
  MAXIMUM_TRAIL_ROUTE_WAYPOINTS,
  type TrailRouteFailure,
  type TrailRouteLeg,
  type TrailRouteProgress,
  type TrailRouteResult,
} from '@/application/ports/TrailRouter';
import type { PreparedImportedTrack } from '@/application/tracks/prepareImportedTrack';
import {
  storedTrackElevationProfile,
  type ElevationProfile,
} from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate, TrackPoint, TrackSegment } from '@/domain/tracks/gpx';
import {
  calculateTrackMetrics,
  geodesicDistanceMeters,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';

/**
 * Point editor shared by route planning and saved-track editing. A path is an ordered
 * list of anchors (the points the user sees and edits) joined by legs. A leg is drawn as
 * a straight line or routed along trails between its two anchors; routed legs keep
 * their intermediate router points hidden. Saved tracks start with every stored point
 * as an anchor joined by its recorded geometry, and segment boundaries become gaps.
 */

export type PathLegMode = 'routes' | 'line';
/** `plan` always has an insertion point; `track` inserts only after an explicit Add. */
export type TrackPathVariant = 'plan' | 'track';

export type TrackPathStatus =
  | 'selecting-start'
  | 'selecting-destination'
  | 'calculating'
  | 'route-ready'
  | 'elevation-enriching'
  | 'elevation-ready'
  | 'elevation-failed'
  | 'saving';

export interface PathSection {
  /** `recorded`: stored track geometry; `routed`: trail router; `direct`: drawn line. */
  readonly kind: 'recorded' | 'routed' | 'direct';
  readonly coordinates: readonly TrackCoordinate[];
}

export interface PathAnchor {
  /** Stable within one draft; selection and React keys use it. */
  readonly id: number;
  /** Keeps the recorded elevation and time of an unmodified stored point. */
  readonly point: TrackPoint;
}

export type PathLeg =
  | { readonly kind: 'gap' }
  | {
      readonly kind: 'leg';
      readonly mode: PathLegMode;
      /** Geometry from the previous to the next anchor; null until the router answers. */
      readonly sections: readonly PathSection[] | null;
    };

export interface TrackPath {
  readonly anchors: readonly PathAnchor[];
  /** `legs[i]` joins `anchors[i]` and `anchors[i + 1]`. */
  readonly legs: readonly PathLeg[];
}

export interface PathInsertion {
  /** New points go after this anchor; null inserts before the first anchor. */
  readonly afterAnchorId: number | null;
  readonly mode: PathLegMode;
}

export interface TrackPathGeometry {
  /** The path this geometry was flattened from. */
  readonly path: TrackPath;
  /** Segments with at least two points: anchors plus hidden routed points. */
  readonly segments: readonly TrackSegment[];
  readonly metrics: TrackMetrics;
}

/** Points and metrics written by Save. */
export interface TrackPathStoredPoints {
  readonly trackPoints: readonly (readonly TrackPoint[])[];
  readonly metrics: TrackMetrics;
  /** DEM projection stored beside recorded elevation. */
  readonly calculated: {
    readonly trackPoints: readonly (readonly TrackPoint[])[];
    readonly metrics: TrackMetrics;
  } | null;
}

export interface TrackPathElevation extends TrackPathStoredPoints {
  readonly profile: ElevationProfile;
}

export interface PendingPathRequest {
  readonly generation: number;
  readonly anchorIds: readonly number[];
  readonly waypoints: readonly TrackCoordinate[];
}

export interface TrackPathFailure {
  readonly result: TrailRouteFailure;
  /** 1-based anchor numbers without a nearby trail, as numbered when routing started. */
  readonly pointNumbers: readonly number[];
}

interface TrackPathCheckpoint {
  readonly path: TrackPath;
  readonly insertion: PathInsertion | null;
  readonly geometry: TrackPathGeometry | null;
  readonly elevation: TrackPathElevation | null;
  readonly status: TrackPathStatus;
}

export interface TrackPathDraft {
  readonly variant: TrackPathVariant;
  readonly path: TrackPath;
  readonly nextAnchorId: number;
  readonly insertion: PathInsertion | null;
  readonly movingAnchorId: number | null;
  /** Undo stack; the newest checkpoint is last. */
  readonly history: readonly TrackPathCheckpoint[];
  /** Bumped by every path change; async work started for an older value is stale. */
  readonly requestGeneration: number;
  readonly pendingRequest: PendingPathRequest | null;
  readonly status: TrackPathStatus;
  /** The last routing failure; its edit was undone. Cleared by the next edit. */
  readonly failure: TrackPathFailure | null;
  readonly routeProgress: TrailRouteProgress | null;
  /** Kept from the last resolved path while a routed leg is calculating. */
  readonly geometry: TrackPathGeometry | null;
  readonly elevation: TrackPathElevation | null;
}

export interface RoutePlanDraft extends TrackPathDraft {
  readonly kind: 'route-plan';
  readonly id: string;
  readonly name: string;
}

const MAXIMUM_HISTORY_LENGTH = 50;
const emptyPath: TrackPath = { anchors: [], legs: [] };

function coordinatesEqual(left: TrackCoordinate, right: TrackCoordinate): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function connectingLeg(
  mode: PathLegMode,
  start: TrackCoordinate,
  end: TrackCoordinate,
): PathLeg {
  return mode === 'line'
    ? {
        kind: 'leg',
        mode: 'line',
        sections: [{ kind: 'direct', coordinates: [start, end] }],
      }
    : { kind: 'leg', mode: 'routes', sections: null };
}

function isUnresolved(leg: PathLeg): boolean {
  return leg.kind === 'leg' && leg.sections === null;
}

function anchorIndex(path: TrackPath, anchorId: number | null): number {
  if (anchorId === null) return -1;
  return path.anchors.findIndex((anchor) => anchor.id === anchorId);
}

function requiredAnchor(path: TrackPath, index: number): PathAnchor {
  const anchor = path.anchors[index];
  if (anchor === undefined) throw new Error('Path anchor index is out of range.');
  return anchor;
}

/** Stored segments become anchors joined by recorded legs, with gaps between segments. */
export function trackPathFromSegments(
  segments: readonly (readonly TrackPoint[])[],
  options: { readonly stripElevation: boolean },
): TrackPath {
  const anchors: PathAnchor[] = [];
  const legs: PathLeg[] = [];
  for (const points of segments) {
    for (const [pointIndex, point] of points.entries()) {
      if (anchors.length > 0) {
        const previous = requiredAnchor({ anchors, legs }, anchors.length - 1);
        legs.push(
          pointIndex === 0
            ? { kind: 'gap' }
            : {
                kind: 'leg',
                mode: 'line',
                sections: [
                  {
                    kind: 'recorded',
                    coordinates: [previous.point.coordinate, point.coordinate],
                  },
                ],
              },
        );
      }
      let anchorPoint: TrackPoint = point;
      if (options.stripElevation && point.elevationMeters !== undefined) {
        anchorPoint =
          point.recordedAt === undefined
            ? { coordinate: point.coordinate }
            : { coordinate: point.coordinate, recordedAt: point.recordedAt };
      }
      anchors.push({ id: anchors.length, point: anchorPoint });
    }
  }
  return { anchors, legs };
}

function sectionsCoordinates(
  sections: readonly PathSection[],
): readonly TrackCoordinate[] {
  const coordinates: TrackCoordinate[] = [];
  for (const section of sections) {
    for (const coordinate of section.coordinates) {
      const previous = coordinates.at(-1);
      if (previous === undefined || !coordinatesEqual(previous, coordinate)) {
        coordinates.push(coordinate);
      }
    }
  }
  return coordinates;
}

/**
 * Null until every leg is resolved and every segment has two points: a lone point
 * between gaps cannot be stored, so it blocks Save until it is joined or deleted.
 */
export function flattenTrackPath(path: TrackPath): TrackPathGeometry | null {
  const segments: TrackSegment[] = [];
  let points: TrackPoint[] = [];
  for (const [index, anchor] of path.anchors.entries()) {
    const leg = index === 0 ? undefined : path.legs[index - 1];
    if (leg?.kind === 'gap') {
      if (points.length < 2) return null;
      segments.push({ points });
      points = [];
    } else if (leg !== undefined) {
      if (leg.sections === null) return null;
      const coordinates = sectionsCoordinates(leg.sections);
      for (const coordinate of coordinates.slice(1, -1)) points.push({ coordinate });
    }
    points.push(anchor.point);
  }
  if (points.length < 2) return null;
  segments.push({ points });
  return { path, segments, metrics: calculateTrackMetrics(segments) };
}

/**
 * Cumulative distance of every anchor along the drawn path, matching the profile's
 * distance axis: gaps between segments do not count, pending legs count straight.
 */
export function trackPathAnchorDistances(path: TrackPath): readonly number[] {
  const distances: number[] = [];
  let distanceMeters = 0;
  for (const [index, anchor] of path.anchors.entries()) {
    const leg = index === 0 ? undefined : path.legs[index - 1];
    if (leg?.kind === 'leg') {
      const previous = requiredAnchor(path, index - 1).point.coordinate;
      const coordinates =
        leg.sections === null
          ? [previous, anchor.point.coordinate]
          : sectionsCoordinates(leg.sections);
      for (let pointIndex = 1; pointIndex < coordinates.length; pointIndex += 1) {
        const start = coordinates[pointIndex - 1];
        const end = coordinates[pointIndex];
        if (start !== undefined && end !== undefined) {
          distanceMeters += geodesicDistanceMeters(start, end);
        }
      }
    }
    distances.push(distanceMeters);
  }
  return distances;
}

function requestIsCurrent(path: TrackPath, request: PendingPathRequest): boolean {
  const first = anchorIndex(path, request.anchorIds[0] ?? null);
  if (first < 0) return false;
  return request.anchorIds.every((anchorId, offset) => {
    const anchor = path.anchors[first + offset];
    const waypoint = request.waypoints[offset];
    if (
      anchor?.id !== anchorId ||
      waypoint === undefined ||
      !coordinatesEqual(anchor.point.coordinate, waypoint)
    ) {
      return false;
    }
    if (offset === 0) return true;
    const leg = path.legs[first + offset - 1];
    return leg?.kind === 'leg' && isUnresolved(leg);
  });
}

function nextRequest(path: TrackPath, generation: number): PendingPathRequest | null {
  const first = path.legs.findIndex(isUnresolved);
  if (first < 0) return null;
  const anchors = [requiredAnchor(path, first)];
  for (
    let legIndex = first;
    legIndex < path.legs.length && anchors.length < MAXIMUM_TRAIL_ROUTE_WAYPOINTS;
    legIndex += 1
  ) {
    const leg = path.legs[legIndex];
    if (leg === undefined || !isUnresolved(leg)) break;
    anchors.push(requiredAnchor(path, legIndex + 1));
  }
  return {
    generation,
    anchorIds: anchors.map((anchor) => anchor.id),
    waypoints: anchors.map((anchor) => anchor.point.coordinate),
  };
}

function resolvedStatus(
  path: TrackPath,
  geometry: TrackPathGeometry | null,
): TrackPathStatus {
  if (path.anchors.length === 0) return 'selecting-start';
  if (path.anchors.length === 1) return 'selecting-destination';
  if (geometry === null || geometry.metrics.distanceMeters <= 0) return 'route-ready';
  return 'elevation-enriching';
}

/** Starts routing for the next unresolved run, or flattens a fully resolved path. */
function resolve<D extends TrackPathDraft>(draft: D): D {
  if (draft.path.legs.some(isUnresolved)) {
    const pendingRequest =
      draft.pendingRequest !== null &&
      requestIsCurrent(draft.path, draft.pendingRequest)
        ? draft.pendingRequest
        : nextRequest(draft.path, draft.requestGeneration);
    if (pendingRequest === draft.pendingRequest)
      return { ...draft, status: 'calculating' };
    return {
      ...draft,
      pendingRequest,
      status: 'calculating',
      routeProgress: {
        phase: 'loading-tiles',
        attempt: 1,
        loadedTileCount: 0,
        totalTileCount: 0,
        graphProgress: 0,
      },
    };
  }
  const geometry = flattenTrackPath(draft.path);
  return {
    ...draft,
    pendingRequest: null,
    routeProgress: null,
    geometry,
    elevation: null,
    status: resolvedStatus(draft.path, geometry),
  };
}

/** Records the current state for undo and applies an edited path. */
function commitEdit<D extends TrackPathDraft>(
  draft: D,
  path: TrackPath,
  changes: {
    readonly insertion?: PathInsertion | null;
    readonly nextAnchorId?: number;
  } = {},
): D {
  const checkpoint: TrackPathCheckpoint = {
    path: draft.path,
    insertion: draft.insertion,
    geometry: draft.geometry,
    elevation: draft.elevation,
    status: draft.status,
  };
  const history = [...draft.history, checkpoint].slice(-MAXIMUM_HISTORY_LENGTH);
  return resolve({
    ...draft,
    path,
    history,
    insertion: changes.insertion === undefined ? draft.insertion : changes.insertion,
    nextAnchorId: changes.nextAnchorId ?? draft.nextAnchorId,
    movingAnchorId: null,
    failure: null,
    requestGeneration: draft.requestGeneration + 1,
  });
}

function initialDraft(
  variant: TrackPathVariant,
  path: TrackPath,
  elevation: TrackPathElevation | null,
): TrackPathDraft {
  const geometry = flattenTrackPath(path);
  let status = resolvedStatus(path, geometry);
  if (status === 'elevation-enriching') {
    status = elevation === null ? 'elevation-failed' : 'elevation-ready';
  }
  return {
    variant,
    path,
    nextAnchorId: path.anchors.reduce(
      (next, anchor) => Math.max(next, anchor.id + 1),
      0,
    ),
    insertion: variant === 'plan' ? { afterAnchorId: null, mode: 'routes' } : null,
    movingAnchorId: null,
    history: [],
    requestGeneration: 0,
    pendingRequest: null,
    status,
    failure: null,
    routeProgress: null,
    geometry,
    elevation,
  };
}

/** `name` is the localized default shown in the Track name field until the user edits it. */
export function startRoutePlan(id: string, name: string): RoutePlanDraft {
  return { kind: 'route-plan', id, name, ...initialDraft('plan', emptyPath, null) };
}

/** Opens a saved track's points for editing; `elevation` describes the stored state. */
export function startTrackPathEdit(
  path: TrackPath,
  elevation: TrackPathElevation | null,
): TrackPathDraft {
  return initialDraft('track', path, elevation);
}

export function setRoutePlanName(draft: RoutePlanDraft, name: string): RoutePlanDraft {
  return draft.status === 'saving' ? draft : { ...draft, name };
}

function legModeAt(path: TrackPath, legIndex: number): PathLegMode | null {
  const leg = path.legs[legIndex];
  return leg?.kind === 'leg' ? leg.mode : null;
}

/** `afterIndex` -1 inserts before the first anchor; the last index appends. */
export function startTrackPathInsertion<D extends TrackPathDraft>(
  draft: D,
  afterIndex: number,
): D {
  if (draft.status === 'saving') return draft;
  const afterAnchor = afterIndex < 0 ? null : draft.path.anchors[afterIndex];
  if (afterAnchor === undefined) return draft;
  return {
    ...draft,
    movingAnchorId: null,
    insertion: {
      afterAnchorId: afterAnchor?.id ?? null,
      mode: draft.insertion?.mode ?? legModeAt(draft.path, afterIndex) ?? 'routes',
    },
  };
}

export function setTrackPathInsertionMode<D extends TrackPathDraft>(
  draft: D,
  mode: PathLegMode,
): D {
  if (draft.status === 'saving' || draft.insertion === null) return draft;
  return { ...draft, insertion: { ...draft.insertion, mode } };
}

/** Plans return to appending; saved tracks stop inserting. */
export function endTrackPathInsertion<D extends TrackPathDraft>(draft: D): D {
  if (draft.insertion === null) return draft;
  if (draft.variant === 'track') return { ...draft, insertion: null };
  return {
    ...draft,
    insertion: {
      afterAnchorId: draft.path.anchors.at(-1)?.id ?? null,
      mode: draft.insertion.mode,
    },
  };
}

export function startTrackPathMove<D extends TrackPathDraft>(
  draft: D,
  index: number,
): D {
  const anchor = draft.path.anchors[index];
  if (draft.status === 'saving' || anchor === undefined) return draft;
  return { ...draft, movingAnchorId: anchor.id };
}

export function cancelTrackPathMove<D extends TrackPathDraft>(draft: D): D {
  return draft.movingAnchorId === null ? draft : { ...draft, movingAnchorId: null };
}

function insertAnchor<D extends TrackPathDraft>(
  draft: D,
  insertion: PathInsertion,
  coordinate: TrackCoordinate,
): D {
  const { anchors, legs } = draft.path;
  const afterIndex = anchorIndex(draft.path, insertion.afterAnchorId);
  if (insertion.afterAnchorId !== null && afterIndex < 0) return draft;
  const anchor: PathAnchor = { id: draft.nextAnchorId, point: { coordinate } };
  const nextAnchors = [
    ...anchors.slice(0, afterIndex + 1),
    anchor,
    ...anchors.slice(afterIndex + 1),
  ];
  const previous = anchors[afterIndex];
  const following = anchors[afterIndex + 1];
  const insertedLegs: PathLeg[] = [];
  if (previous !== undefined) {
    insertedLegs.push(
      connectingLeg(insertion.mode, previous.point.coordinate, coordinate),
    );
  }
  if (following !== undefined) {
    const replaced = previous === undefined ? undefined : legs[afterIndex];
    insertedLegs.push(
      replaced?.kind === 'gap'
        ? replaced
        : connectingLeg(insertion.mode, coordinate, following.point.coordinate),
    );
  }
  const replacedLegCount = previous !== undefined && following !== undefined ? 1 : 0;
  const legStart = Math.max(0, afterIndex);
  const nextLegs = [
    ...legs.slice(0, legStart),
    ...insertedLegs,
    ...legs.slice(legStart + replacedLegCount),
  ];
  return commitEdit(
    draft,
    { anchors: nextAnchors, legs: nextLegs },
    {
      insertion: { afterAnchorId: anchor.id, mode: insertion.mode },
      nextAnchorId: draft.nextAnchorId + 1,
    },
  );
}

function moveAnchor<D extends TrackPathDraft>(
  draft: D,
  anchorId: number,
  coordinate: TrackCoordinate,
): D {
  const index = anchorIndex(draft.path, anchorId);
  const anchor = draft.path.anchors[index];
  if (anchor === undefined) return cancelTrackPathMove(draft);
  // The recorded time still dates the point; its elevation belonged to the old place.
  const point: TrackPoint =
    anchor.point.recordedAt === undefined
      ? { coordinate }
      : { coordinate, recordedAt: anchor.point.recordedAt };
  const anchors = draft.path.anchors.map((candidate, candidateIndex) =>
    candidateIndex === index ? { id: anchor.id, point } : candidate,
  );
  const legs = draft.path.legs.map((leg, legIndex) => {
    if (leg.kind === 'gap') return leg;
    if (legIndex === index - 1) {
      const start = requiredAnchor(draft.path, legIndex).point.coordinate;
      return connectingLeg(leg.mode, start, coordinate);
    }
    if (legIndex === index) {
      const end = requiredAnchor(draft.path, legIndex + 1).point.coordinate;
      return connectingLeg(leg.mode, coordinate, end);
    }
    return leg;
  });
  return commitEdit(draft, { anchors, legs });
}

/** Inserts at the insertion point, or moves the anchor waiting for a new place. */
export function placeTrackPathPoint<D extends TrackPathDraft>(
  draft: D,
  coordinate: TrackCoordinate,
): D {
  if (draft.status === 'saving') return draft;
  if (draft.movingAnchorId !== null) {
    return moveAnchor(draft, draft.movingAnchorId, coordinate);
  }
  if (draft.insertion === null) return draft;
  return insertAnchor(draft, draft.insertion, coordinate);
}

/** Removes `first..last` inclusive and joins the neighbours with one leg. */
export function deleteTrackPathAnchors<D extends TrackPathDraft>(
  draft: D,
  first: number,
  last: number,
): D {
  const { anchors, legs } = draft.path;
  const start = Math.max(0, Math.min(first, last));
  const end = Math.min(anchors.length - 1, Math.max(first, last));
  if (draft.status === 'saving' || start > end) return draft;
  const before = anchors[start - 1];
  const after = anchors[end + 1];
  const nextAnchors = [...anchors.slice(0, start), ...anchors.slice(end + 1)];
  let nextLegs: PathLeg[];
  if (before === undefined) {
    nextLegs = legs.slice(end + 1);
  } else if (after === undefined) {
    nextLegs = legs.slice(0, start - 1);
  } else {
    const removed = legs.slice(start - 1, end + 1);
    const incoming = removed[0];
    const outgoing = removed.at(-1);
    let joined: PathLeg;
    if (removed.some((leg) => leg.kind === 'gap')) {
      joined = { kind: 'gap' };
    } else {
      const mode =
        incoming?.kind === 'leg' &&
        incoming.mode === 'routes' &&
        outgoing?.kind === 'leg' &&
        outgoing.mode === 'routes'
          ? 'routes'
          : 'line';
      joined = connectingLeg(mode, before.point.coordinate, after.point.coordinate);
    }
    nextLegs = [...legs.slice(0, start - 1), joined, ...legs.slice(end + 1)];
  }
  const path: TrackPath = { anchors: nextAnchors, legs: nextLegs };
  let insertion = draft.insertion;
  if (insertion !== null && anchorIndex(path, insertion.afterAnchorId) < 0) {
    insertion = { afterAnchorId: before?.id ?? null, mode: insertion.mode };
  }
  return commitEdit(draft, path, { insertion });
}

export function setTrackPathLegMode<D extends TrackPathDraft>(
  draft: D,
  legIndex: number,
  mode: PathLegMode,
): D {
  const leg = draft.path.legs[legIndex];
  if (draft.status === 'saving' || leg?.kind !== 'leg' || leg.mode === mode)
    return draft;
  const legs = draft.path.legs.map((candidate, index) =>
    index === legIndex
      ? connectingLeg(
          mode,
          requiredAnchor(draft.path, legIndex).point.coordinate,
          requiredAnchor(draft.path, legIndex + 1).point.coordinate,
        )
      : candidate,
  );
  return commitEdit(draft, { anchors: draft.path.anchors, legs });
}

/** Plans only: removes every point; Undo restores them. */
export function clearTrackPath<D extends TrackPathDraft>(draft: D): D {
  if (draft.status === 'saving' || draft.path.anchors.length === 0) return draft;
  return commitEdit(draft, emptyPath, {
    insertion: { afterAnchorId: null, mode: draft.insertion?.mode ?? 'routes' },
  });
}

export function canUndoTrackPath(draft: TrackPathDraft): boolean {
  return draft.status !== 'saving' && draft.history.length > 0;
}

export function undoTrackPathEdit<D extends TrackPathDraft>(draft: D): D {
  const checkpoint = draft.history.at(-1);
  if (draft.status === 'saving' || checkpoint === undefined) return draft;
  const restored: D = {
    ...draft,
    ...checkpoint,
    history: draft.history.slice(0, -1),
    movingAnchorId: null,
    failure: null,
    pendingRequest: null,
    routeProgress: null,
    requestGeneration: draft.requestGeneration + 1,
  };
  return restored.path.legs.some(isUnresolved) ? resolve(restored) : restored;
}

export function updateTrackPathProgress<D extends TrackPathDraft>(
  draft: D,
  request: PendingPathRequest,
  progress: TrailRouteProgress,
): D {
  if (draft.status !== 'calculating' || draft.pendingRequest !== request) return draft;
  return { ...draft, routeProgress: progress };
}

function routedLegSections(
  start: TrackCoordinate,
  end: TrackCoordinate,
  leg: TrailRouteLeg,
): readonly PathSection[] {
  const routed = leg.geometry.coordinates.map((coordinate): TrackCoordinate => {
    const longitude = coordinate[0];
    const latitude = coordinate[1];
    if (longitude === undefined || latitude === undefined) {
      throw new Error('Trail route geometry contains an invalid coordinate.');
    }
    return [longitude, latitude];
  });
  const sections: PathSection[] = [];
  if (!coordinatesEqual(start, leg.snappedStart)) {
    sections.push({ kind: 'direct', coordinates: [start, leg.snappedStart] });
  }
  sections.push({ kind: 'routed', coordinates: routed });
  if (!coordinatesEqual(leg.snappedDestination, end)) {
    sections.push({ kind: 'direct', coordinates: [leg.snappedDestination, end] });
  }
  return sections;
}

/** Undoes edits back to the newest fully resolved state after a routing failure. */
function rejectRequest<D extends TrackPathDraft>(
  draft: D,
  request: PendingPathRequest,
  result: TrailRouteFailure,
): D {
  const pointNumbers = (result.waypointIndexes ?? []).flatMap((waypointIndex) => {
    const index = anchorIndex(draft.path, request.anchorIds[waypointIndex] ?? null);
    return index < 0 ? [] : [index + 1];
  });
  const failure: TrackPathFailure = { result, pointNumbers };
  const stableIndex = draft.history.findLastIndex(
    (checkpoint) => !checkpoint.path.legs.some(isUnresolved),
  );
  const checkpoint = draft.history[stableIndex];
  if (checkpoint === undefined) {
    const legs = draft.path.legs.map((leg, legIndex) =>
      isUnresolved(leg)
        ? connectingLeg(
            'line',
            requiredAnchor(draft.path, legIndex).point.coordinate,
            requiredAnchor(draft.path, legIndex + 1).point.coordinate,
          )
        : leg,
    );
    return {
      ...resolve({ ...draft, path: { anchors: draft.path.anchors, legs } }),
      failure,
    };
  }
  return {
    ...draft,
    ...checkpoint,
    history: draft.history.slice(0, stableIndex),
    movingAnchorId: null,
    pendingRequest: null,
    routeProgress: null,
    requestGeneration: draft.requestGeneration + 1,
    failure,
  };
}

export function completeTrackPathRequest<D extends TrackPathDraft>(
  draft: D,
  request: PendingPathRequest,
  result: TrailRouteResult,
): D {
  if (draft.pendingRequest !== request || draft.status === 'saving') return draft;
  if (!requestIsCurrent(draft.path, request)) {
    return resolve({ ...draft, pendingRequest: null });
  }
  if (result.status === 'failed') return rejectRequest(draft, request, result);
  if (result.legs.length !== request.waypoints.length - 1) {
    return rejectRequest(draft, request, {
      status: 'failed',
      reason: 'routing-data-invalid',
    });
  }
  // Checkpoints taken while this request ran get its legs too, so undoing a later
  // edit or failing a later request never drops a leg that was already routed.
  const withRoutedLegs = (path: TrackPath): TrackPath => {
    if (!requestIsCurrent(path, request)) return path;
    const first = anchorIndex(path, request.anchorIds[0] ?? null);
    const legs = path.legs.map((leg, legIndex) => {
      const routed = result.legs[legIndex - first];
      if (routed === undefined) return leg;
      return {
        kind: 'leg' as const,
        mode: 'routes' as const,
        sections: routedLegSections(
          requiredAnchor(path, legIndex).point.coordinate,
          requiredAnchor(path, legIndex + 1).point.coordinate,
          routed,
        ),
      };
    });
    return { anchors: path.anchors, legs };
  };
  const history = draft.history.map((checkpoint): TrackPathCheckpoint => {
    const path = withRoutedLegs(checkpoint.path);
    if (path === checkpoint.path) return checkpoint;
    if (path.legs.some(isUnresolved)) return { ...checkpoint, path };
    const geometry = flattenTrackPath(path);
    return {
      ...checkpoint,
      path,
      geometry,
      elevation: null,
      status: resolvedStatus(path, geometry),
    };
  });
  return resolve({
    ...draft,
    path: withRoutedLegs(draft.path),
    history,
    pendingRequest: null,
  });
}

export function beginTrackPathSave<D extends TrackPathDraft>(draft: D): D {
  return { ...draft, status: 'saving', pendingRequest: null, routeProgress: null };
}

/** Restores editing after a failed save; elevation work that was cut short reruns. */
export function cancelTrackPathSave<D extends TrackPathDraft>(draft: D): D {
  if (draft.status !== 'saving') return draft;
  let status: TrackPathStatus = resolvedStatus(draft.path, draft.geometry);
  if (status === 'elevation-enriching' && draft.elevation !== null)
    status = 'elevation-ready';
  return { ...draft, status, requestGeneration: draft.requestGeneration + 1 };
}

export function finishTrackPathElevation<D extends TrackPathDraft>(
  draft: D,
  generation: number,
  elevation: TrackPathElevation | null,
): D {
  if (
    draft.status !== 'elevation-enriching' ||
    draft.requestGeneration !== generation
  ) {
    return draft;
  }
  return {
    ...draft,
    status: elevation === null ? 'elevation-failed' : 'elevation-ready',
    elevation,
  };
}

/**
 * Plans keep the DEM elevation on their own points. Saved tracks keep recorded
 * elevation canonical when it forms a profile and store the DEM projection beside it;
 * otherwise the DEM projection becomes canonical, as on import. Moved and added points
 * have no recorded elevation, so they take the DEM value: the profile, gain, and climbs
 * then cover the edited stretch instead of breaking around it.
 */
export function trackPathElevationFromPrepared(
  variant: TrackPathVariant,
  prepared: PreparedImportedTrack,
): TrackPathElevation | null {
  if (variant === 'plan') {
    const segments = prepared.calculatedSegments ?? prepared.sourceSegments;
    const profile = prepared.calculatedProfile ?? prepared.sourceProfile;
    if (profile === null) return null;
    return {
      profile,
      trackPoints: segments.map((segment) => segment.points),
      metrics: calculateTrackMetrics(segments),
      calculated: null,
    };
  }
  if (
    prepared.sourceProfile === null &&
    prepared.calculatedSegments !== null &&
    prepared.calculatedProfile !== null &&
    prepared.calculatedMetrics !== null
  ) {
    return {
      profile: prepared.calculatedProfile,
      trackPoints: prepared.calculatedSegments.map((segment) => segment.points),
      metrics: prepared.calculatedMetrics,
      calculated: null,
    };
  }
  const calculated = prepared.calculatedSegments;
  // The DEM projection keeps the geometry point for point when every segment is routable.
  const aligned = calculated?.length === prepared.sourceSegments.length;
  const trackPoints = prepared.sourceSegments.map((segment, segmentIndex) => {
    const demPoints = aligned ? calculated[segmentIndex]?.points : undefined;
    if (demPoints?.length !== segment.points.length) return segment.points;
    return segment.points.map((point, pointIndex): TrackPoint => {
      const demElevation = demPoints[pointIndex]?.elevationMeters;
      return point.elevationMeters !== undefined || demElevation === undefined
        ? point
        : { ...point, elevationMeters: demElevation };
    });
  });
  const calculatedTrackPoints = calculated?.map((segment) => segment.points);
  const profile =
    storedTrackElevationProfile(trackPoints, calculatedTrackPoints) ??
    prepared.calculatedProfile;
  if (profile === null) return null;
  return {
    profile,
    trackPoints,
    metrics: calculateTrackMetrics(trackPoints.map((points) => ({ points }))),
    calculated:
      calculatedTrackPoints === undefined || prepared.calculatedMetrics === null
        ? null
        : { trackPoints: calculatedTrackPoints, metrics: prepared.calculatedMetrics },
  };
}

/** What Save stores: elevated points when available, otherwise the plain geometry. */
export function trackPathSaveContent(
  draft: TrackPathDraft,
): TrackPathStoredPoints | null {
  const geometry = draft.geometry;
  if (geometry?.path !== draft.path) return null;
  if (draft.elevation !== null) return draft.elevation;
  return {
    trackPoints: geometry.segments.map((segment) => segment.points),
    metrics: geometry.metrics,
    calculated: null,
  };
}

export function trackPathMetrics(draft: TrackPathDraft): TrackMetrics | null {
  return draft.elevation?.metrics ?? draft.geometry?.metrics ?? null;
}

export function canSaveTrackPath(draft: TrackPathDraft): boolean {
  const geometry = draft.geometry;
  return (
    draft.status !== 'calculating' &&
    draft.status !== 'saving' &&
    draft.pendingRequest === null &&
    (draft.variant === 'plan' || draft.history.length > 0) &&
    geometry !== null &&
    geometry.path === draft.path &&
    geometry.metrics.distanceMeters > 0
  );
}

export interface TrackPathMapSection {
  readonly kind: 'routed' | 'direct';
  readonly coordinates: readonly TrackCoordinate[];
}

/** Map lines with runs of one style merged; legs waiting for the router draw straight. */
export function trackPathMapSections(path: TrackPath): readonly TrackPathMapSection[] {
  const result: {
    kind: TrackPathMapSection['kind'];
    coordinates: TrackCoordinate[];
  }[] = [];
  let open = false;
  for (const [legIndex, leg] of path.legs.entries()) {
    if (leg.kind === 'gap') {
      open = false;
      continue;
    }
    const sections: readonly PathSection[] = leg.sections ?? [
      {
        kind: 'direct',
        coordinates: [
          requiredAnchor(path, legIndex).point.coordinate,
          requiredAnchor(path, legIndex + 1).point.coordinate,
        ],
      },
    ];
    for (const section of sections) {
      const kind = section.kind === 'direct' ? 'direct' : 'routed';
      const current = result.at(-1);
      const last = current?.coordinates.at(-1);
      const first = section.coordinates[0];
      if (
        open &&
        current?.kind === kind &&
        last !== undefined &&
        first !== undefined &&
        coordinatesEqual(last, first)
      ) {
        current.coordinates.push(...section.coordinates.slice(1));
      } else {
        result.push({ kind, coordinates: [...section.coordinates] });
      }
      open = true;
    }
  }
  return result;
}

export interface TrackPathSelectionGeometry {
  readonly lines: readonly (readonly TrackCoordinate[])[];
  readonly points: readonly TrackCoordinate[];
}

/** Selected anchors and the drawn path between the first and last of them. */
export function trackPathSelectionGeometry(
  path: TrackPath,
  first: number,
  last: number,
): TrackPathSelectionGeometry {
  const lines: TrackCoordinate[][] = [];
  let line: TrackCoordinate[] = [];
  for (let legIndex = first; legIndex < last; legIndex += 1) {
    const leg = path.legs[legIndex];
    if (leg === undefined) break;
    if (leg.kind === 'gap') {
      if (line.length >= 2) lines.push(line);
      line = [];
      continue;
    }
    const coordinates =
      leg.sections === null
        ? [
            requiredAnchor(path, legIndex).point.coordinate,
            requiredAnchor(path, legIndex + 1).point.coordinate,
          ]
        : sectionsCoordinates(leg.sections);
    line.push(...(line.length === 0 ? coordinates : coordinates.slice(1)));
  }
  if (line.length >= 2) lines.push(line);
  return {
    lines,
    points: path.anchors
      .slice(first, last + 1)
      .map((anchor) => anchor.point.coordinate),
  };
}

/** Index of the anchor nearest to `coordinate` within `toleranceMeters`, or null. */
export function nearestTrackPathAnchor(
  path: TrackPath,
  coordinate: TrackCoordinate,
  toleranceMeters: number,
): number | null {
  let nearest: number | null = null;
  let nearestDistance = toleranceMeters;
  for (const [index, anchor] of path.anchors.entries()) {
    const distance = geodesicDistanceMeters(anchor.point.coordinate, coordinate);
    if (distance <= nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}
