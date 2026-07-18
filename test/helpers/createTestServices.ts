import { QueryClient } from '@tanstack/react-query';

import type { Clock } from '@/application/ports/Clock';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import { DexieMapCameraRepository } from '@/infrastructure/persistence/DexieMapCameraRepository';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { BoundedDiagnosticLogger } from '@/diagnostics/logging/BoundedDiagnosticLogger';
import { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';
import { createHttpClient } from '@/infrastructure/http/createHttpClient';
import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';

class TestClock implements Clock {
  #monotonic = 0;

  public now(): Date {
    return new Date('2026-07-18T00:00:00.000Z');
  }

  public monotonicNow(): number {
    this.#monotonic += 1;
    return this.#monotonic;
  }
}

class TestIdGenerator implements IdGenerator {
  #nextId = 0;

  public generate(): string {
    this.#nextId += 1;
    return `test-${String(this.#nextId)}`;
  }
}

export function createTestServices(): RuntimeServices {
  const clock = new TestClock();
  const idGenerator = new TestIdGenerator();
  const logger = new BoundedDiagnosticLogger(clock, idGenerator);
  const database = new AppDatabase(logger);
  const buildInfo = {
    appVersion: '0.0.0-test',
    commit: 'test-commit',
    timestamp: '2026-07-18T00:00:00.000Z',
    mode: 'test',
  };
  const healthChecks = new HealthCheckService(clock, database, logger);

  return {
    buildInfo,
    clock,
    database,
    diagnostics: new DiagnosticsService(buildInfo, logger, healthChecks),
    httpClient: createHttpClient(logger),
    idGenerator,
    logger,
    mapCameraRepository: new DexieMapCameraRepository(database, clock, logger),
    mapProviderConfiguration: {
      status: 'valid',
      value: parseMapProviderConfiguration(
        defaultMapProviderConfigurationInput,
        'https://example.test/georgia-routing-planner/',
      ),
    },
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    }),
  };
}
