import { describe, expect, it, vi } from 'vitest';

import { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';
import { FakeMapFacade } from '../../../test/helpers/FakeMapFacade';

describe('MapDiagnosticsSnapshotStore', () => {
  it('retains a serializable defensive copy and publishes updates', () => {
    const store = new MapDiagnosticsSnapshotStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const snapshot = new FakeMapFacade().snapshot;

    store.update(snapshot);
    const firstRead = store.getSnapshot();
    expect(firstRead).toEqual(snapshot);
    expect(firstRead).not.toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    store.update({ ...snapshot, lifecycle: 'ready' });
    expect(listener).toHaveBeenCalledOnce();
  });
});
