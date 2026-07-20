import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';

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
  #lastLoggedAt: number | null = null;

  public constructor(
    private readonly logger: DiagnosticLogger,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly batchSize = 32,
    private readonly intervalMs = 5_000,
  ) {}

  public record(sample: ContourTimingSample): void {
    this.#count += 1;
    this.#durationMs += sample.durationMs;
    this.#tileCount += sample.tileCount;
    this.#failed ||= sample.failed;
    const now = this.monotonicNow();
    if (
      this.#lastLoggedAt === null ||
      this.#count >= this.batchSize ||
      now - this.#lastLoggedAt >= this.intervalMs
    ) {
      this.flush(now);
    }
  }

  private flush(now: number): void {
    this.logger.log({
      level: this.#failed ? 'warn' : 'debug',
      name: 'map.contours.tiles-generated',
      data: {
        count: this.#count,
        durationMs: Math.round(this.#durationMs),
        tileCount: this.#tileCount,
        status: this.#failed ? 'failed' : 'success',
      },
    });
    this.#count = 0;
    this.#durationMs = 0;
    this.#tileCount = 0;
    this.#failed = false;
    this.#lastLoggedAt = now;
  }
}
