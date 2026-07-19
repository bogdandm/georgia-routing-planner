export const sentinelQueryStepIds = [
  'capture-viewport',
  'build-search-criteria',
  'query-stac-catalog',
  'fetch-result-pages',
  'validate-stac-json',
  'map-scene-metadata',
  'calculate-coverage',
  'select-visual-asset',
  'decode-reproject',
  'apply-imagery',
] as const;

export type SentinelQueryStepId = (typeof sentinelQueryStepIds)[number];

/**
 * Receives best-effort lifecycle transitions from Sentinel orchestration. Implementations
 * must ignore invalid diagnostic transitions and must never fail the primary operation.
 */
export interface SentinelQueryDiagnostics {
  beginOperation(operationId: string): void;
  beginStep(operationId: string, stepId: SentinelQueryStepId): void;
  completeStep(operationId: string, stepId: SentinelQueryStepId): void;
  failStep(operationId: string, stepId: SentinelQueryStepId): void;
  completeOperation(operationId: string): void;
  failOperation(operationId: string): void;
  cancelOperation(operationId: string): void;
}
