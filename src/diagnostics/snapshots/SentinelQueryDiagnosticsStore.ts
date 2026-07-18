import type { Clock } from '@/application/ports/Clock';
import type {
  SentinelQueryDiagnostics,
  SentinelQueryStepId,
} from '@/application/ports/SentinelQueryDiagnostics';

export const sentinelQueryStepDefinitions = [
  {
    id: 'capture-viewport',
    label: 'Capture viewport',
    detail: 'Read the settled bounds and center from the map snapshot.',
  },
  {
    id: 'build-search-criteria',
    label: 'Build search criteria',
    detail: 'Validate the date range, product level, and cloud threshold.',
  },
  {
    id: 'query-stac-catalog',
    label: 'Query STAC catalog',
    detail: 'POST the bounded request to /v1/search.',
  },
  {
    id: 'fetch-result-pages',
    label: 'Fetch result pages',
    detail: 'Follow provider next links within the pagination limit.',
  },
  {
    id: 'validate-stac-json',
    label: 'Validate STAC JSON',
    detail: 'Parse the FeatureCollection, items, geometry, and assets.',
  },
  {
    id: 'map-scene-metadata',
    label: 'Map scene metadata',
    detail: 'Create readonly SatelliteScene values from validated items.',
  },
  {
    id: 'calculate-coverage',
    label: 'Calculate coverage',
    detail: 'Compute coverage, edge distance, UTC grouping, and counts.',
  },
  {
    id: 'select-visual-asset',
    label: 'Select visual asset',
    detail: 'Resolve the L2A COG or approved L1C rendering path.',
  },
  {
    id: 'decode-reproject',
    label: 'Decode and reproject',
    detail: 'Read ranges, decode off-thread, and transform the source CRS.',
  },
  {
    id: 'apply-imagery',
    label: 'Apply imagery and footprint',
    detail: 'Update the MapLibre raster and GeoJSON footprint layers.',
  },
] as const satisfies readonly {
  readonly id: SentinelQueryStepId;
  readonly label: string;
  readonly detail: string;
}[];

export type SentinelQueryStepStatus =
  'waiting' | 'running' | 'success' | 'error' | 'cancelled' | 'skipped';
export type SentinelQueryStatus =
  'idle' | 'running' | 'success' | 'error' | 'cancelled';

export interface SentinelQueryStepSnapshot {
  readonly id: SentinelQueryStepId;
  readonly label: string;
  readonly detail: string;
  readonly status: SentinelQueryStepStatus;
  readonly durationMs: number | null;
}

export interface SentinelQueryDiagnosticsSnapshot {
  readonly operationId: string | null;
  readonly startedAt: string | null;
  readonly status: SentinelQueryStatus;
  readonly durationMs: number | null;
  readonly steps: readonly SentinelQueryStepSnapshot[];
}

function createWaitingSteps(): readonly SentinelQueryStepSnapshot[] {
  return sentinelQueryStepDefinitions.map((step) => ({
    ...step,
    status: 'waiting',
    durationMs: null,
  }));
}

/**
 * Publishes a serializable, local-only view of the active or most recent Sentinel
 * workflow. Invalid diagnostic transitions are ignored so instrumentation can never
 * break the primary search or rendering operation.
 */
