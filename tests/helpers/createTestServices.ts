import type { KyInstance } from 'ky';

import { createUnconfiguredUserDataService } from '@/application/user/UserDataService';
import type { UserDataService } from '@/application/user/UserDataService';
import type { Clock } from '@/application/ports/Clock';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type { TrailRouter } from '@/application/ports/TrailRouter';
import type { ElevationProvider } from '@/application/ports/ElevationProvider';
import type { WeatherForecastGateway } from '@/application/ports/WeatherForecastGateway';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { defaultGeocodingProviderConfiguration } from '@/bootstrap/configuration/GeocodingProviderConfiguration';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import type { SatelliteCatalogGateway } from '@/application/ports/SatelliteCatalogGateway';
import type { TrackShareService } from '@/application/tracks/TrackShareService';
import { SearchPlaces } from '@/application/map/SearchPlaces';
import { GetPointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import { SearchSatelliteMosaic } from '@/application/satellite/SearchSatelliteMosaic';
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
import { WebCryptoTrackContentHasher } from '@/infrastructure/runtime/WebCryptoTrackContentHasher';
import { MapViewportSnapshotStore } from '@/presentation/map/MapViewportSnapshotStore';
import { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import type { ContourTileGenerator } from '@/presentation/map/ContourTileGenerator';
import type { SatelliteCogTileProvider } from '@/presentation/map/SatelliteCogTileProvider';

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
    return `00000000-0000-4000-8000-${String(this.#nextId).padStart(12, '0')}`;
  }
}

const testElevationProvider: ElevationProvider = {
  sample: () => Promise.resolve({ status: 'available', meters: 1_234 }),
  sampleMany: (coordinates) =>
    Promise.resolve(coordinates.map(() => ({ status: 'unavailable' as const }))),
};

function createTestWeatherForecastGateway(clock: Clock): WeatherForecastGateway {
  return {
    fetch: (input) => {
      const hourly = Array.from({ length: 7 * 24 }, (_, index) => {
        const day = Math.floor(index / 24) + 18;
        const hour = index % 24;
        return {
          time: `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`,
          temperatureCelsius: 20,
          apparentTemperatureCelsius: 20,
          precipitationMm: 0,
          rainMm: 0,
          showersMm: 0,
          snowfallCm: 0,
          precipitationType: 0,
          weatherCode: 0,
          cloudCoverPercent: 10,
          visibilityMeters: 20_000,
          windSpeedKmh: 10,
          windDirectionDegrees: 180,
          windGustsKmh: 15,
          isDay: hour >= 6 && hour < 20,
        };
      });
      const current = hourly[0];
      if (current === undefined) throw new Error('Test forecast requires hourly data.');
      return Promise.resolve({
        requestedCoordinate: { ...input.coordinate },
        resolvedCoordinate: { ...input.coordinate },
        elevationMeters: input.elevationMeters ?? 500,
        timezone: 'Asia/Tbilisi',
        timezoneAbbreviation: 'GMT+4',
        utcOffsetSeconds: 14_400,
        model: input.model,
        modelRunAt: '2026-07-18T00:00:00.000Z',
        fetchedAt: clock.now().toISOString(),
        current: {
          time: current.time,
          temperatureCelsius: current.temperatureCelsius,
          apparentTemperatureCelsius: current.apparentTemperatureCelsius,
          precipitationMm: current.precipitationMm,
          rainMm: current.rainMm,
          showersMm: current.showersMm,
          snowfallCm: current.snowfallCm,
          weatherCode: current.weatherCode,
          cloudCoverPercent: current.cloudCoverPercent,
          visibilityMeters: current.visibilityMeters,
          windSpeedKmh: current.windSpeedKmh,
          windDirectionDegrees: current.windDirectionDegrees,
          windGustsKmh: current.windGustsKmh,
          isDay: current.isDay,
        },
        hourly,
      });
    },
  };
}

