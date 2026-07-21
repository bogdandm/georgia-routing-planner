import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import { ContourTimingDiagnostics } from '@/presentation/map/ContourTimingDiagnostics';

describe('ContourTimingDiagnostics', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('flushes by interval and flushes a partial batch during disposal', () => {
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

  it('contains logger failures', () => {
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
