import type {
  SentinelQueryDiagnostics,
  SentinelQueryStepId,
} from '@/application/ports/SentinelQueryDiagnostics';

/** Correlates best-effort timeline transitions for one cancellable application command. */
export class SentinelQueryOperation {
  #activeStep: SentinelQueryStepId | null = null;

  public constructor(
    public readonly id: string,
    private readonly diagnostics: SentinelQueryDiagnostics,
  ) {
    diagnostics.beginOperation(id);
  }

  public beginStep(stepId: SentinelQueryStepId): void {
    this.#activeStep = stepId;
    this.diagnostics.beginStep(this.id, stepId);
  }

  public completeStep(): void {
    if (this.#activeStep === null) return;
    this.diagnostics.completeStep(this.id, this.#activeStep);
    this.#activeStep = null;
  }

  public complete(): void {
    this.completeStep();
    this.diagnostics.completeOperation(this.id);
  }

  public fail(): void {
    if (this.#activeStep !== null) {
      this.diagnostics.failStep(this.id, this.#activeStep);
      this.#activeStep = null;
    }
    this.diagnostics.failOperation(this.id);
  }

  public cancel(): void {
    this.#activeStep = null;
    this.diagnostics.cancelOperation(this.id);
  }
}
