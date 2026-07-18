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
  beginStep(stepId: SentinelQueryStepId): void;
  completeStep(stepId: SentinelQueryStepId): void;
  failStep(stepId: SentinelQueryStepId): void;
  completeOperation(): void;
  cancelOperation(): void;
}
