import { describe, expect, it, vi } from 'vitest';

import type {
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import { ContourTimingDiagnostics } from '@/presentation/map/ContourTimingDiagnostics';

describe('ContourTimingDiagnostics', () => {
  it('emits fixed-size aggregate batches and retains a failure within the batch', () => {
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const logger: DiagnosticLogger = { log, getEvents: () => [] };
    let now = 0;
    const diagnostics = new ContourTimingDiagnostics(logger, () => now, 3, 5_000);

    diagnostics.record({ durationMs: 4, tileCount: 1, failed: false });
    now = 1;
    diagnostics.record({ durationMs: 6, tileCount: 2, failed: true });
    diagnostics.record({ durationMs: 8, tileCount: 3, failed: false });
    diagnostics.record({ durationMs: 10, tileCount: 4, failed: false });

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).toMatchObject({
      name: 'map.contours.tiles-generated',
      level: 'warn',
      data: { count: 3, durationMs: 24, tileCount: 9, status: 'failed' },
    });
  });
});
