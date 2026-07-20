import { describe, expect, it, vi } from 'vitest';

import type {
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import { TerrainComputeDiagnostics } from '@/presentation/map/TerrainComputeDiagnostics';

describe('TerrainComputeDiagnostics', () => {
  it('emits bounded aggregates with the worst status and maximum queue depth', () => {
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const logger: DiagnosticLogger = { log, getEvents: () => [] };
    let now = 0;
    const diagnostics = new TerrainComputeDiagnostics(logger, () => now, 3, 5_000);

    diagnostics.record({
      executionMode: 'worker',
      operation: 'dem',
      queueDurationMs: 2,
      computeDurationMs: 4,
      pendingCount: 1,
      status: 'success',
    });
    now = 1;
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

    expect(log.mock.calls[1]?.[0]).toMatchObject({
      level: 'warn',
      name: 'map.terrain-compute.completed',
      data: {
        count: 3,
        queueDurationMs: 23,
        computeDurationMs: 33,
        pendingCount: 3,
        executionMode: 'worker',
        operation: 'mixed',
        status: 'failed',
      },
    });
  });
});
