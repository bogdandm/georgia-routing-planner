import { describe, expect, it, vi } from 'vitest';

import { MapViewportSnapshotStore } from '@/presentation/map/MapViewportSnapshotStore';

const viewport = {
  bounds: { west: 44, south: 42, east: 45, north: 43 },
  center: { longitude: 44.5, latitude: 42.5 },
} as const;

describe('MapViewportSnapshotStore movement state', () => {
  it('keeps stable phase snapshots and increments every settled revision', () => {
    const store = new MapViewportSnapshotStore();
    const listener = vi.fn();
    store.subscribeMovement(listener);
    const unavailable = store.getMovementSnapshot();

    expect(store.getMovementSnapshot()).toBe(unavailable);
    store.markMoving();
    const moving = store.getMovementSnapshot();
    store.markMoving();
    expect(store.getMovementSnapshot()).toBe(moving);

    store.settle(viewport);
    const firstSettled = store.getMovementSnapshot();
    store.settle(viewport);

    expect(moving).toEqual({ phase: 'moving' });
    expect(firstSettled).toEqual({ phase: 'settled', viewport, revision: 1 });
    expect(store.getMovementSnapshot()).toEqual({
      phase: 'settled',
      viewport,
      revision: 2,
    });
    expect(listener).toHaveBeenCalledTimes(3);

    store.clearMovement();
    expect(store.getMovementSnapshot()).toBe(unavailable);
  });
});
