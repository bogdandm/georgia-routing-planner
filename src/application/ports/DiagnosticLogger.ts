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
  getEvents(): readonly DiagnosticEvent[];
}
