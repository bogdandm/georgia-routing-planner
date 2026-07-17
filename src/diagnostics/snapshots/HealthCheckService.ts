import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { HealthCheckResult } from '@/diagnostics/export/diagnosticBundleSchema';
import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';

export class HealthCheckService {
  public constructor(
    private readonly clock: Clock,
    private readonly database: AppDatabase,
    private readonly logger: DiagnosticLogger,
  ) {}

  public async run(): Promise<readonly HealthCheckResult[]> {
    const [indexedDb, storageEstimate] = await Promise.all([
      this.checkIndexedDb(),
      this.checkStorageEstimate(),
    ]);
    const results = [
      this.checkBrowserCapabilities(),
      this.checkWebGl(),
      indexedDb,
      storageEstimate,
    ];
    this.logger.log({
      level: results.some((result) => result.status === 'fail') ? 'warn' : 'info',
      name: 'health.run.completed',
      data: {
        count: results.length,
        status: results.some((result) => result.status === 'fail') ? 'fail' : 'pass',
      },
    });
    return results;
  }

  private checkBrowserCapabilities(): HealthCheckResult {
    const startedAt = this.clock.monotonicNow();
    const missing = [
      typeof Promise === 'undefined' ? 'Promise' : null,
      typeof crypto.randomUUID !== 'function' ? 'crypto.randomUUID' : null,
      typeof indexedDB === 'undefined' ? 'IndexedDB' : null,
    ].filter((value): value is string => value !== null);

    return {
      name: 'Browser capabilities',
      status: missing.length === 0 ? 'pass' : 'fail',
      durationMs: this.clock.monotonicNow() - startedAt,
      summary:
        missing.length === 0
          ? 'Required browser APIs are available.'
          : `Missing: ${missing.join(', ')}`,
      ...(missing.length === 0
        ? {}
        : {
            remediation: 'Open the application in the current stable Chrome release.',
          }),
    };
  }

  private checkWebGl(): HealthCheckResult {
    const startedAt = this.clock.monotonicNow();
    const canvas = document.createElement('canvas');
    const available =
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) !== null ||
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }) !== null;

    return {
      name: 'WebGL',
      status: available ? 'pass' : 'fail',
      durationMs: this.clock.monotonicNow() - startedAt,
      summary: available ? 'A WebGL context can be created.' : 'WebGL is unavailable.',
      ...(available
        ? {}
        : { remediation: 'Enable hardware acceleration and restart Chrome.' }),
    };
  }

  private async checkIndexedDb(): Promise<HealthCheckResult> {
    const startedAt = this.clock.monotonicNow();
    try {
      await this.database.probe();
      return {
        name: 'IndexedDB',
        status: 'pass',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'Temporary read/write/delete probe succeeded.',
      };
    } catch {
      return {
        name: 'IndexedDB',
        status: 'fail',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'IndexedDB probe failed.',
        remediation: 'Check site storage permissions or clear corrupt site data.',
      };
    }
  }

  private async checkStorageEstimate(): Promise<HealthCheckResult> {
    const startedAt = this.clock.monotonicNow();
    const estimate = await navigator.storage.estimate();
    return {
      name: 'Storage estimate',
      status: 'pass',
      durationMs: this.clock.monotonicNow() - startedAt,
      summary: `Using ${String(estimate.usage ?? 0)} of ${String(estimate.quota ?? 0)} bytes.`,
    };
  }
}
