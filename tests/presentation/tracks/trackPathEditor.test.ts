import { describe, expect, it } from 'vitest';

import type { TrailRouteLeg, TrailRouteSuccess } from '@/application/ports/TrailRouter';
import { storedTrackElevationProfile } from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate, TrackPoint } from '@/domain/tracks/gpx';
import { calculateTrackMetrics } from '@/domain/tracks/trackCalculations';
import {
  canSaveTrackPath,
  completeTrackPathRequest,
  deleteTrackPathAnchors,
  endTrackPathInsertion,
  nearestTrackPathAnchor,
  placeTrackPathPoint,
  setTrackPathInsertionMode,
  setTrackPathLegMode,
  startRoutePlan,
  startTrackPathEdit,
  startTrackPathInsertion,
  startTrackPathMove,
  trackPathAnchorDistances,
  trackPathFromSegments,
  trackPathMapSections,
  trackPathSaveContent,
  trackPathElevationFromPrepared,
  trackPathSelectionGeometry,
  undoTrackPathEdit,
  type TrackPathDraft,
} from '@/presentation/tracks/trackPathEditor';

const A = [44.64, 42.66] as const;
const B = [44.65, 42.67] as const;
const C = [44.66, 42.68] as const;
const D = [44.67, 42.69] as const;
const E = [44.68, 42.7] as const;
const P = [44.655, 42.69] as const;

function leg(start: TrackCoordinate, end: TrackCoordinate): TrailRouteLeg {
  const middle: TrackCoordinate = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2 + 0.001,
  ];
  return {
    geometry: { type: 'LineString', coordinates: [[...start], [...middle], [...end]] },
    networkDistanceMeters: 1_000,
    snappedStart: start,
    snappedDestination: end,
  };
}

function success(waypoints: readonly TrackCoordinate[]): TrailRouteSuccess {
  return {
    status: 'ready',
    legs: waypoints.slice(1).map((end, index) => leg(waypoints[index] ?? end, end)),
    loadedTileCount: 4,
    graphNodeCount: 10,
    graphEdgeCount: 12,
    expandedAreaRetryUsed: false,
  };
}

function routeAll<D extends TrackPathDraft>(draft: D): D {
  let current = draft;
  for (let request = current.pendingRequest; request !== null;) {
    current = completeTrackPathRequest(current, request, success(request.waypoints));
    request = current.pendingRequest;
  }
  return current;
}

function recordedTrack(): TrackPathDraft {
  const points: TrackPoint[] = [
    { coordinate: A, elevationMeters: 1_000, recordedAt: '2025-06-01T08:00:00Z' },
    { coordinate: B, elevationMeters: 1_100, recordedAt: '2025-06-01T08:10:00Z' },
    { coordinate: C, elevationMeters: 1_200, recordedAt: '2025-06-01T08:20:00Z' },
  ];
  return startTrackPathEdit(
    trackPathFromSegments(
      [points, [{ coordinate: D, elevationMeters: 900 }, { coordinate: E }]],
      {
        stripElevation: false,
      },
    ),
    null,
  );
}

