import { describe, expect, it } from 'vitest';

import type { TrailRouteSuccess } from '@/application/ports/TrailRouter';
import {
  beginRoutePlanPoint,
  beginRoutePlanElevation,
  canSaveRoutePlan,
  clearRoutePlan,
  completeRoutePlanPoint,
  flattenRoutePlanCoordinates,
  finishRoutePlanElevation,
  setNextSegmentMode,
  setRoutePlanName,
  startRoutePlan,
  undoLastRoutePlanPoint,
  updateRoutePlanProgress,
} from '@/presentation/tracks/routePlan';

const A = [44.64, 42.66] as const;
const B = [44.65, 42.67] as const;
const C = [44.66, 42.68] as const;
const D = [44.67, 42.69] as const;
const snappedA = [44.6405, 42.6605] as const;
const routedMiddle = [44.645, 42.665] as const;
const snappedB = [44.6495, 42.6695] as const;

function routedSuccess(): TrailRouteSuccess {
  return {
    status: 'ready',
    geometry: {
      type: 'LineString',
      coordinates: [
        [snappedA[0], snappedA[1]],
        [routedMiddle[0], routedMiddle[1]],
        [snappedB[0], snappedB[1]],
      ],
    },
    networkDistanceMeters: 1_200,
    snappedStart: snappedA,
    snappedDestination: snappedB,
    loadedTileCount: 9,
    graphNodeCount: 100,
    graphEdgeCount: 120,
    expandedAreaRetryUsed: false,
  };
}

