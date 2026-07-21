import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import { DiagnosticBatchWindow } from '@/presentation/map/DiagnosticBatchWindow';

export interface ContourTimingSample {
  readonly durationMs: number;
  readonly tileCount: number;
  readonly failed: boolean;
}

/** Aggregates the contour library's per-tile callback before crossing the logging port. */
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
