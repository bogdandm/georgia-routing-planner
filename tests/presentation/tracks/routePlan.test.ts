import { describe, expect, it } from 'vitest';

import type { TrailRouteSuccess } from '@/application/ports/TrailRouter';
import {
  beginRoutePlanElevation,
  canSaveRoutePlan,
  clearRoutePlan,
  completeRoutePlanPoint,
  enqueueRoutePlanPoint,
  finishRoutePlanElevation,
  flattenRoutePlanCoordinates,
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
  it('claims routed queue heads one at a time and preserves FIFO input', () => {
    let draft = enqueueRoutePlanPoint(startRoutePlan('route-plan:queue'), A);
    draft = enqueueRoutePlanPoint(draft, B);
    const firstRequest = draft.pendingRequest;
    if (firstRequest === null) throw new Error('Expected A to B request.');
    draft = enqueueRoutePlanPoint(draft, C);
    draft = enqueueRoutePlanPoint(draft, D);

    expect(draft.waypoints).toEqual([A]);
    expect(draft.queuedWaypoints).toEqual([B, C, D]);
    expect(firstRequest).toEqual({ generation: 2, start: A, destination: B });
    expect(draft.pendingRequest).toBe(firstRequest);
    expect(canSaveRoutePlan(draft)).toBe(false);

    draft = completeRoutePlanPoint(draft, firstRequest, routedSuccess());
    expect(draft.waypoints).toEqual([A, B]);
    expect(draft.queuedWaypoints).toEqual([C, D]);
    expect(draft.pendingRequest).toEqual({ generation: 3, start: B, destination: C });

    const secondRequest = draft.pendingRequest;
    if (secondRequest === null) throw new Error('Expected B to C request.');
    draft = completeRoutePlanPoint(draft, secondRequest, routedSuccess());
    const thirdRequest = draft.pendingRequest;
    if (thirdRequest === null) throw new Error('Expected C to D request.');
    draft = completeRoutePlanPoint(draft, thirdRequest, routedSuccess());

    expect(draft.waypoints).toEqual([A, B, C, D]);
    expect(draft.queuedWaypoints).toEqual([]);
    expect(draft.pendingRequest).toBeNull();
  });

  it('commits Line points synchronously and increments every geometry revision', () => {
    let draft = enqueueRoutePlanPoint(startRoutePlan('route-plan:line'), A);
    expect(draft.requestGeneration).toBe(1);
    draft = setNextSegmentMode(draft, 'line');
    draft = enqueueRoutePlanPoint(draft, B);
    draft = enqueueRoutePlanPoint(draft, C);

    expect(draft.requestGeneration).toBe(3);
    expect(draft.legs.map((leg) => leg.coordinates)).toEqual([
      [A, B],
      [B, C],
    ]);
    expect(flattenRoutePlanCoordinates(draft.legs)).toEqual([A, B, C]);
    expect(canSaveRoutePlan(draft)).toBe(true);
  });

  it('keeps the selected segment mode while input is buffered', () => {
    let draft = enqueueRoutePlanPoint(startRoutePlan('route-plan:mode'), A);
    draft = enqueueRoutePlanPoint(draft, B);
    expect(setNextSegmentMode(draft, 'line')).toBe(draft);
  });

  it('clears dependent queued points after a routing failure without losing committed geometry', () => {
    let draft = enqueueRoutePlanPoint(startRoutePlan('route-plan:failure'), A);
    draft = enqueueRoutePlanPoint(draft, B);
    const request = draft.pendingRequest;
    if (request === null) throw new Error('Expected request.');
    draft = enqueueRoutePlanPoint(draft, C);
    const failed = completeRoutePlanPoint(draft, request, {
      status: 'failed',
      reason: 'no-route',
    });

    expect(failed.waypoints).toEqual([A]);
    expect(failed.queuedWaypoints).toEqual([]);
    expect(failed.pendingRequest).toBeNull();
    expect(failed.status).toBe('failed');
    expect(
      updateRoutePlanProgress(failed, request.generation, {
        phase: 'building-graph',
        attempt: 1,
        loadedTileCount: 1,
        totalTileCount: 1,
        graphProgress: 0.6,
      }),
    ).toBe(failed);
  });

  it('invalidates pending work on undo and clear', () => {
    let draft = enqueueRoutePlanPoint(startRoutePlan('route-plan:undo'), A);
    draft = enqueueRoutePlanPoint(draft, B);
    const request = draft.pendingRequest;
    if (request === null) throw new Error('Expected request.');
    const undone = undoLastRoutePlanPoint(draft);
    expect(undone).toMatchObject({
      queuedWaypoints: [],
      pendingRequest: null,
      waypoints: [A],
    });
    expect(completeRoutePlanPoint(undone, request, routedSuccess())).toBe(undone);

    const cleared = clearRoutePlan(draft);
    expect(cleared).toMatchObject({
      queuedWaypoints: [],
      pendingRequest: null,
      waypoints: [],
    });
    expect(completeRoutePlanPoint(cleared, request, routedSuccess())).toBe(cleared);
  });

  it('keeps committed geometry saveable during elevation work and locks saving edits', () => {
    let draft = enqueueRoutePlanPoint(startRoutePlan('route-plan:elevation'), A);
    draft = setNextSegmentMode(draft, 'line');
    draft = enqueueRoutePlanPoint(draft, B);
    const enriching = beginRoutePlanElevation(draft);
    expect(canSaveRoutePlan(enriching)).toBe(true);
    const failed = finishRoutePlanElevation(enriching, null, null);
    expect(canSaveRoutePlan(failed)).toBe(true);

    const saving = { ...draft, status: 'saving' as const };
    expect(enqueueRoutePlanPoint(saving, C)).toBe(saving);
    expect(setNextSegmentMode(saving, 'routes')).toBe(saving);
    expect(setRoutePlanName(saving, 'Changed')).toBe(saving);
    expect(canSaveRoutePlan(saving)).toBe(false);
  });
});
