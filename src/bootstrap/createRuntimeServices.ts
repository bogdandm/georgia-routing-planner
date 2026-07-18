import { QueryCache, QueryClient } from '@tanstack/react-query';
import type { KyInstance } from 'ky';

import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type { MapCameraRepository } from '@/application/ports/MapCameraRepository';
import { buildInfo, type BuildInfo } from '@/bootstrap/buildInfo';
import {
  loadMapProviderConfiguration,
  summarizeMapProviderConfiguration,
  type MapProviderConfigurationResult,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { BoundedDiagnosticLogger } from '@/diagnostics/logging/BoundedDiagnosticLogger';
import { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';
import { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';
import { SentinelQueryDiagnosticsStore } from '@/diagnostics/snapshots/SentinelQueryDiagnosticsStore';
import { createHttpClient } from '@/infrastructure/http/createHttpClient';
import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { DexieMapCameraRepository } from '@/infrastructure/persistence/DexieMapCameraRepository';
import { BrowserClock } from '@/infrastructure/runtime/BrowserClock';
import { CryptoIdGenerator } from '@/infrastructure/runtime/CryptoIdGenerator';

/** The complete dependency bundle injected once at the React composition boundary. */
export interface RuntimeServices {
  readonly buildInfo: BuildInfo;
  readonly clock: Clock;
  readonly database: AppDatabase;
  readonly diagnostics: DiagnosticsService;
  readonly httpClient: KyInstance;
  readonly idGenerator: IdGenerator;
  readonly logger: DiagnosticLogger;
  readonly mapProviderConfiguration: MapProviderConfigurationResult;
  readonly mapCameraRepository: MapCameraRepository;
  readonly mapDiagnostics: MapDiagnosticsSnapshotStore;
  readonly queryClient: QueryClient;
  readonly sentinelQueryDiagnostics: SentinelQueryDiagnosticsStore;
}

/**
 * Constructs browser adapters, validates public configuration, and wires cross-cutting
 * diagnostics. Feature modules consume this bundle but must not construct replacements.
 */
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
  const mapCameraRepository = new DexieMapCameraRepository(database, clock, logger);
  const mapProviderConfiguration = loadMapProviderConfiguration(
    import.meta.env.VITE_MAP_PROVIDER_CONFIGURATION,
    new URL(import.meta.env.BASE_URL, globalThis.location.origin).toString(),
  );
  if (mapProviderConfiguration.status === 'valid') {
    const summary = summarizeMapProviderConfiguration(mapProviderConfiguration.value);
    logger.log({
      level: 'info',
      name: 'map.configuration.validated',
      data: {
        vectorId: summary.vectorId,
        vectorOrigin: summary.vectorOrigin,
        terrainId: summary.terrainId,
        terrainOrigin: summary.terrainOrigin,
      },
    });
  } else {
    logger.log({
      level: 'error',
      name: 'map.configuration.invalid',
      message: mapProviderConfiguration.message,
    });
  }
  const mapDiagnostics = new MapDiagnosticsSnapshotStore();
  const sentinelQueryDiagnostics = new SentinelQueryDiagnosticsStore(clock);
  const httpClient = createHttpClient(logger);
  const healthChecks = new HealthCheckService(
    clock,
    database,
    logger,
    mapDiagnostics,
    httpClient,
  );
  const diagnostics = new DiagnosticsService(
    buildInfo,
    logger,
    healthChecks,
    mapDiagnostics,
  );
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
    httpClient,
    idGenerator,
    logger,
    mapCameraRepository,
    mapDiagnostics,
    mapProviderConfiguration,
    queryClient,
    sentinelQueryDiagnostics,
  };
}
