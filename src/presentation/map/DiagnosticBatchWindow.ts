type TimerHandle = ReturnType<typeof setTimeout>;

/** Owns only the count/interval flush window shared by map diagnostic aggregators. */
export class DiagnosticBatchWindow {
  #count = 0;
  #timer: TimerHandle | null = null;
  #disposed = false;

  public constructor(
    private readonly onFlush: () => void,
    private readonly batchSize = 32,
    private readonly intervalMs = 5_000,
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
