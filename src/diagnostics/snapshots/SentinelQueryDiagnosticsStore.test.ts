import { describe, expect, it, vi } from 'vitest';

import type { Clock } from '@/application/ports/Clock';
import { sentinelQueryStepIds } from '@/application/ports/SentinelQueryDiagnostics';
import { SentinelQueryDiagnosticsStore } from '@/diagnostics/snapshots/SentinelQueryDiagnosticsStore';

class ControllableClock implements Clock {
  public monotonic = 0;

  public now(): Date {
    return new Date('2026-07-19T10:00:00.000Z');
  }

  public monotonicNow(): number {
    return this.monotonic;
  }
}

describe('SentinelQueryDiagnosticsStore', () => {
  it('starts with every contracted Sentinel step waiting', () => {
    const store = new SentinelQueryDiagnosticsStore(new ControllableClock());

    expect(store.getSnapshot().steps.map((step) => step.id)).toEqual(
      sentinelQueryStepIds,
    );
    expect(store.getSnapshot().steps.every((step) => step.status === 'waiting')).toBe(
      true,
    );
  });

  it('publishes live and completed duration for every instrumented step', () => {
    const clock = new ControllableClock();
    const store = new SentinelQueryDiagnosticsStore(clock);
    const listener = vi.fn();
    store.subscribe(listener);

    store.beginOperation('operation-1');
    store.beginStep('operation-1', 'capture-viewport');
    clock.monotonic = 125;
    store.refreshRunningDurations();

    expect(store.getSnapshot()).toMatchObject({
      operationId: 'operation-1',
      status: 'running',
      durationMs: 125,
    });
    expect(store.getSnapshot().steps[0]).toMatchObject({
      id: 'capture-viewport',
      status: 'running',
      durationMs: 125,
    });

    clock.monotonic = 180;
    store.completeStep('operation-1', 'capture-viewport');
    store.completeOperation('operation-1');

    expect(store.getSnapshot()).toMatchObject({
      status: 'success',
      durationMs: 180,
    });
    expect(store.getSnapshot().steps.slice(0, 2)).toMatchObject([
      {
        id: 'capture-viewport',
        status: 'success',
        durationMs: 180,
      },
      {
        id: 'build-search-criteria',
        status: 'skipped',
      },
    ]);
    expect(listener).toHaveBeenCalled();
  });

  it('records failure and cancellation without throwing on invalid transitions', () => {
    const clock = new ControllableClock();
    const store = new SentinelQueryDiagnosticsStore(clock);

    expect(() => {
      store.completeStep('missing-operation', 'query-stac-catalog');
    }).not.toThrow();
    store.beginOperation('failed-operation');
    store.beginStep('failed-operation', 'query-stac-catalog');
    store.beginStep('failed-operation', 'fetch-result-pages');
    store.completeOperation('failed-operation');
    expect(store.getSnapshot().status).toBe('running');
    expect(
      store.getSnapshot().steps.find((step) => step.id === 'fetch-result-pages')
        ?.status,
    ).toBe('waiting');
    clock.monotonic = 75;
    store.failStep('failed-operation', 'query-stac-catalog');

    expect(store.getSnapshot()).toMatchObject({
      status: 'error',
      durationMs: 75,
    });
    expect(
      store.getSnapshot().steps.find((step) => step.id === 'query-stac-catalog'),
    ).toMatchObject({ status: 'error', durationMs: 75 });

    clock.monotonic = 100;
    store.beginOperation('cancelled-operation');
    store.beginStep('cancelled-operation', 'fetch-result-pages');
    clock.monotonic = 140;
    store.cancelOperation('cancelled-operation');

    expect(store.getSnapshot()).toMatchObject({
      status: 'cancelled',
      durationMs: 40,
    });
    expect(
      store.getSnapshot().steps.find((step) => step.id === 'fetch-result-pages'),
    ).toMatchObject({ status: 'cancelled', durationMs: 40 });
  });

  it('ignores late transitions from an operation replaced by a newer request', () => {
    const store = new SentinelQueryDiagnosticsStore(new ControllableClock());

    store.beginOperation('older');
    store.beginStep('older', 'query-stac-catalog');
    store.beginOperation('newer');
    store.beginStep('newer', 'capture-viewport');
    store.failOperation('older');
    store.completeStep('older', 'query-stac-catalog');

    expect(store.getSnapshot()).toMatchObject({
      operationId: 'newer',
      status: 'running',
    });
    expect(store.getSnapshot().steps[0]).toMatchObject({
      id: 'capture-viewport',
      status: 'running',
    });
  });
});
