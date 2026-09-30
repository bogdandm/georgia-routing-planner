export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export type DiagnosticFieldValue = boolean | number | string | null;

export interface DiagnosticInput {
  readonly level: DiagnosticLevel;
  readonly name: string;
  readonly message?: string;
  readonly data?: Readonly<Record<string, DiagnosticFieldValue>>;
}

export interface DiagnosticEvent extends DiagnosticInput {
  readonly id: string;
  readonly timestamp: string;
}

/**
 * Accepts structured diagnostic events and exposes a bounded, already-redacted snapshot.
 * Implementations must not allow logging failures to break the primary operation.
 */
export interface DiagnosticLogger {
  log(input: DiagnosticInput): void;
  /** Returns an immutable snapshot that keeps its identity until the next logged event. */
  getEvents(): readonly DiagnosticEvent[];
  /** Notifies `listener` after each logged event; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
