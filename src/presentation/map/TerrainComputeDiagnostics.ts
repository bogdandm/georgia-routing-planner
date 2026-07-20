import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { TerrainComputeMetrics } from '@/infrastructure/elevation/TerrainComputeBackend';
import { DiagnosticBatchWindow } from '@/presentation/map/DiagnosticBatchWindow';

type AggregateOperation = TerrainComputeMetrics['operation'] | 'mixed';

/** Batches worker queue and compute timings before they cross the diagnostics port. */
export class TerrainComputeDiagnostics {
  #count = 0;
  #queueDurationMs = 0;
  #computeDurationMs = 0;
  #pendingCount = 0;
  #operation: AggregateOperation | null = null;
  #status: TerrainComputeMetrics['status'] = 'success';
  #executionMode: TerrainComputeMetrics['executionMode'] = 'worker';
  readonly #window: DiagnosticBatchWindow;

  public constructor(
    private readonly logger: DiagnosticLogger,
    batchSize = 32,
    intervalMs = 5_000,
  ) {
    this.#window = new DiagnosticBatchWindow(
      () => {
        this.flushAggregate();
      },
      batchSize,
      intervalMs,
    );
  }

  public record(metrics: TerrainComputeMetrics): void {
    if (this.#window.disposed) return;
    this.#count += 1;
    this.#queueDurationMs += metrics.queueDurationMs;
    this.#computeDurationMs += metrics.computeDurationMs;
    this.#pendingCount = Math.max(this.#pendingCount, metrics.pendingCount);
    this.#operation =
      this.#operation === null || this.#operation === metrics.operation
        ? metrics.operation
        : 'mixed';
    this.#executionMode = metrics.executionMode;
    if (metrics.status === 'failed' || this.#status === 'failed') {
      this.#status = 'failed';
    } else if (metrics.status === 'canceled') {
      this.#status = 'canceled';
    }
    this.#window.record();
  }

  public flush(): void {
    this.#window.flush();
  }

  public dispose(): void {
    this.#window.dispose();
  }

  private flushAggregate(): void {
    const input = {
      level: this.#status === 'failed' ? 'warn' : 'debug',
      name: 'map.terrain-compute.completed',
      data: {
        count: this.#count,
        queueDurationMs: Math.round(this.#queueDurationMs),
        computeDurationMs: Math.round(this.#computeDurationMs),
        pendingCount: this.#pendingCount,
        executionMode: this.#executionMode,
        operation: this.#operation ?? 'mixed',
        status: this.#status,
      },
    } as const;
    this.#count = 0;
    this.#queueDurationMs = 0;
    this.#computeDurationMs = 0;
    this.#pendingCount = 0;
    this.#operation = null;
    this.#status = 'success';
    this.logger.log(input);
  }
}
