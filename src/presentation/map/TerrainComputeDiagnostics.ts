import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { TerrainComputeMetrics } from '@/infrastructure/elevation/TerrainComputeBackend';

type AggregateOperation = TerrainComputeMetrics['operation'] | 'mixed';

/** Batches worker queue and compute timings before they cross the diagnostics port. */
export class TerrainComputeDiagnostics {
  #count = 0;
  #queueDurationMs = 0;
  #computeDurationMs = 0;
  #pendingCount = 0;
  #operation: AggregateOperation | null = null;
  #status: TerrainComputeMetrics['status'] = 'success';
  #lastLoggedAt: number | null = null;

  public constructor(
    private readonly logger: DiagnosticLogger,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly batchSize = 32,
    private readonly intervalMs = 5_000,
  ) {}

  public record(metrics: TerrainComputeMetrics): void {
    this.#count += 1;
    this.#queueDurationMs += metrics.queueDurationMs;
    this.#computeDurationMs += metrics.computeDurationMs;
    this.#pendingCount = Math.max(this.#pendingCount, metrics.pendingCount);
    this.#operation =
      this.#operation === null || this.#operation === metrics.operation
        ? metrics.operation
        : 'mixed';
    if (metrics.status === 'failed' || this.#status === 'failed') {
      this.#status = 'failed';
    } else if (metrics.status === 'canceled') {
      this.#status = 'canceled';
    }
    const now = this.monotonicNow();
    if (
      this.#lastLoggedAt === null ||
      this.#count >= this.batchSize ||
      now - this.#lastLoggedAt >= this.intervalMs
    ) {
      this.flush(now, metrics.executionMode);
    }
  }

  private flush(
    now: number,
    executionMode: TerrainComputeMetrics['executionMode'],
  ): void {
    this.logger.log({
      level: this.#status === 'failed' ? 'warn' : 'debug',
      name: 'map.terrain-compute.completed',
      data: {
        count: this.#count,
        queueDurationMs: Math.round(this.#queueDurationMs),
        computeDurationMs: Math.round(this.#computeDurationMs),
        pendingCount: this.#pendingCount,
        executionMode,
        operation: this.#operation ?? 'mixed',
        status: this.#status,
      },
    });
    this.#count = 0;
    this.#queueDurationMs = 0;
    this.#computeDurationMs = 0;
    this.#pendingCount = 0;
    this.#operation = null;
    this.#status = 'success';
    this.#lastLoggedAt = now;
  }
}
