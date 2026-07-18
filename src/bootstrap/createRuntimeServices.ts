import { QueryCache, QueryClient } from '@tanstack/react-query';
import type { KyInstance } from 'ky';

import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import { buildInfo, type BuildInfo } from '@/bootstrap/buildInfo';
import { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { BoundedDiagnosticLogger } from '@/diagnostics/logging/BoundedDiagnosticLogger';
import { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';
import { createHttpClient } from '@/infrastructure/http/createHttpClient';
import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { BrowserClock } from '@/infrastructure/runtime/BrowserClock';
import { CryptoIdGenerator } from '@/infrastructure/runtime/CryptoIdGenerator';

export interface RuntimeServices {
  readonly buildInfo: BuildInfo;
  readonly clock: Clock;
  readonly database: AppDatabase;
  readonly diagnostics: DiagnosticsService;
  readonly httpClient: KyInstance;
  readonly idGenerator: IdGenerator;
  readonly logger: DiagnosticLogger;
  readonly queryClient: QueryClient;
}

export function createRuntimeServices(): RuntimeServices {
  const clock = new BrowserClock();
  const idGenerator = new CryptoIdGenerator();
  const developerFlag = new URLSearchParams(globalThis.location.search).get(
    'developer',
  );
  const logger = new BoundedDiagnosticLogger(
    clock,
    idGenerator,
    200,
    buildInfo.mode !== 'production' || developerFlag === '1',
  );
  const database = new AppDatabase(logger);
  const healthChecks = new HealthCheckService(clock, database, logger);
  const diagnostics = new DiagnosticsService(buildInfo, logger, healthChecks);
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        logger.log({
          level: 'error',
          name: 'query.failed',
          message: error instanceof Error ? error.message : 'Unknown query failure',
        });
      },
    }),
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5 * 60 * 1_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });

  logger.log({
    level: 'info',
    name: 'app.bootstrap.services-created',
    data: {
      appVersion: buildInfo.appVersion,
      buildMode: buildInfo.mode,
      commit: buildInfo.commit,
    },
  });

  return {
    buildInfo,
    clock,
    database,
    diagnostics,
    httpClient: createHttpClient(logger),
    idGenerator,
    logger,
    queryClient,
  };
}
