import { describe, expect, it, vi } from 'vitest';

import { GetPointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import type {
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import type { ElevationProvider } from '@/application/ports/ElevationProvider';
import type { ElevationCoordinate } from '@/application/ports/ElevationProvider';
import type {
  WeatherForecastData,
  WeatherForecastGateway,
  WeatherModel,
} from '@/application/ports/WeatherForecastGateway';

const selectedCoordinate = { longitude: 44.8271, latitude: 41.7151 } as const;

function localTimestamp(day: number, hour: number): string {
  return `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`;
}

function forecastData(
  options: {
    readonly timezone?: string;
    readonly timezoneAbbreviation?: string;
    readonly utcOffsetSeconds?: number;
    readonly model?: WeatherModel;
    readonly coordinate?: ElevationCoordinate;
  } = {},
): WeatherForecastData {
  const hourly = Array.from({ length: 7 * 24 }, (_, index) => {
    const day = 18 + Math.floor(index / 24);
    const hour = index % 24;
    const isDay = hour >= 6 && hour < 20;
    return {
      time: localTimestamp(day, hour),
      temperatureCelsius: isDay ? 10 + (hour - 6) / 2 : hour === 2 ? -40 : 5,
      apparentTemperatureCelsius: 10,
      precipitationMm: isDay && hour === 12 ? 1 : hour === 2 ? 20 : 0,
      rainMm: isDay && hour === 12 ? 1 : hour === 2 ? 20 : 0,
      showersMm: 0,
      snowfallCm: 0,
      precipitationType: isDay && hour === 12 ? 1 : 0,
      weatherCode: 1,
      cloudCoverPercent: 30,
      visibilityMeters: 20_000,
      windSpeedKmh: isDay ? 5 + (hour - 6) : hour === 2 ? 150 : 2,
      windDirectionDegrees: 180,
      windGustsKmh: 20,
      isDay,
    };
  });
  const first = hourly[0];
  if (first === undefined) throw new Error('Fixture requires an hourly row.');
  return {
    requestedCoordinate: options.coordinate ?? selectedCoordinate,
    resolvedCoordinate: { longitude: 44.83, latitude: 41.72 },
    elevationMeters: 590,
    timezone: options.timezone ?? 'Asia/Tbilisi',
    timezoneAbbreviation: options.timezoneAbbreviation ?? 'GMT+4',
    utcOffsetSeconds: options.utcOffsetSeconds ?? 14_400,
    model: options.model ?? 'ecmwf_ifs',
    modelRunAt: '2026-07-18T00:00:00.000Z',
    fetchedAt: '2026-07-18T00:01:00.000Z',
    current: {
      time: first.time,
      temperatureCelsius: first.temperatureCelsius,
      apparentTemperatureCelsius: first.apparentTemperatureCelsius,
      precipitationMm: first.precipitationMm,
      rainMm: first.rainMm,
      showersMm: first.showersMm,
      snowfallCm: first.snowfallCm,
      weatherCode: first.weatherCode,
      cloudCoverPercent: first.cloudCoverPercent,
      visibilityMeters: first.visibilityMeters,
      windSpeedKmh: first.windSpeedKmh,
      windDirectionDegrees: first.windDirectionDegrees,
      windGustsKmh: first.windGustsKmh,
      isDay: first.isDay,
    },
    hourly,
  };
}

function createUseCase(
  gateway: WeatherForecastGateway,
  elevationProvider: ElevationProvider | null,
  logger: DiagnosticLogger = { log: vi.fn(), getEvents: () => [] },
): GetPointWeatherForecast {
  let monotonic = 0;
  return new GetPointWeatherForecast(
    gateway,
    elevationProvider,
    logger,
    { generate: () => 'weather-operation' },
    {
      now: () => new Date('2026-07-18T00:01:00.000Z'),
      monotonicNow: () => {
        monotonic += 5;
        return monotonic;
      },
    },
  );
}

describe('GetPointWeatherForecast', () => {
  it('forwards finite local DEM elevation and identifies its source', async () => {
    const fetch = vi
      .fn<WeatherForecastGateway['fetch']>()
      .mockResolvedValue(forecastData());
    const sample = vi.fn<ElevationProvider['sample']>().mockResolvedValue({
      status: 'available',
      meters: 1_234.4,
    });

    const result = await createUseCase(
      { fetch },
      { sample, sampleMany: vi.fn() },
    ).execute({ coordinate: selectedCoordinate }, new AbortController().signal);

    expect(fetch).toHaveBeenCalledWith(
      {
        coordinate: selectedCoordinate,
        elevationMeters: 1_234.4,
        model: 'ecmwf_ifs',
      },
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      selectedCoordinate,
      forecastCoordinate: { longitude: 44.83, latitude: 41.72 },
      elevationMeters: 1_234.4,
      elevationSource: 'trail-planner-dem',
    });
  });

  it.each([
    {
      name: 'missing provider',
      elevationProvider: null,
    },
    {
      name: 'unavailable sample',
      elevationProvider: {
        sample: vi.fn().mockResolvedValue({ status: 'unavailable' }),
        sampleMany: vi.fn(),
      } satisfies ElevationProvider,
    },
    {
      name: 'non-abort sampling failure',
      elevationProvider: {
        sample: vi.fn().mockRejectedValue(new Error('DEM unavailable')),
        sampleMany: vi.fn(),
      } satisfies ElevationProvider,
    },
  ])('uses Open-Meteo terrain after $name', async ({ elevationProvider }) => {
    const fetch = vi
      .fn<WeatherForecastGateway['fetch']>()
      .mockResolvedValue(forecastData());

    const result = await createUseCase({ fetch }, elevationProvider).execute(
      { coordinate: selectedCoordinate },
      new AbortController().signal,
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ elevationMeters: null }),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      elevationMeters: 590,
      elevationSource: 'open-meteo-dem',
    });
  });

  it('groups seven provider-local days and excludes every night extreme', async () => {
    const data = forecastData();
    const result = await createUseCase(
      { fetch: vi.fn().mockResolvedValue(data) },
      null,
    ).execute({ coordinate: selectedCoordinate }, new AbortController().signal);

    expect(result.days).toHaveLength(7);
    expect(result.days.map((day) => day.date)).toEqual([
      '2026-07-18',
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
    ]);
    expect(result.days[0]).toMatchObject({
      daylightTemperatureMinCelsius: 10,
      daylightTemperatureMaxCelsius: 16.5,
      daylightWindSpeedMinKmh: 5,
      daylightWindSpeedMaxKmh: 18,
      daylightPrecipitationMm: 1,
      status: {
        precipitation: 'rain',
        debug: { daylightHours: 14, precipTotal: 1 },
      },
    });
    expect(result.days[0]?.daylightTemperatureMinCelsius).not.toBe(-40);
    expect(result.days[0]?.daylightWindSpeedMaxKmh).not.toBe(150);
    expect(result.days[0]?.daylightPrecipitationMm).not.toBe(21);
  });

  it('preserves the selected location time-zone metadata for independent points', async () => {
    const fetch = vi.fn<WeatherForecastGateway['fetch']>().mockImplementation((input) =>
      Promise.resolve(
        input.coordinate.longitude < 0
          ? forecastData({
              coordinate: { longitude: -74.006, latitude: 40.7128 },
              timezone: 'America/New_York',
              timezoneAbbreviation: 'GMT-4',
              utcOffsetSeconds: -14_400,
            })
          : forecastData(),
      ),
    );
    const useCase = createUseCase({ fetch }, null);

    const [tbilisi, newYork] = await Promise.all([
      useCase.execute({ coordinate: selectedCoordinate }, new AbortController().signal),
      useCase.execute(
        { coordinate: { longitude: -74.006, latitude: 40.7128 } },
        new AbortController().signal,
      ),
    ]);

    expect(tbilisi).toMatchObject({
      timezone: 'Asia/Tbilisi',
      timezoneAbbreviation: 'GMT+4',
      utcOffsetSeconds: 14_400,
    });
    expect(newYork).toMatchObject({
      timezone: 'America/New_York',
      timezoneAbbreviation: 'GMT-4',
      utcOffsetSeconds: -14_400,
    });
  });

  it('forwards the default and explicit model as application inputs', async () => {
    const fetch = vi
      .fn<WeatherForecastGateway['fetch']>()
      .mockResolvedValue(forecastData());
    const useCase = createUseCase({ fetch }, null);

    await useCase.execute(
      { coordinate: selectedCoordinate },
      new AbortController().signal,
    );
    await useCase.execute(
      { coordinate: selectedCoordinate, model: 'ecmwf_ifs' },
      new AbortController().signal,
    );

    expect(fetch.mock.calls.map(([input]) => input.model)).toEqual([
      'ecmwf_ifs',
      'ecmwf_ifs',
    ]);
  });

  it('keeps request cancellation under each caller signal', async () => {
    const fetch = vi
      .fn<WeatherForecastGateway['fetch']>()
      .mockImplementation((input, signal) => {
        if (input.coordinate.longitude < 0) return Promise.resolve(forecastData());
        return new Promise<WeatherForecastData>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('cancelled', 'AbortError'));
            },
            { once: true },
          );
        });
      });
    const useCase = createUseCase({ fetch }, null);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = useCase.execute(
      { coordinate: selectedCoordinate },
      firstController.signal,
    );
    const second = useCase.execute(
      { coordinate: { longitude: -74.006, latitude: 40.7128 } },
      secondController.signal,
    );
    firstController.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ timezone: 'Asia/Tbilisi' });
    expect(secondController.signal.aborted).toBe(false);
  });

  it('rejects invalid coordinates before elevation or provider work', async () => {
    const sample = vi.fn();
    const fetch = vi.fn();

    await expect(
      createUseCase({ fetch }, { sample, sampleMany: vi.fn() }).execute(
        { coordinate: { longitude: 181, latitude: 0 } },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-request' });

    expect(sample).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('logs bounded operation metadata without coordinates or elevations', async () => {
    const log = vi.fn((input: DiagnosticInput): void => {
      void input;
    });
    const logger = { log, getEvents: () => [] } satisfies DiagnosticLogger;

    await createUseCase(
      { fetch: vi.fn().mockResolvedValue(forecastData()) },
      null,
      logger,
    ).execute({ coordinate: selectedCoordinate }, new AbortController().signal);

    const completedEvent = log.mock.calls
      .map(([input]) => input)
      .find((input) => input.name === 'weather.forecast.completed');
    expect(completedEvent?.data).toMatchObject({
      operationId: 'weather-operation',
      model: 'ecmwf_ifs',
      hourlyCount: 168,
      dayCount: 7,
      elevationSource: 'open-meteo-dem',
      modelUpdateAvailable: true,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('44.8271');
    expect(JSON.stringify(log.mock.calls)).not.toContain('590');
  });
});
