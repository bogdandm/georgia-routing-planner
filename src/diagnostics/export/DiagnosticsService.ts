import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { BuildInfo } from '@/bootstrap/buildInfo';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type {
  DiagnosticBundle,
  HealthCheckResult,
} from '@/diagnostics/export/diagnosticBundleSchema';
import { sanitizeDiagnosticText } from '@/diagnostics/redaction/redactDiagnosticData';
import type { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';
import type { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';

function roundTo(value: number, decimalPlaces: number): number {
  const scale = 10 ** decimalPlaces;
  return Math.round(value * scale) / scale;
}

/**
 * Combines bounded events, health results, and a privacy-reduced map snapshot into the
 * local support bundle. This service never uploads diagnostics.
 */
export class DiagnosticsService {
  #healthChecks: readonly HealthCheckResult[] = [];

  public constructor(
    private readonly build: BuildInfo,
    private readonly logger: DiagnosticLogger,
    private readonly healthCheckService: HealthCheckService,
    private readonly mapSnapshots: MapDiagnosticsSnapshotStore,
  ) {}

  public async runHealthChecks(): Promise<readonly HealthCheckResult[]> {
    this.#healthChecks = this.mergeHealthChecks(await this.healthCheckService.run());
    return this.#healthChecks;
  }

  public async runProviderHealthChecks(
    configuration: MapProviderConfiguration,
    signal: AbortSignal,
  ): Promise<readonly HealthCheckResult[]> {
    this.#healthChecks = this.mergeHealthChecks(
      await this.healthCheckService.runProviderReachability(configuration, signal),
    );
    return this.#healthChecks;
  }

  public createBundle(reproductionNotes = ''): DiagnosticBundle {
    return {
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      build: this.build,
      runtime: {
        userAgent: sanitizeDiagnosticText(navigator.userAgent),
        language: navigator.language,
        online: navigator.onLine,
      },
      reproductionNotes: sanitizeDiagnosticText(reproductionNotes),
      healthChecks: [...this.#healthChecks],
      events: [...this.logger.getEvents()],
      map: this.createMapExport(),
    };
  }

  public downloadBundle(reproductionNotes = ''): void {
    const bundle = this.createBundle(reproductionNotes);
    const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `diagnostics-${bundle.exportedAt.replaceAll(':', '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private createMapExport(): DiagnosticBundle['map'] {
    const snapshot = this.mapSnapshots.getSnapshot();
    if (snapshot === null) return null;

    return {
      ...snapshot,
      camera: {
        ...snapshot.camera,
        // Exact camera coordinates remain available locally in developer mode only.
        longitude: roundTo(snapshot.camera.longitude, 1),
        latitude: roundTo(snapshot.camera.latitude, 1),
        zoom: roundTo(snapshot.camera.zoom, 2),
        bearing: roundTo(snapshot.camera.bearing, 1),
        pitch: roundTo(snapshot.camera.pitch, 1),
      },
      sourceIds: [...snapshot.sourceIds],
      layerIds: [...snapshot.layerIds],
      recoverableFailures: snapshot.recoverableFailures.map((failure) => ({
        ...failure,
      })),
    };
  }

  private mergeHealthChecks(
    incoming: readonly HealthCheckResult[],
  ): readonly HealthCheckResult[] {
    const byName = new Map(this.#healthChecks.map((check) => [check.name, check]));
    for (const check of incoming) byName.set(check.name, check);
    return [...byName.values()];
  }
}
