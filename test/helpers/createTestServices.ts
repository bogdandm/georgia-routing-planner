import { QueryClient } from '@tanstack/react-query';

import type { Clock } from '@/application/ports/Clock';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import { DexieMapCameraRepository } from '@/infrastructure/persistence/DexieMapCameraRepository';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import type { SatelliteCatalogGateway } from '@/application/ports/SatelliteCatalogGateway';
import { LoadSatelliteAvailability } from '@/application/satellite/LoadSatelliteAvailability';
import { SearchSatelliteScenes } from '@/application/satellite/SearchSatelliteScenes';
import { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { BoundedDiagnosticLogger } from '@/diagnostics/logging/BoundedDiagnosticLogger';
import { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';
import { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';
import { SentinelQueryDiagnosticsStore } from '@/diagnostics/snapshots/SentinelQueryDiagnosticsStore';
import { createHttpClient } from '@/infrastructure/http/createHttpClient';
import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { EarthSearchSatelliteCatalogGateway } from '@/infrastructure/stac/EarthSearchSatelliteCatalogGateway';
import { BrowserStorageUsageReader } from '@/infrastructure/runtime/BrowserStorageUsageReader';
import { MapViewportSnapshotStore } from '@/presentation/map/MapViewportSnapshotStore';
import { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import type { ContourTileGenerator } from '@/presentation/map/ContourTileGenerator';

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

interface CreateTestServicesOptions {
  readonly satelliteCatalogGateway?: SatelliteCatalogGateway;
}

export function createTestServices(
  options: CreateTestServicesOptions = {},
): RuntimeServices {
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
  const mapDiagnostics = new MapDiagnosticsSnapshotStore();
  const sentinelQueryDiagnostics = new SentinelQueryDiagnosticsStore(clock);
  const mapViewport = new MapViewportSnapshotStore();
  const httpClient = createHttpClient(logger, clock, idGenerator);
  const parsedMapProviderConfiguration = parseMapProviderConfiguration(
    defaultMapProviderConfigurationInput,
    'https://example.test/georgia-routing-planner/',
  );
  const healthChecks = new HealthCheckService(
    clock,
    database,
    logger,
    mapDiagnostics,
    httpClient,
  );
  const satelliteCatalogGateway =
    options.satelliteCatalogGateway ??
    new EarthSearchSatelliteCatalogGateway(
      httpClient,
      parsedMapProviderConfiguration.satellite,
      parsedMapProviderConfiguration.policy.requestTimeoutMs,
      sentinelQueryDiagnostics,
      logger,
      clock,
    );
  const mapLayers = new MapLibreLayerController(
    parsedMapProviderConfiguration.satellite.renderer,
    parsedMapProviderConfiguration.terrain,
    {
      createTileUrl: (intervalMeters) =>
        `test-contour://tiles/{z}/{x}/{y}?minor=${String(intervalMeters)}&major=200`,
    } satisfies ContourTileGenerator,
    logger,
    idGenerator,
    sentinelQueryDiagnostics,
    parsedMapProviderConfiguration.policy.requestTimeoutMs,
    database,
  );

  return {
    buildInfo,
    clock,
    database,
    diagnostics: new DiagnosticsService(
      buildInfo,
      logger,
      healthChecks,
      mapDiagnostics,
    ),
    httpClient,
    idGenerator,
    logger,
    mapCameraRepository: new DexieMapCameraRepository(database, clock, logger),
    mapDiagnostics,
    mapViewport,
    mapLayers,
    mapProviderConfiguration: {
      status: 'valid',
      value: parsedMapProviderConfiguration,
    },
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    }),
    loadSatelliteAvailability: new LoadSatelliteAvailability(
      satelliteCatalogGateway,
      sentinelQueryDiagnostics,
      logger,
      idGenerator,
      clock,
    ),
    satelliteCatalogGateway,
    searchSatelliteScenes: new SearchSatelliteScenes(
      satelliteCatalogGateway,
      sentinelQueryDiagnostics,
      logger,
      idGenerator,
      clock,
    ),
    sentinelQueryDiagnostics,
    storageUsage: new BrowserStorageUsageReader({
      estimate: () =>
        Promise.resolve({
          usage: 8 * 1_048_576,
          quota: 512 * 1_048_576,
          usageDetails: {
            indexedDB: 3 * 1_048_576,
            caches: 4 * 1_048_576,
          },
        }),
      heapMemory: () => ({
        usedJSHeapSize: 48 * 1_048_576,
        totalJSHeapSize: 64 * 1_048_576,
        jsHeapSizeLimit: 2_048 * 1_048_576,
      }),
      localStorageEntries: () => [['test', 'value']],
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    }),
  };
}
