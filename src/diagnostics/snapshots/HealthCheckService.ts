import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type { HealthCheckResult } from '@/diagnostics/export/diagnosticBundleSchema';
import type { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';
import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import type { KyInstance } from 'ky';

/** Runs bounded, non-destructive browser, storage, map, and provider self-checks. */
export class HealthCheckService {
  public constructor(
    private readonly clock: Clock,
    private readonly database: AppDatabase,
    private readonly logger: DiagnosticLogger,
    private readonly mapSnapshots: MapDiagnosticsSnapshotStore,
    private readonly httpClient: KyInstance,
  ) {}

  public async run(): Promise<readonly HealthCheckResult[]> {
    const [indexedDb, storageEstimate] = await Promise.all([
      this.checkIndexedDb(),
      this.checkStorageEstimate(),
    ]);
    const results = [
      this.checkBrowserCapabilities(),
      this.checkWebGl(),
      this.checkMapReadiness(),
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

  /**
   * Probes configured providers only after an explicit user action. Cancellation is
   * owned by the caller; application startup must never wait for this operation.
   */
  public async runProviderReachability(
    configuration: MapProviderConfiguration,
    signal: AbortSignal,
  ): Promise<readonly HealthCheckResult[]> {
    const terrainProbeUrl = configuration.terrain.tileUrl
      .replace('{z}', '0')
      .replace('{x}', '0')
      .replace('{y}', '0');
    const results = await Promise.all([
      this.checkProvider(
        'Vector provider reachability',
        configuration.vector.tileJsonUrl,
        configuration.policy.requestTimeoutMs,
        signal,
      ),
      this.checkProvider(
        'Terrain provider reachability',
        terrainProbeUrl,
        configuration.policy.requestTimeoutMs,
        signal,
        { Range: 'bytes=0-1023' },
      ),
      this.checkSatelliteProvider(configuration, signal),
    ]);
    this.logger.log({
      level: results.some((result) => result.status === 'fail') ? 'warn' : 'info',
      name: 'health.providers.completed',
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
    if (typeof WebGLRenderingContext === 'undefined') {
      return {
        name: 'WebGL',
        status: 'fail',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'WebGL is unavailable.',
        remediation: 'Enable hardware acceleration and restart Chrome.',
      };
    }
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

  private checkMapReadiness(): HealthCheckResult {
    const startedAt = this.clock.monotonicNow();
    const snapshot = this.mapSnapshots.getSnapshot();
    if (snapshot === null) {
      return {
        name: 'Map readiness',
        status: 'warn',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'The map has not published a diagnostics snapshot yet.',
        remediation: 'Open the map workspace and run the checks again.',
      };
    }

    return {
      name: 'Map readiness',
      status:
        snapshot.lifecycle === 'fatal'
          ? 'fail'
          : snapshot.lifecycle === 'degraded'
            ? 'warn'
            : 'pass',
      durationMs: this.clock.monotonicNow() - startedAt,
      summary: `Map lifecycle is ${snapshot.lifecycle}; WebGL context is ${snapshot.webGlContext}.`,
      ...(snapshot.lifecycle === 'fatal'
        ? {
            remediation:
              'Check hardware acceleration and provider configuration, then reload.',
          }
        : {}),
    };
  }

  private async checkProvider(
    name: string,
    url: string,
    timeoutMs: number,
    signal: AbortSignal,
    headers?: Readonly<Record<string, string>>,
  ): Promise<HealthCheckResult> {
    const startedAt = this.clock.monotonicNow();
    try {
      await this.httpClient.get(url, {
        signal,
        timeout: timeoutMs,
        ...(headers === undefined ? {} : { headers }),
      });
      return {
        name,
        status: 'pass',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'The configured provider responded successfully.',
      };
    } catch {
      return {
        name,
        status: 'fail',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'The configured provider did not respond successfully.',
        remediation:
          'Check connectivity and provider status. No automatic provider switch was attempted.',
      };
    }
  }

  private async checkSatelliteProvider(
    configuration: MapProviderConfiguration,
    signal: AbortSignal,
  ): Promise<HealthCheckResult> {
    const startedAt = this.clock.monotonicNow();
    try {
      await this.httpClient.post(configuration.satellite.searchUrl, {
        signal,
        timeout: configuration.policy.requestTimeoutMs,
        json: {
          collections: [configuration.satellite.collections.L2A],
          intersects: { type: 'Point', coordinates: [44.005, 42.005] },
          datetime: '2025-01-01T00:00:00.000Z/2025-01-01T23:59:59.999Z',
          fields: { include: ['id'] },
          limit: 1,
        },
      });
      return {
        name: 'Satellite catalog reachability',
        status: 'pass',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'The configured Sentinel STAC search endpoint accepted a probe.',
      };
    } catch {
      return {
        name: 'Satellite catalog reachability',
        status: 'fail',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'The configured Sentinel STAC search endpoint rejected the probe.',
        remediation:
          'Check connectivity and provider status. No automatic catalog switch was attempted.',
      };
    }
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
    try {
      const estimate = await navigator.storage.estimate();
      return {
        name: 'Storage estimate',
        status: 'pass',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: `Using ${String(estimate.usage ?? 0)} of ${String(estimate.quota ?? 0)} bytes.`,
      };
    } catch {
      return {
        name: 'Storage estimate',
        status: 'warn',
        durationMs: this.clock.monotonicNow() - startedAt,
        summary: 'The browser did not provide a storage quota estimate.',
      };
    }
  }
}