interface CreateTestServicesOptions {
  readonly satelliteCatalogGateway?: SatelliteCatalogGateway;
  readonly trackShares?: TrackShareService | null;
  readonly userData?: UserDataService;
  readonly trailRouter?: TrailRouter | null;
  readonly pointWeatherForecast?: GetPointWeatherForecast;
}

export function createTestServices(
  options: CreateTestServicesOptions = {},
): RuntimeServices & { readonly httpClient: KyInstance } {
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
  const userData = options.userData ?? createUnconfiguredUserDataService();
  const trailRouter = options.trailRouter ?? null;
  const httpClient = createHttpClient(logger, clock, idGenerator);
  const pointWeatherForecast =
    options.pointWeatherForecast ??
    new GetPointWeatherForecast(
      createTestWeatherForecastGateway(clock),
      testElevationProvider,
      logger,
      idGenerator,
      clock,
    );
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
  let demFilterEnabled = true;
  let demFilterRevision = 0;
  const registeredSatelliteScenes = new Set<string>();
  const mapLayers = new MapLibreLayerController(
    parsedMapProviderConfiguration.satellite.renderer,
    parsedMapProviderConfiguration.terrain,
    {
      createDemTileUrl: () =>
        `test-dem://tiles/{z}/{x}/{y}?filter=${demFilterEnabled ? 'on' : 'off'}&revision=${String(demFilterRevision)}`,
      createTileUrl: (intervalMeters) =>
        `test-contour://tiles/{z}/{x}/{y}?minor=${String(intervalMeters)}&major=200&filter=${demFilterEnabled ? 'on' : 'off'}&revision=${String(demFilterRevision)}`,
      setFilterEnabled: (enabled) => {
        if (demFilterEnabled === enabled) return;
        demFilterEnabled = enabled;
        demFilterRevision += 1;
      },
      setInteractionActive: () => undefined,
      getStatus: () => 'worker',
      getQueueState: () => ({
        executionMode: 'worker',
        activeCount: 0,
        queuedContourCount: 0,
        queueCapacity: 32,
      }),
      subscribeStatus: () => () => undefined,
      subscribeQueueState: () => () => undefined,
      subscribeMetrics: () => () => undefined,
      dispose: () => undefined,
    } satisfies ContourTileGenerator,
    {
      registerScene: (sceneKey) => {
        registeredSatelliteScenes.add(sceneKey);
      },
      createTileUrl: (sceneKey) => {
        if (!registeredSatelliteScenes.has(sceneKey)) {
          throw new Error('The direct satellite scene is not registered.');
        }
        return `test-satellite-cog://tiles/${encodeURIComponent(sceneKey)}/{z}/{x}/{y}.webp`;
      },
      dispose: () => undefined,
    } satisfies SatelliteCogTileProvider,
    logger,
    idGenerator,
    sentinelQueryDiagnostics,
    database,
  );
  const searchSatelliteScenes = new SearchSatelliteScenes(
    satelliteCatalogGateway,
    sentinelQueryDiagnostics,
    logger,
    idGenerator,
    clock,
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
    dispose: () => {
      trailRouter?.dispose();
      mapLayers.dispose();
      database.close();
      userData.dispose();
    },
    httpClient,
    trailRouter,
    trackContentHasher: new WebCryptoTrackContentHasher(),
    idGenerator,
    logger,
    elevationProvider: testElevationProvider,
    pointWeatherForecast,
    geocodingProviderConfiguration: {
      status: 'valid',
      value: defaultGeocodingProviderConfiguration,
    },
    mapCameraRepository: database,
    mapDiagnostics,
    mapViewport,
    mapLayers,
    savedMarkers: database,
    mapProviderConfiguration: {
      status: 'valid',
      value: parsedMapProviderConfiguration,
    },
    satelliteCatalogGateway,
    searchSatelliteScenes,
    searchSatelliteMosaic: new SearchSatelliteMosaic(searchSatelliteScenes),
    searchPlaces: new SearchPlaces(
      { search: () => Promise.resolve([]) },
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
    supabaseConfiguration: { status: 'unconfigured' },
    trackShares: options.trackShares ?? null,
    userData,
  };
}
