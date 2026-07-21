import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { TerrainComputeMetrics } from '@/infrastructure/elevation/TerrainComputeBackend';

class DiagnosticBatchWindow {
  #count = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  public constructor(
    private readonly onFlush: () => void,
    private readonly batchSize: number,
    private readonly intervalMs: number,
  ) {}

  public get disposed(): boolean {
    return this.#disposed;
  }

  public record(): void {
    if (this.#disposed) return;
    this.#count += 1;
    if (this.#count >= this.batchSize) {
      this.flush();
      return;
    }
    this.#timer ??= setTimeout(() => {
      this.#timer = null;
      this.flush();
    }, this.intervalMs);
  }

  public flush(): void {
    if (this.#disposed || this.#count === 0) return;
    this.clearTimer();
    this.#count = 0;
    try {
      this.onFlush();
    } catch {
      // Diagnostics are best-effort and must never fail terrain delivery.
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.flush();
    this.#disposed = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }
}

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

interface ContourTimingSample {
  readonly durationMs: number;
  readonly tileCount: number;
  readonly failed: boolean;
}

/** Aggregates the contour library's per-tile callback before logging it. */
export class ContourTimingDiagnostics {
  #count = 0;
  #durationMs = 0;
  #tileCount = 0;
  #failed = false;
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

  public record(sample: ContourTimingSample): void {
    if (this.#window.disposed) return;
    this.#count += 1;
    this.#durationMs += sample.durationMs;
    this.#tileCount += sample.tileCount;
    this.#failed ||= sample.failed;
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
      level: this.#failed ? 'warn' : 'debug',
      name: 'map.contours.tiles-generated',
      data: {
        count: this.#count,
        durationMs: Math.round(this.#durationMs),
        tileCount: this.#tileCount,
        status: this.#failed ? 'failed' : 'success',
      },
    } as const;
    this.#count = 0;
    this.#durationMs = 0;
    this.#tileCount = 0;
    this.#failed = false;
    this.logger.log(input);
  }
}