describe('track path editor', () => {
  it('routes appended plan points and saves the routed geometry', () => {
    let plan = placeTrackPathPoint(startRoutePlan('plan', 'New route'), A);
    expect(plan.status).toBe('selecting-destination');
    plan = placeTrackPathPoint(plan, B);
    plan = placeTrackPathPoint(plan, C);

    expect(plan.status).toBe('calculating');
    // The leg in flight keeps running; the later click waits for the next request.
    expect(plan.pendingRequest?.waypoints).toEqual([A, B]);
    expect(canSaveTrackPath(plan)).toBe(false);

    plan = routeAll(plan);
    expect(plan.status).toBe('elevation-enriching');
    expect(plan.path.anchors.map((anchor) => anchor.point.coordinate)).toEqual([
      A,
      B,
      C,
    ]);
    // Hidden router points join the anchors in the saved geometry.
    expect(trackPathSaveContent(plan)?.trackPoints[0]).toHaveLength(5);
    expect(canSaveTrackPath(plan)).toBe(true);
  });

  it('routes a point inserted between two anchors through both neighbours in one request', () => {
    let draft = startTrackPathInsertion(recordedTrack(), 0);
    draft = setTrackPathInsertionMode(draft, 'routes');
    draft = placeTrackPathPoint(draft, P);

    expect(draft.pendingRequest?.waypoints).toEqual([A, P, B]);
    draft = routeAll(draft);
    expect(draft.path.anchors.map((anchor) => anchor.point.coordinate)).toEqual([
      A,
      P,
      B,
      C,
      D,
      E,
    ]);
    // The cursor follows the new point, so the next click continues the run.
    draft = placeTrackPathPoint(draft, C);
    expect(draft.pendingRequest?.waypoints).toEqual([P, C, B]);
  });

  it('undoes the failed edit and names the unreachable point', () => {
    let plan = placeTrackPathPoint(startRoutePlan('plan', 'New route'), A);
    plan = routeAll(placeTrackPathPoint(plan, B));
    plan = placeTrackPathPoint(plan, C);
    const request = plan.pendingRequest;
    if (request === null) throw new Error('Expected a route request.');

    const failed = completeTrackPathRequest(plan, request, {
      status: 'failed',
      reason: 'no-nearby-trail',
      waypointIndexes: [1],
    });

    expect(failed.path.anchors.map((anchor) => anchor.point.coordinate)).toEqual([
      A,
      B,
    ]);
    expect(failed.failure?.pointNumbers).toEqual([3]);
    expect(failed.pendingRequest).toBeNull();
    expect(placeTrackPathPoint(failed, D).failure).toBeNull();
  });

  it('keeps a leg routed during a later queued edit when that edit fails or is undone', () => {
    let plan = placeTrackPathPoint(startRoutePlan('plan', 'New route'), A);
    plan = placeTrackPathPoint(plan, B);
    const first = plan.pendingRequest;
    if (first === null) throw new Error('Expected the A to B request.');
    plan = placeTrackPathPoint(plan, C);
    plan = completeTrackPathRequest(plan, first, success(first.waypoints));
    const second = plan.pendingRequest;
    if (second === null) throw new Error('Expected the B to C request.');

    const failed = completeTrackPathRequest(plan, second, {
      status: 'failed',
      reason: 'no-route',
      legIndex: 0,
    });
    expect(failed.path.anchors.map((anchor) => anchor.point.coordinate)).toEqual([
      A,
      B,
    ]);
    expect(failed.pendingRequest).toBeNull();

    const routed = completeTrackPathRequest(plan, second, success(second.waypoints));
    const undone = undoTrackPathEdit(routed);
    expect(undone.path.anchors).toHaveLength(2);
    expect(undone.pendingRequest).toBeNull();
    expect(canSaveTrackPath(undone)).toBe(true);
  });

  it('blocks saving while a lone point remains between segment gaps', () => {
    const lone = deleteTrackPathAnchors(recordedTrack(), 0, 1);
    expect(lone.path.anchors.map((anchor) => anchor.point.coordinate)).toEqual([
      C,
      D,
      E,
    ]);
    expect(lone.path.legs[0]).toEqual({ kind: 'gap' });
    expect(canSaveTrackPath(lone)).toBe(false);
  });
  it('ignores a route result for a request superseded by an undo', () => {
    let plan = placeTrackPathPoint(startRoutePlan('plan', 'New route'), A);
    plan = placeTrackPathPoint(plan, B);
    const request = plan.pendingRequest;
    if (request === null) throw new Error('Expected a route request.');
    const undone = undoTrackPathEdit(plan);

    expect(completeTrackPathRequest(undone, request, success(request.waypoints))).toBe(
      undone,
    );
    expect(undone.path.anchors).toHaveLength(1);
  });

  it('deletes a range and joins its neighbours, keeping segment gaps', () => {
    const track = recordedTrack();
    const joined = deleteTrackPathAnchors(track, 1, 1);
    expect(joined.path.anchors.map((anchor) => anchor.point.coordinate)).toEqual([
      A,
      C,
      D,
      E,
    ]);
    expect(joined.path.legs[0]).toEqual({
      kind: 'leg',
      mode: 'line',
      sections: [{ kind: 'direct', coordinates: [A, C] }],
    });
    expect(joined.path.legs[1]).toEqual({ kind: 'gap' });

    const acrossGap = deleteTrackPathAnchors(track, 1, 2);
    expect(acrossGap.path.legs[0]).toEqual({ kind: 'gap' });
    expect(trackPathSaveContent(acrossGap)).toBeNull();

    expect(deleteTrackPathAnchors(track, 0, 4).path.anchors).toEqual([]);
  });

  it('moves a point, drops its elevation but keeps its time, and redraws both legs', () => {
    const moved = placeTrackPathPoint(startTrackPathMove(recordedTrack(), 1), P);
    const anchor = moved.path.anchors[1];

    expect(anchor?.point).toEqual({
      coordinate: P,
      recordedAt: '2025-06-01T08:10:00Z',
    });
    expect(moved.movingAnchorId).toBeNull();
    expect(trackPathMapSections(moved.path)).toEqual([
      { kind: 'direct', coordinates: [A, P, C] },
      { kind: 'routed', coordinates: [D, E] },
    ]);
    expect(trackPathSaveContent(moved)?.trackPoints).toEqual([
      [
        { coordinate: A, elevationMeters: 1_000, recordedAt: '2025-06-01T08:00:00Z' },
        { coordinate: P, recordedAt: '2025-06-01T08:10:00Z' },
        { coordinate: C, elevationMeters: 1_200, recordedAt: '2025-06-01T08:20:00Z' },
      ],
      [{ coordinate: D, elevationMeters: 900 }, { coordinate: E }],
    ]);
  });

  it('reroutes a leg switched to routes and restores the line on undo', () => {
    const track = recordedTrack();
    const routed = routeAll(setTrackPathLegMode(track, 1, 'routes'));
    expect(routed.path.legs[1]).toMatchObject({ kind: 'leg', mode: 'routes' });
    expect(canSaveTrackPath(routed)).toBe(true);

    const undone = undoTrackPathEdit(routed);
    expect(undone.path).toBe(track.path);
    expect(canSaveTrackPath(undone)).toBe(false);
  });

  it('stops inserting on a saved track but returns a plan to appending', () => {
    const track = endTrackPathInsertion(startTrackPathInsertion(recordedTrack(), 0));
    expect(track.insertion).toBeNull();
    expect(placeTrackPathPoint(track, P)).toBe(track);

    let plan = placeTrackPathPoint(startRoutePlan('plan', 'New route'), A);
    plan = routeAll(placeTrackPathPoint(plan, B));
    plan = endTrackPathInsertion(startTrackPathInsertion(plan, -1));
    expect(plan.insertion?.afterAnchorId).toBe(plan.path.anchors.at(-1)?.id);
  });

  it('measures, selects and hit-tests anchors along the drawn path', () => {
    const path = recordedTrack().path;
    const distances = trackPathAnchorDistances(path);
    expect(distances[0]).toBe(0);
    // The gap before D adds no distance.
    expect(distances[3]).toBe(distances[2]);

    expect(trackPathSelectionGeometry(path, 1, 3)).toEqual({
      lines: [[B, C]],
      points: [B, C, D],
    });
    expect(nearestTrackPathAnchor(path, [C[0] + 0.0001, C[1]], 50)).toBe(2);
    expect(nearestTrackPathAnchor(path, P, 50)).toBeNull();
  });

  it('gives moved and added points DEM elevation so the profile spans the edit', () => {
    const source: TrackPoint[] = [
      { coordinate: A, elevationMeters: 1_000 },
      { coordinate: B, elevationMeters: 1_050 },
      { coordinate: P },
      { coordinate: C, elevationMeters: 1_200 },
      { coordinate: D, elevationMeters: 1_250 },
    ];
    const dem: TrackPoint[] = source.map((point, index) => ({
      coordinate: point.coordinate,
      elevationMeters: 990 + index * 60,
    }));
    const partialProfile = storedTrackElevationProfile([source], undefined);
    const demProfile = storedTrackElevationProfile([dem], undefined);
    if (demProfile === null) throw new Error('Expected a DEM profile.');

    const elevation = trackPathElevationFromPrepared('track', {
      sourceSegments: [{ points: source }],
      sourceProfile: partialProfile,
      sourceMetrics: calculateTrackMetrics([{ points: source }]),
      calculatedSegments: [{ points: dem }],
      calculatedProfile: demProfile,
      calculatedMetrics: calculateTrackMetrics([{ points: dem }], 'dem-assisted'),
    });

    expect(elevation?.trackPoints[0]?.map((point) => point.elevationMeters)).toEqual([
      1_000, 1_050, 1_110, 1_200, 1_250,
    ]);
    expect(elevation?.profile.points).toHaveLength(5);
    expect(elevation?.calculated?.trackPoints).toEqual([dem]);
  });
});
