import { QueryCache, QueryClient } from '@tanstack/react-query';
import type { KyInstance } from 'ky';

import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { ElevationProvider } from '@/application/ports/ElevationProvider';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type { MapCameraRepository } from '@/application/ports/MapCameraRepository';
import { SearchPlaces } from '@/application/map/SearchPlaces';
import type { SatelliteCatalogGateway } from '@/application/ports/SatelliteCatalogGateway';
import type { StorageUsageReader } from '@/application/ports/StorageUsageReader';
import { LoadSatelliteAvailability } from '@/application/satellite/LoadSatelliteAvailability';
import { SearchSatelliteScenes } from '@/application/satellite/SearchSatelliteScenes';
import { buildInfo, type BuildInfo } from '@/bootstrap/buildInfo';
import {
  loadMapProviderConfiguration,
  summarizeMapProviderConfiguration,
  type MapProviderConfigurationResult,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { loadGeocodingProviderConfiguration } from '@/bootstrap/configuration/GeocodingProviderConfiguration';
import { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { BoundedDiagnosticLogger } from '@/diagnostics/logging/BoundedDiagnosticLogger';
import { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';
import { MapDiagnosticsSnapshotStore } from '@/diagnostics/snapshots/MapDiagnosticsSnapshotStore';
import { SentinelQueryDiagnosticsStore } from '@/diagnostics/snapshots/SentinelQueryDiagnosticsStore';
import { createHttpClient } from '@/infrastructure/http/createHttpClient';
import { RasterDemElevationProvider } from '@/infrastructure/elevation/RasterDemElevationProvider';
import { NominatimPlaceSearchGateway } from '@/infrastructure/geocoding/NominatimPlaceSearchGateway';
import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { DexieMapCameraRepository } from '@/infrastructure/persistence/DexieMapCameraRepository';
import { BrowserClock } from '@/infrastructure/runtime/BrowserClock';
import { BrowserStorageUsageReader } from '@/infrastructure/runtime/BrowserStorageUsageReader';
import { CryptoIdGenerator } from '@/infrastructure/runtime/CryptoIdGenerator';
import { EarthSearchSatelliteCatalogGateway } from '@/infrastructure/stac/EarthSearchSatelliteCatalogGateway';
import { MapViewportSnapshotStore } from '@/presentation/map/MapViewportSnapshotStore';
import { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import { MapLibreContourTileGenerator } from '@/presentation/map/ContourTileGenerator';

/** The complete dependency bundle injected once at the React composition boundary. */
export interface RuntimeServices {
  readonly buildInfo: BuildInfo;
  readonly clock: Clock;
  readonly database: AppDatabase;
  readonly diagnostics: DiagnosticsService;
  readonly httpClient: KyInstance;
  readonly idGenerator: IdGenerator;
  readonly logger: DiagnosticLogger;
  readonly elevationProvider: ElevationProvider | null;
  readonly mapProviderConfiguration: MapProviderConfigurationResult;
  readonly mapCameraRepository: MapCameraRepository;
  readonly mapDiagnostics: MapDiagnosticsSnapshotStore;
  readonly mapViewport: MapViewportSnapshotStore;
  readonly mapLayers: MapLibreLayerController | null;
  readonly queryClient: QueryClient;
  readonly loadSatelliteAvailability: LoadSatelliteAvailability | null;
  readonly satelliteCatalogGateway: SatelliteCatalogGateway | null;
  readonly searchSatelliteScenes: SearchSatelliteScenes | null;
  readonly searchPlaces: SearchPlaces | null;
  readonly sentinelQueryDiagnostics: SentinelQueryDiagnosticsStore;
  readonly storageUsage: StorageUsageReader;
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
  const storageUsage = new BrowserStorageUsageReader();
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
        satelliteId: summary.satelliteId,
        satelliteOrigin: summary.satelliteOrigin,
        satelliteRendererId: summary.satelliteRendererId,
        satelliteRendererOrigin: summary.satelliteRendererOrigin,
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
  const mapViewport = new MapViewportSnapshotStore();
  const sentinelQueryDiagnostics = new SentinelQueryDiagnosticsStore(clock);
  const mapLayers =
    mapProviderConfiguration.status === 'valid'
      ? new MapLibreLayerController(
          mapProviderConfiguration.value.satellite.renderer,
          mapProviderConfiguration.value.terrain,
          new MapLibreContourTileGenerator(
            mapProviderConfiguration.value.terrain,
            mapProviderConfiguration.value.policy.requestTimeoutMs,
            logger,
          ),
          logger,
          idGenerator,
          sentinelQueryDiagnostics,
          mapProviderConfiguration.value.policy.requestTimeoutMs,
          database,
        )
      : null;
  const httpClient = createHttpClient(logger, clock, idGenerator);
  const elevationProvider =
    mapProviderConfiguration.status === 'valid'
      ? new RasterDemElevationProvider(
          httpClient,
          mapProviderConfiguration.value.terrain,
          idGenerator,
        )
      : null;
  const geocodingConfiguration = loadGeocodingProviderConfiguration(
    import.meta.env.VITE_GEOCODING_PROVIDER_CONFIGURATION,
  );
  const searchPlaces =
    geocodingConfiguration.status === 'valid'
      ? new SearchPlaces(
          new NominatimPlaceSearchGateway(
            httpClient,
            geocodingConfiguration.value,
            idGenerator,
          ),
          logger,
          idGenerator,
          clock,
        )
      : null;
  if (searchPlaces === null) {
    logger.log({ level: 'warn', name: 'place-search.configuration.invalid' });
  }
  const satelliteCatalogGateway =
    mapProviderConfiguration.status === 'valid'
      ? new EarthSearchSatelliteCatalogGateway(
          httpClient,
          mapProviderConfiguration.value.satellite,
          mapProviderConfiguration.value.policy.requestTimeoutMs,
          sentinelQueryDiagnostics,
          logger,
          clock,
        )
      : null;
  const searchSatelliteScenes =
    satelliteCatalogGateway === null
      ? null
      : new SearchSatelliteScenes(
          satelliteCatalogGateway,
          sentinelQueryDiagnostics,
          logger,
          idGenerator,
          clock,
        );
  const loadSatelliteAvailability =
    satelliteCatalogGateway === null
      ? null
      : new LoadSatelliteAvailability(
          satelliteCatalogGateway,
          sentinelQueryDiagnostics,
          logger,
          idGenerator,
          clock,
        );
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
    elevationProvider,
    mapCameraRepository,
    mapDiagnostics,
    mapViewport,
    mapLayers,
    mapProviderConfiguration,
    queryClient,
    loadSatelliteAvailability,
    satelliteCatalogGateway,
    searchSatelliteScenes,
    searchPlaces,
    sentinelQueryDiagnostics,
    storageUsage,
  };
}
