import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import {
  ContourTimingDiagnostics,
  TerrainComputeDiagnostics,
} from '@/presentation/map/TerrainComputeDiagnostics';

afterEach(() => {
  vi.useRealTimers();
});

describe('TerrainComputeDiagnostics', () => {
  it('emits bounded aggregates with the worst status and maximum queue depth', () => {
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const logger: DiagnosticLogger = { log, getEvents: () => [] };
    const diagnostics = new TerrainComputeDiagnostics(logger, 3, 5_000);

    diagnostics.record({
      executionMode: 'worker',
      operation: 'dem',
      queueDurationMs: 2,
      computeDurationMs: 4,
      pendingCount: 1,
      status: 'success',
    });
    diagnostics.record({
      executionMode: 'worker',
      operation: 'contour',
      queueDurationMs: 3,
      computeDurationMs: 5,
      pendingCount: 3,
      status: 'canceled',
    });
    diagnostics.record({
      executionMode: 'worker',
      operation: 'contour',
      queueDurationMs: 7,
      computeDurationMs: 11,
      pendingCount: 2,
      status: 'failed',
    });
    diagnostics.record({
      executionMode: 'worker',
      operation: 'dem',
      queueDurationMs: 13,
      computeDurationMs: 17,
      pendingCount: 1,
      status: 'success',
    });

    expect(log.mock.calls[0]?.[0]).toMatchObject({
      level: 'warn',
      name: 'map.terrain-compute.completed',
      data: {
        count: 3,
        queueDurationMs: 12,
        computeDurationMs: 20,
        pendingCount: 3,
        executionMode: 'worker',
        operation: 'mixed',
        status: 'failed',
      },
    });
    diagnostics.dispose();
  });

  it('flushes a partial batch on disposal and ignores later metrics', () => {
    vi.useFakeTimers();
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const diagnostics = new TerrainComputeDiagnostics(
      { log, getEvents: () => [] },
      32,
      100,
    );
    const metrics = {
      executionMode: 'worker' as const,
      operation: 'dem' as const,
      queueDurationMs: 2,
      computeDurationMs: 4,
      pendingCount: 1,
      status: 'success' as const,
    };

    diagnostics.record(metrics);
    vi.advanceTimersByTime(100);
    diagnostics.record(metrics);
    diagnostics.dispose();
    diagnostics.record({ ...metrics, status: 'failed' });
    vi.runAllTimers();

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).toMatchObject({
      data: { count: 1, executionMode: 'worker', status: 'success' },
    });
  });
});

describe('ContourTimingDiagnostics', () => {
  it('emits fixed-size aggregate batches and retains a failure within the batch', () => {
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const logger: DiagnosticLogger = { log, getEvents: () => [] };
    const diagnostics = new ContourTimingDiagnostics(logger, 3, 5_000);

    diagnostics.record({ durationMs: 4, tileCount: 1, failed: false });
    diagnostics.record({ durationMs: 6, tileCount: 2, failed: true });
    diagnostics.record({ durationMs: 8, tileCount: 3, failed: false });
    diagnostics.record({ durationMs: 10, tileCount: 4, failed: false });

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      name: 'map.contours.tiles-generated',
      level: 'warn',
      data: { count: 3, durationMs: 18, tileCount: 6, status: 'failed' },
    });
    diagnostics.dispose();
  });

  it('flushes contour timing by interval and during disposal', () => {
    vi.useFakeTimers();
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const diagnostics = new ContourTimingDiagnostics(
      { log, getEvents: () => [] },
      32,
      100,
    );

    diagnostics.record({ durationMs: 4, tileCount: 1, failed: false });
    vi.advanceTimersByTime(100);
    diagnostics.record({ durationMs: 6, tileCount: 2, failed: false });
    diagnostics.dispose();
    diagnostics.record({ durationMs: 8, tileCount: 3, failed: true });
    vi.runAllTimers();

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0].data).toMatchObject({ count: 1, tileCount: 1 });
    expect(log.mock.calls[1]?.[0].data).toMatchObject({ count: 1, tileCount: 2 });
  });

  it('contains contour diagnostic logger failures', () => {
    const diagnostics = new ContourTimingDiagnostics(
      {
        log: () => {
          throw new Error('diagnostics unavailable');
        },
        getEvents: () => [],
      },
      1,
    );

    expect(() => {
      diagnostics.record({ durationMs: 4, tileCount: 1, failed: false });
    }).not.toThrow();
  });
});
