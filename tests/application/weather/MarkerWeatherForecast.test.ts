import { describe, expect, it, vi } from 'vitest';

import { GetPointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import {
  defaultWeatherIntervalPreferences,
  selectMarkerWeatherForecast,
  type WeatherIntervalPreferences,
} from '@/application/weather/MarkerWeatherForecast';
import type {
  HourlyWeatherForecast,
  WeatherForecastData,
  WeatherForecastGateway,
} from '@/application/ports/WeatherForecastGateway';

function timestamp(day: number, hour: number): string {
  return `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`;
}

function forecastData(): WeatherForecastData {
  const hourly: HourlyWeatherForecast[] = Array.from({ length: 8 * 24 }, (_, index) => {
    const day = 18 + Math.floor(index / 24);
    const hour = index % 24;
    return {
      time: timestamp(day, hour),
      temperatureCelsius: hour,
      apparentTemperatureCelsius: hour,
      precipitationMm: 1,
      rainMm: 1,
      showersMm: 0,
      snowfallCm: 0,
      precipitationType: 1,
      weatherCode: 61,
      cloudCoverPercent: 70,
      visibilityMeters: 20_000,
      windSpeedKmh: 10,
      windGustsKmh: 20,
      isDay: hour >= 6 && hour < 20,
    };
  });
  const current = hourly[0];
  if (current === undefined)
    throw new Error('Forecast fixture requires hourly values.');
  return {
    requestedCoordinate: { longitude: 44.8, latitude: 41.7 },
    resolvedCoordinate: { longitude: 44.8, latitude: 41.7 },
    elevationMeters: 500,
    timezone: 'Asia/Tbilisi',
    timezoneAbbreviation: 'GMT+4',
    utcOffsetSeconds: 14_400,
    model: 'ecmwf_ifs',
    modelRunAt: null,
    fetchedAt: '2026-07-18T00:00:00.000Z',
    current,
    hourly,
  };
}

async function pointForecast() {
  const gateway: WeatherForecastGateway = {
    fetch: vi.fn().mockResolvedValue(forecastData()),
  };
  return await new GetPointWeatherForecast(
    gateway,
    null,
    { log: vi.fn(), getEvents: () => [] },
    { generate: () => 'marker-weather' },
    { now: () => new Date(), monotonicNow: () => 0 },
  ).execute(
    { coordinate: { longitude: 44.8, latitude: 41.7 } },
    new AbortController().signal,
  );
}

describe('selectMarkerWeatherForecast', () => {
  it('returns one daylight summary per weekday in preference order', async () => {
    const selected = selectMarkerWeatherForecast(await pointForecast(), {
      ...defaultWeatherIntervalPreferences,
      weekdays: [0, 6],
    });

    expect(selected).toMatchObject({
      periods: [
        {
          date: '2026-07-19',
          isDay: true,
          period: {
            temperatureMinCelsius: 6,
            temperatureMaxCelsius: 19,
            precipitationMm: 14,
            status: { debug: { periodHours: 14 } },
          },
        },
        {
          date: '2026-07-18',
          isDay: true,
          period: {
            temperatureMinCelsius: 6,
            temperatureMaxCelsius: 19,
            precipitationMm: 14,
            status: { debug: { periodHours: 14 } },
          },
        },
      ],
    });
  });

  it('uses the Weather tab night boundary and supports custom intervals across midnight', async () => {
    const forecast = await pointForecast();
    const night = selectMarkerWeatherForecast(forecast, {
      weekdays: [6],
      period: { kind: 'night' },
      showOnMap: true,
    });
    const customPreferences: WeatherIntervalPreferences = {
      weekdays: [6],
      period: { kind: 'custom', startHour: 20, endHour: 3 },
      showOnMap: false,
    };
    const custom = selectMarkerWeatherForecast(forecast, customPreferences);

    expect(night?.periods[0]?.period).toMatchObject({
      temperatureMinCelsius: 0,
      temperatureMaxCelsius: 23,
      precipitationMm: 10,
      status: { debug: { periodHours: 10 } },
    });
    expect(custom?.periods[0]?.period).toMatchObject({
      temperatureMinCelsius: 0,
      temperatureMaxCelsius: 23,
      precipitationMm: 7,
      status: { debug: { periodHours: 7 } },
    });
  });

  it('disables marker forecasts when every weekday is cleared', async () => {
    expect(
      selectMarkerWeatherForecast(await pointForecast(), {
        ...defaultWeatherIntervalPreferences,
        weekdays: [],
      }),
    ).toBeNull();
  });
});
