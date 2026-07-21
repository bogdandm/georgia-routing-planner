import { describe, expect, it, vi } from 'vitest';

import { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';
import { FakeMapFacade } from '@test/helpers/FakeMapFacade';

describe('MapDiagnosticsSnapshotStore', () => {
  it('publishes the facade-owned readonly snapshot without cloning it', () => {
    const store = new MapDiagnosticsSnapshotStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const snapshot = new FakeMapFacade().snapshot;

    store.update(snapshot);
    const firstRead = store.getSnapshot();
    expect(firstRead).toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    store.update({ ...snapshot, lifecycle: 'ready' });
    expect(listener).toHaveBeenCalledOnce();
  });
});
