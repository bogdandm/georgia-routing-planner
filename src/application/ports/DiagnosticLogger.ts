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

export interface DiagnosticLogger {
  log(input: DiagnosticInput): void;
  getEvents(): readonly DiagnosticEvent[];
}