describe('route plan reducer', () => {
  it('assembles routed connectors, switches to persistent Line, and never routes Line legs', () => {
    let draft = startRoutePlan('route-plan:1');
    expect(draft).toMatchObject({
      name: 'New route',
      nextSegmentMode: 'routes',
      status: 'selecting-start',
    });

    const first = beginRoutePlanPoint(draft, A);
    expect(first.request).toBeNull();
    draft = first.draft;
    const second = beginRoutePlanPoint(draft, B);
    expect(second.request).toEqual({ generation: 2, start: A, destination: B });
    if (second.request === null) throw new Error('Expected routed request.');
    draft = completeRoutePlanPoint(second.draft, second.request, routedSuccess());

    expect(draft.legs[0]?.sections).toEqual([
      { kind: 'direct', coordinates: [A, snappedA] },
      { kind: 'routed', coordinates: [snappedA, routedMiddle, snappedB] },
      { kind: 'direct', coordinates: [snappedB, B] },
    ]);
    expect(draft.legs[0]?.coordinates).toEqual([
      A,
      snappedA,
      routedMiddle,
      snappedB,
      B,
    ]);
    expect(draft.segment?.points.map((point) => point.coordinate)).toEqual([
      A,
      snappedA,
      routedMiddle,
      snappedB,
      B,
    ]);
    expect(draft.metrics?.distanceMeters).toBeGreaterThan(1_200);

    draft = setNextSegmentMode(draft, 'line');
    const direct = beginRoutePlanPoint(draft, C);
    expect(direct.request).toBeNull();
    expect(direct.draft.legs[1]).toEqual({
      mode: 'line',
      rawStart: B,
      rawDestination: C,
      sections: [{ kind: 'direct', coordinates: [B, C] }],
      coordinates: [B, C],
    });
    expect(direct.draft.nextSegmentMode).toBe('line');

    const anotherDirect = beginRoutePlanPoint(direct.draft, D);
    expect(anotherDirect.request).toBeNull();
    expect(anotherDirect.draft.nextSegmentMode).toBe('line');
    expect(anotherDirect.draft.legs[2]?.coordinates).toEqual([C, D]);
  });

  it('keeps Routes selected across completed legs', () => {
    let draft = beginRoutePlanPoint(startRoutePlan('route-plan:2'), A).draft;
    const second = beginRoutePlanPoint(draft, B);
    if (second.request === null) throw new Error('Expected routed request.');
    draft = completeRoutePlanPoint(second.draft, second.request, routedSuccess());

    const third = beginRoutePlanPoint(draft, C);

    expect(draft.nextSegmentMode).toBe('routes');
    expect(third.request).toEqual({
      generation: 3,
      start: B,
      destination: C,
    });
    expect(third.draft.status).toBe('calculating');
  });

  it('undoes idle points, cancels an active calculation without removing prior points, and clears in place', () => {
    const withA = beginRoutePlanPoint(startRoutePlan('route-plan:3'), A).draft;
    const calculating = beginRoutePlanPoint(withA, B).draft;
    const canceled = undoLastRoutePlanPoint(calculating);
    expect(canceled.waypoints).toEqual([A]);
    expect(canceled.status).toBe('selecting-destination');
    expect(canceled.requestGeneration).toBe(3);
    const progressed = updateRoutePlanProgress(calculating, 2, {
      phase: 'loading-tiles',
      attempt: 1,
      loadedTileCount: 5,
      totalTileCount: 9,
    });
    expect(progressed.routeProgress).toEqual({
      phase: 'loading-tiles',
      attempt: 1,
      loadedTileCount: 5,
      totalTileCount: 9,
    });
    expect(
      updateRoutePlanProgress(progressed, 1, {
        phase: 'building-graph',
        attempt: 1,
        loadedTileCount: 9,
        totalTileCount: 9,
      }),
    ).toBe(progressed);
    expect(canceled.routeProgress).toBeNull();

    const retried = beginRoutePlanPoint(canceled, B);
    if (retried.request === null) throw new Error('Expected routed request.');
    const ready = completeRoutePlanPoint(
      retried.draft,
      retried.request,
      routedSuccess(),
    );
    const undone = undoLastRoutePlanPoint(ready);
    expect(undone.waypoints).toEqual([A]);
    expect(undone.legs).toEqual([]);
    expect(undone.metrics).toBeNull();

    const cleared = clearRoutePlan(beginRoutePlanPoint(undone, B).draft);
    expect(cleared).toMatchObject({
      waypoints: [],
      legs: [],
      status: 'selecting-start',
      nextSegmentMode: 'routes',
      metrics: null,
    });
  });

  it('preserves accepted legs after failure and ignores stale completions', () => {
    let draft = beginRoutePlanPoint(startRoutePlan('route-plan:4'), A).draft;
    const second = beginRoutePlanPoint(draft, B);
    if (second.request === null) throw new Error('Expected routed request.');
    draft = completeRoutePlanPoint(second.draft, second.request, routedSuccess());
    const acceptedLegs = draft.legs;
    const acceptedWaypoints = draft.waypoints;
    const third = beginRoutePlanPoint(draft, C);
    if (third.request === null) throw new Error('Expected routed request.');
    const failed = completeRoutePlanPoint(third.draft, third.request, {
      status: 'failed',
      reason: 'no-route',
    });
    expect(failed.legs).toBe(acceptedLegs);
    expect(failed.waypoints).toBe(acceptedWaypoints);
    expect(failed.status).toBe('failed');
    expect(canSaveRoutePlan(failed)).toBe(true);

    const cleared = clearRoutePlan(third.draft);
    expect(completeRoutePlanPoint(cleared, third.request, routedSuccess())).toBe(
      cleared,
    );
    expect(completeRoutePlanPoint(draft, third.request, routedSuccess())).toBe(draft);
  });

  it('keeps accepted geometry saveable during elevation work and on failure', () => {
    const withStart = beginRoutePlanPoint(
      startRoutePlan('route-plan:elevation'),
      A,
    ).draft;
    const direct = beginRoutePlanPoint(setNextSegmentMode(withStart, 'line'), B).draft;
    expect(canSaveRoutePlan(direct)).toBe(true);

    const enriching = beginRoutePlanElevation(direct);
    expect(enriching.status).toBe('elevation-enriching');
    expect(canSaveRoutePlan(enriching)).toBe(true);

    const failed = finishRoutePlanElevation(enriching, null, null);
    expect(failed.status).toBe('elevation-failed');
    expect(failed.segment).toBe(direct.segment);
    expect(failed.metrics).toBe(direct.metrics);
    expect(canSaveRoutePlan(failed)).toBe(true);
  });

  it('locks every geometry and metadata edit while saving', () => {
    const withStart = beginRoutePlanPoint(startRoutePlan('route-plan:saving'), A).draft;
    const ready = beginRoutePlanPoint(setNextSegmentMode(withStart, 'line'), B).draft;
    const saving = { ...ready, status: 'saving' as const };

    expect(beginRoutePlanPoint(saving, C)).toEqual({ draft: saving, request: null });
    expect(setNextSegmentMode(saving, 'routes')).toBe(saving);
    expect(setRoutePlanName(saving, 'Changed')).toBe(saving);
    expect(undoLastRoutePlanPoint(saving)).toBe(saving);
    expect(clearRoutePlan(saving)).toBe(saving);
    expect(canSaveRoutePlan(saving)).toBe(false);
  });

  it('flattens only shared adjacent joins', () => {
    const draft = setNextSegmentMode(
      beginRoutePlanPoint(startRoutePlan('route-plan:5'), A).draft,
      'line',
    );
    const withB = beginRoutePlanPoint(draft, B).draft;
    const withC = beginRoutePlanPoint(withB, C).draft;

    expect(flattenRoutePlanCoordinates(withC.legs)).toEqual([A, B, C]);
  });
});
