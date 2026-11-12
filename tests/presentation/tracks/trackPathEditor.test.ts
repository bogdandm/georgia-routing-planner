import { describe, expect, it } from 'vitest';

import type { TrailRouteLeg, TrailRouteSuccess } from '@/application/ports/TrailRouter';
import { storedTrackElevationProfile } from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate, TrackPoint } from '@/domain/tracks/gpx';
import { calculateTrackMetrics } from '@/domain/tracks/trackCalculations';
import {
  applyTrackPathDrag,
  beginTrackPathSave,
  canSaveTrackPath,
  completeTrackPathRequest,
  deleteTrackPathAnchors,
  endTrackPathInsertion,
  nearestTrackPathAnchor,
  nearestTrackPathDragTarget,
  previewTrackPathDrag,
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

function screenProjection(coordinate: TrackCoordinate) {
  const project = ([longitude, latitude]: TrackCoordinate) => ({
    x: longitude * 10_000,
    y: latitude * 1_000,
  });
  return { pointer: project(coordinate), project };
}

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

  it('fills DEM elevation in covered segments when another segment has none', () => {
    const uncovered: TrackPoint[] = [{ coordinate: E }, { coordinate: A }];
    const covered: TrackPoint[] = [
      { coordinate: B, elevationMeters: 1_050 },
      { coordinate: P },
      { coordinate: C, elevationMeters: 1_200 },
    ];
    const dem: TrackPoint[] = covered.map((point, index) => ({
      coordinate: point.coordinate,
      elevationMeters: 1_040 + index * 80,
    }));
    const demProfile = storedTrackElevationProfile([dem], undefined);
    if (demProfile === null) throw new Error('Expected a DEM profile.');

    // The DEM projection omits the uncovered first segment.
    const elevation = trackPathElevationFromPrepared('track', {
      sourceSegments: [{ points: uncovered }, { points: covered }],
      sourceProfile: storedTrackElevationProfile([uncovered, covered], undefined),
      sourceMetrics: calculateTrackMetrics([
        { points: uncovered },
        { points: covered },
      ]),
      calculatedSegments: [{ points: dem }],
      calculatedProfile: demProfile,
      calculatedMetrics: calculateTrackMetrics([{ points: dem }], 'dem-assisted'),
    });

    expect(elevation?.trackPoints[0]).toEqual(uncovered);
    expect(elevation?.trackPoints[1]?.map((point) => point.elevationMeters)).toEqual([
      1_050, 1_120, 1_200,
    ]);
  });

  it('previews an anchor move without history and commits metadata changes once', () => {
    const base = startTrackPathInsertion(recordedTrack(), 0);
    const target = { kind: 'anchor', anchorId: 1 } as const;
    const preview = previewTrackPathDrag(base.path, target, P);
    expect(preview.anchors[1]?.point).toEqual({
      coordinate: P,
      recordedAt: '2025-06-01T08:10:00Z',
    });
    expect(preview.legs.slice(0, 2)).toEqual([
      {
        kind: 'leg',
        mode: 'line',
        sections: [{ kind: 'direct', coordinates: [A, P] }],
      },
      {
        kind: 'leg',
        mode: 'line',
        sections: [{ kind: 'direct', coordinates: [P, C] }],
      },
    ]);
    expect(base.history).toHaveLength(0);
    expect(base.path.anchors[1]?.point.elevationMeters).toBe(1_100);
    const moved = applyTrackPathDrag(startTrackPathMove(base, 1), target, P);
    expect(moved.path.anchors[1]?.point).toEqual(preview.anchors[1]?.point);
    expect(moved.path.anchors[0]).toBe(base.path.anchors[0]);
    expect(moved.path.legs[2]).toBe(base.path.legs[2]);
    expect(moved.insertion).toBe(base.insertion);
    expect(moved.movingAnchorId).toBeNull();
    expect(moved.history).toHaveLength(1);
    expect(moved.requestGeneration).toBe(base.requestGeneration + 1);
    expect(moved.elevation).toBeNull();
    const undone = undoTrackPathEdit(moved);
    expect(undone.path).toBe(base.path);
    expect(undone.insertion).toBe(base.insertion);
  });

  it('uses direct previews for routed neighbours and requests routing only on drop', () => {
    const base = routeAll(setTrackPathLegMode(recordedTrack(), 0, 'routes'));
    const target = { kind: 'anchor', anchorId: 0 } as const;
    const preview = previewTrackPathDrag(base.path, target, P);
    expect(preview.legs[0]).toMatchObject({
      mode: 'line',
      sections: [{ kind: 'direct', coordinates: [P, B] }],
    });
    const moved = applyTrackPathDrag(base, target, P);
    expect(moved.path.legs[0]).toEqual({ kind: 'leg', mode: 'routes', sections: null });
    expect(moved.pendingRequest?.waypoints).toEqual([P, B]);
    expect(moved.history).toHaveLength(base.history.length + 1);
  });

  it('bends a straight edge with two direct legs and preserves the insertion cursor', () => {
    const base = setTrackPathInsertionMode(
      startTrackPathInsertion(recordedTrack(), 3),
      'routes',
    );
    const target = { kind: 'leg', afterAnchorId: 0 } as const;
    const preview = previewTrackPathDrag(base.path, target, P);
    expect(new Set(preview.anchors.map((anchor) => anchor.id)).size).toBe(6);
    expect(base.nextAnchorId).toBe(5);
    const bent = applyTrackPathDrag(base, target, P);
    expect(bent.path.anchors[1]).toEqual({ id: 5, point: { coordinate: P } });
    expect(bent.nextAnchorId).toBe(6);
    expect(bent.path.legs.slice(0, 2)).toEqual([
      {
        kind: 'leg',
        mode: 'line',
        sections: [{ kind: 'direct', coordinates: [A, P] }],
      },
      {
        kind: 'leg',
        mode: 'line',
        sections: [{ kind: 'direct', coordinates: [P, B] }],
      },
    ]);
    expect(bent.pendingRequest).toBeNull();
    expect(bent.insertion).toBe(base.insertion);
    expect(bent.history).toHaveLength(1);
    const undone = undoTrackPathEdit(bent);
    expect(undone.path).toBe(base.path);
    expect(undone.insertion).toBe(base.insertion);
  });

  it('prioritizes anchors and excludes routed, gap and degenerate edges', () => {
    const path = recordedTrack().path;
    expect(nearestTrackPathDragTarget(path, screenProjection(A))).toEqual({
      kind: 'anchor',
      anchorId: 0,
    });
    const middle = screenProjection([44.645, 42.665]);
    expect(nearestTrackPathDragTarget(path, middle)).toEqual({
      kind: 'leg',
      afterAnchorId: 0,
    });
    expect(nearestTrackPathDragTarget(path, middle, 100)).toMatchObject({
      kind: 'anchor',
    });
    expect(
      nearestTrackPathDragTarget(path, screenProjection([44.665, 42.685])),
    ).toBeNull();
    const routed = setTrackPathLegMode(recordedTrack(), 0, 'routes');
    expect(nearestTrackPathDragTarget(routed.path, middle)).toBeNull();
    const degenerate = trackPathFromSegments([[{ coordinate: A }, { coordinate: A }]], {
      stripElevation: false,
    });
    expect(nearestTrackPathDragTarget(degenerate, middle)).toBeNull();
    expect(previewTrackPathDrag(degenerate, { kind: 'leg', afterAnchorId: 0 }, P)).toBe(
      degenerate,
    );
  });

  it('uses the camera pixel radius under an anisotropic projection', () => {
    const path = trackPathFromSegments(
      [[{ coordinate: [0, 0] }, { coordinate: [1, 0] }]],
      { stripElevation: false },
    );
    const project = ([longitude, latitude]: TrackCoordinate) => ({
      x: longitude * 100,
      y: latitude * 2,
    });
    expect(
      nearestTrackPathDragTarget(path, {
        pointer: { x: 50, y: 11 },
        project,
      }),
    ).toEqual({ kind: 'leg', afterAnchorId: 0 });
    expect(
      nearestTrackPathDragTarget(path, {
        pointer: { x: 50, y: 13 },
        project,
      }),
    ).toBeNull();
    expect(
      nearestTrackPathDragTarget(path, {
        pointer: { x: 0, y: 11 },
        project,
      }),
    ).toEqual({ kind: 'anchor', anchorId: 0 });
    // Beyond an endpoint, proximity to the infinite supporting line is not a hit.
    expect(
      nearestTrackPathDragTarget(path, {
        pointer: { x: 113, y: 0 },
        project,
      }),
    ).toBeNull();
  });

  it('rejects saving and stale targets and does not record an unchanged anchor', () => {
    const base = recordedTrack();
    const missing = { kind: 'anchor', anchorId: 999 } as const;
    expect(applyTrackPathDrag(base, missing, P)).toBe(base);
    expect(previewTrackPathDrag(base.path, missing, P)).toBe(base.path);
    for (const afterAnchorId of [2, 4, 999]) {
      const target = { kind: 'leg', afterAnchorId } as const;
      expect(applyTrackPathDrag(base, target, P)).toBe(base);
      expect(previewTrackPathDrag(base.path, target, P)).toBe(base.path);
    }
    const saving = beginTrackPathSave(base);
    expect(applyTrackPathDrag(saving, { kind: 'anchor', anchorId: 0 }, P)).toBe(saving);
    const unchanged = applyTrackPathDrag(
      startTrackPathMove(base, 0),
      { kind: 'anchor', anchorId: 0 },
      A,
    );
    expect(unchanged.path).toBe(base.path);
    expect(unchanged.history).toBe(base.history);
    expect(unchanged.movingAnchorId).toBeNull();
  });
});