export class SentinelQueryDiagnosticsStore implements SentinelQueryDiagnostics {
  readonly #listeners = new Set<() => void>();
  readonly #stepStartedAt = new Map<SentinelQueryStepId, number>();
  #operationStartedAt: number | null = null;
  #snapshot: SentinelQueryDiagnosticsSnapshot = {
    operationId: null,
    startedAt: null,
    status: 'idle',
    durationMs: null,
    steps: createWaitingSteps(),
  };

  public constructor(private readonly clock: Clock) {}

  public beginOperation(operationId: string): void {
    if (operationId.length === 0) return;

    this.#operationStartedAt = this.clock.monotonicNow();
    this.#stepStartedAt.clear();
    this.#snapshot = {
      operationId,
      startedAt: this.clock.now().toISOString(),
      status: 'running',
      durationMs: 0,
      steps: createWaitingSteps(),
    };
    this.notify();
  }

  public beginStep(stepId: SentinelQueryStepId): void {
    if (this.#snapshot.status !== 'running') return;
    if (this.#snapshot.steps.some((step) => step.status === 'running')) return;

    const step = this.#snapshot.steps.find((candidate) => candidate.id === stepId);
    if (step?.status !== 'waiting') return;

    this.#stepStartedAt.set(stepId, this.clock.monotonicNow());
    this.updateStep(stepId, 'running', 0);
  }

  public completeStep(stepId: SentinelQueryStepId): void {
    this.finishStep(stepId, 'success');
  }

  public failStep(stepId: SentinelQueryStepId): void {
    if (!this.finishStep(stepId, 'error')) return;

    this.#snapshot = {
      ...this.#snapshot,
      status: 'error',
      durationMs: this.readOperationDuration(),
    };
    this.notify();
  }

  public completeOperation(): void {
    if (this.#snapshot.status !== 'running') return;
    if (this.#snapshot.steps.some((step) => step.status === 'running')) return;

    this.#snapshot = {
      ...this.#snapshot,
      status: 'success',
      durationMs: this.readOperationDuration(),
      steps: this.#snapshot.steps.map((step) =>
        step.status === 'waiting' ? { ...step, status: 'skipped' } : step,
      ),
    };
    this.#stepStartedAt.clear();
    this.notify();
  }

  public cancelOperation(): void {
    if (this.#snapshot.status !== 'running') return;

    const now = this.clock.monotonicNow();
    const durationMs = this.durationSince(this.#operationStartedAt, now);
    this.#snapshot = {
      ...this.#snapshot,
      status: 'cancelled',
      durationMs,
      steps: this.#snapshot.steps.map((step) =>
        step.status === 'running'
          ? {
              ...step,
              status: 'cancelled',
              durationMs: this.durationSince(
                this.#stepStartedAt.get(step.id) ?? null,
                now,
              ),
            }
          : step,
      ),
    };
    this.#stepStartedAt.clear();
    this.notify();
  }

  /** Refreshes visible elapsed time only while an operation is running. */
  public refreshRunningDurations(): void {
    if (this.#snapshot.status !== 'running') return;

    const now = this.clock.monotonicNow();
    this.#snapshot = {
      ...this.#snapshot,
      durationMs: this.durationSince(this.#operationStartedAt, now),
      steps: this.#snapshot.steps.map((step) => {
        const startedAt = this.#stepStartedAt.get(step.id);
        return step.status === 'running'
          ? { ...step, durationMs: this.durationSince(startedAt ?? null, now) }
          : step;
      }),
    };
    this.notify();
  }

  public getSnapshot(): SentinelQueryDiagnosticsSnapshot {
    return this.#snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  private finishStep(
    stepId: SentinelQueryStepId,
    status: 'success' | 'error',
  ): boolean {
    if (this.#snapshot.status !== 'running') return false;

    const step = this.#snapshot.steps.find((candidate) => candidate.id === stepId);
    const startedAt = this.#stepStartedAt.get(stepId);
    if (step?.status !== 'running' || startedAt === undefined) return false;

    this.#stepStartedAt.delete(stepId);
    this.updateStep(stepId, status, Math.max(0, this.clock.monotonicNow() - startedAt));
    return true;
  }

  private updateStep(
    stepId: SentinelQueryStepId,
    status: SentinelQueryStepStatus,
    durationMs: number,
  ): void {
    this.#snapshot = {
      ...this.#snapshot,
      steps: this.#snapshot.steps.map((step) =>
        step.id === stepId ? { ...step, status, durationMs } : step,
      ),
    };
    this.notify();
  }

  private readOperationDuration(): number {
    return this.durationSince(this.#operationStartedAt, this.clock.monotonicNow());
  }

  private durationSince(startedAt: number | null, now: number): number {
    return startedAt === null ? 0 : Math.max(0, now - startedAt);
  }

  private notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
