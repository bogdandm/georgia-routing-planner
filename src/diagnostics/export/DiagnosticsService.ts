import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { BuildInfo } from '@/app/bootstrap/buildInfo';
import type {
  DiagnosticBundle,
  HealthCheckResult,
} from '@/diagnostics/export/diagnosticBundleSchema';
import { sanitizeDiagnosticText } from '@/diagnostics/redaction/redactDiagnosticData';
import type { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';

export class DiagnosticsService {
  #healthChecks: readonly HealthCheckResult[] = [];

  public constructor(
    private readonly build: BuildInfo,
    private readonly logger: DiagnosticLogger,
    private readonly healthCheckService: HealthCheckService,
  ) {}

  public async runHealthChecks(): Promise<readonly HealthCheckResult[]> {
    this.#healthChecks = await this.healthCheckService.run();
    return this.#healthChecks;
  }

  public createBundle(reproductionNotes = ''): DiagnosticBundle {
    return {
      schemaVersion: 1,
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
}
