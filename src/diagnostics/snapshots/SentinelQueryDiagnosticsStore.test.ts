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
    store.beginStep('capture-viewport');
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
    store.completeStep('capture-viewport');
    store.completeOperation();

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
      store.completeStep('query-stac-catalog');
    }).not.toThrow();
    store.beginOperation('failed-operation');
    store.beginStep('query-stac-catalog');
    store.beginStep('fetch-result-pages');
    store.completeOperation();
    expect(store.getSnapshot().status).toBe('running');
    expect(
      store.getSnapshot().steps.find((step) => step.id === 'fetch-result-pages')
        ?.status,
    ).toBe('waiting');
    clock.monotonic = 75;
    store.failStep('query-stac-catalog');

    expect(store.getSnapshot()).toMatchObject({
      status: 'error',
      durationMs: 75,
    });
    expect(
      store.getSnapshot().steps.find((step) => step.id === 'query-stac-catalog'),
    ).toMatchObject({ status: 'error', durationMs: 75 });

    clock.monotonic = 100;
    store.beginOperation('cancelled-operation');
    store.beginStep('fetch-result-pages');
    clock.monotonic = 140;
    store.cancelOperation();

    expect(store.getSnapshot()).toMatchObject({
      status: 'cancelled',
      durationMs: 40,
    });
    expect(
      store.getSnapshot().steps.find((step) => step.id === 'fetch-result-pages'),
    ).toMatchObject({ status: 'cancelled', durationMs: 40 });
  });
});
