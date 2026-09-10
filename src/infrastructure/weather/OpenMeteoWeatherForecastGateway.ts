import { HTTPError, TimeoutError, type KyInstance } from 'ky';
import { z } from 'zod';

import type { Clock } from '@/application/ports/Clock';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import {
  PointWeatherForecastError,
  type CurrentWeatherForecast,
  type HourlyWeatherForecast,
  type WeatherForecastData,
  type WeatherForecastGateway,
  type WeatherModel,
} from '@/application/ports/WeatherForecastGateway';
import type { WeatherProviderConfiguration } from '@/bootstrap/configuration/WeatherProviderConfiguration';

const currentVariables = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'is_day',
] as const;

const hourlyVariables = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'precipitation_type',
  'weather_code',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'is_day',
] as const;

const localTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

function isLocationLocalTimestamp(value: string): boolean {
  const match = localTimestampPattern.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return false;
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return (
    timestamp.getUTCFullYear() === year &&
    timestamp.getUTCMonth() === month - 1 &&
    timestamp.getUTCDate() === day &&
    timestamp.getUTCHours() === hour &&
    timestamp.getUTCMinutes() === minute
  );
}

const localTimestampSchema = z.string().refine(isLocationLocalTimestamp);
const finiteNumberArray = z.array(z.number());
const isDayArray = z.array(z.union([z.literal(0), z.literal(1)]));

const currentSchema = z
  .object({
    time: localTimestampSchema,
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    precipitation: z.number(),
    rain: z.number(),
    showers: z.number(),
    snowfall: z.number(),
    weather_code: z.number().int(),
    cloud_cover: z.number(),
    visibility: z.number(),
    wind_speed_10m: z.number(),
    wind_direction_10m: z.number(),
    wind_gusts_10m: z.number(),
    is_day: z.union([z.literal(0), z.literal(1)]),
  })
  .loose();

const hourlySchema = z
  .object({
    time: z.array(localTimestampSchema),
    temperature_2m: finiteNumberArray,
    apparent_temperature: finiteNumberArray,
    precipitation: finiteNumberArray,
    rain: finiteNumberArray,
    showers: finiteNumberArray,
    snowfall: finiteNumberArray,
    precipitation_type: z.array(z.number().int().nullable()),
    weather_code: z.array(z.number().int()),
    cloud_cover: finiteNumberArray,
    visibility: finiteNumberArray,
    wind_speed_10m: finiteNumberArray,
    wind_direction_10m: finiteNumberArray,
    wind_gusts_10m: finiteNumberArray,
    is_day: isDayArray,
  })
  .loose();

const forecastUnitsSchema = z
  .object({
    time: z.literal('iso8601'),
    temperature_2m: z.literal('°C'),
    apparent_temperature: z.literal('°C'),
    precipitation: z.literal('mm'),
    rain: z.literal('mm'),
    showers: z.literal('mm'),
    snowfall: z.literal('cm'),
    weather_code: z.literal('wmo code'),
    cloud_cover: z.literal('%'),
    visibility: z.literal('m'),
    wind_speed_10m: z.literal('km/h'),
    wind_direction_10m: z.literal('°'),
    wind_gusts_10m: z.literal('km/h'),
    is_day: z.literal(''),
  })
  .loose();

const hourlyUnitsSchema = forecastUnitsSchema.extend({
  precipitation_type: z.literal(''),
});

const forecastSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    elevation: z.number(),
    utc_offset_seconds: z.number().int().min(-50_400).max(50_400),
    timezone: z.string().trim().min(1),
    timezone_abbreviation: z.string().trim().min(1),
    current_units: forecastUnitsSchema,
    current: currentSchema,
    hourly_units: hourlyUnitsSchema,
    hourly: hourlySchema,
  })
  .loose();

const metadataSchema = z
  .object({ last_run_initialisation_time: z.number().int().nonnegative() })
  .loose();

type ForecastResponse = z.infer<typeof forecastSchema>;

interface MetadataCacheEntry {
  readonly modelRunAt: string;
  readonly expiresAt: number;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function isSupportedTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function invalidResponse(message: string): PointWeatherForecastError {
  return new PointWeatherForecastError('invalid-response', message);
}

function hourlyValueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw invalidResponse('Open-Meteo returned mismatched hourly arrays.');
  }
  return value;
}

function validateHourlyShape(response: ForecastResponse): void {
  const length = response.hourly.time.length;
  for (const field of hourlyVariables) {
    if (response.hourly[field].length !== length) {
      throw invalidResponse('Open-Meteo returned mismatched hourly arrays.');
    }
  }
  const localDates = new Set(response.hourly.time.map((time) => time.slice(0, 10)));
  if (localDates.size !== 8) {
    throw invalidResponse('Open-Meteo did not return eight local forecast days.');
  }
  const futureSlots = response.hourly.time.filter(
    (time) => time >= response.current.time,
  ).length;
  if (futureSlots < 24) {
    throw invalidResponse('Open-Meteo returned fewer than 24 current forecast slots.');
  }
}

function normalizeCurrent(response: ForecastResponse): CurrentWeatherForecast {
  const current = response.current;
  return {
    time: current.time,
    temperatureCelsius: current.temperature_2m,
    apparentTemperatureCelsius: current.apparent_temperature,
    precipitationMm: current.precipitation,
    rainMm: current.rain,
    showersMm: current.showers,
    snowfallCm: current.snowfall,
    weatherCode: current.weather_code,
    cloudCoverPercent: current.cloud_cover,
    visibilityMeters: current.visibility,
    windSpeedKmh: current.wind_speed_10m,
    windDirectionDegrees: current.wind_direction_10m,
    windGustsKmh: current.wind_gusts_10m,
    isDay: current.is_day === 1,
  };
}

function derivePrecipitationType(
  providerType: number | null,
  precipitationMm: number,
  rainMm: number,
  showersMm: number,
  snowfallCm: number,
  weatherCode: number,
): number {
  if (providerType !== null) return providerType;
  if (precipitationMm < 0.1) return 0;
  if (
    weatherCode === 56 ||
    weatherCode === 57 ||
    weatherCode === 66 ||
    weatherCode === 67
  ) {
    return weatherCode === 56 || weatherCode === 57 ? 12 : 3;
  }
  if (snowfallCm > 0 && (rainMm > 0 || showersMm > 0)) return 7;
  if (
    snowfallCm > 0 ||
    weatherCode === 71 ||
    weatherCode === 73 ||
    weatherCode === 75 ||
    weatherCode === 77 ||
    weatherCode === 85 ||
    weatherCode === 86
  ) {
    return 5;
  }
  return rainMm > 0 || showersMm > 0 ? 1 : 0;
}

function normalizeHourly(response: ForecastResponse): readonly HourlyWeatherForecast[] {
  return response.hourly.time.map((time, index) => {
    const precipitationMm = hourlyValueAt(response.hourly.precipitation, index);
    const rainMm = hourlyValueAt(response.hourly.rain, index);
    const showersMm = hourlyValueAt(response.hourly.showers, index);
    const snowfallCm = hourlyValueAt(response.hourly.snowfall, index);
    const weatherCode = hourlyValueAt(response.hourly.weather_code, index);
    return {
      time,
      temperatureCelsius: hourlyValueAt(response.hourly.temperature_2m, index),
      apparentTemperatureCelsius: hourlyValueAt(
        response.hourly.apparent_temperature,
        index,
      ),
      precipitationMm,
      rainMm,
      showersMm,
      snowfallCm,
      precipitationType: derivePrecipitationType(
        hourlyValueAt(response.hourly.precipitation_type, index),
        precipitationMm,
        rainMm,
        showersMm,
        snowfallCm,
        weatherCode,
      ),
      weatherCode,
      cloudCoverPercent: hourlyValueAt(response.hourly.cloud_cover, index),
      visibilityMeters: hourlyValueAt(response.hourly.visibility, index),
      windSpeedKmh: hourlyValueAt(response.hourly.wind_speed_10m, index),
      windDirectionDegrees: hourlyValueAt(response.hourly.wind_direction_10m, index),
      windGustsKmh: hourlyValueAt(response.hourly.wind_gusts_10m, index),
      isDay: hourlyValueAt(response.hourly.is_day, index) === 1,
    };
  });
}

function mapTransportError(error: unknown): PointWeatherForecastError {
  if (error instanceof PointWeatherForecastError) return error;
  if (error instanceof TimeoutError) {
    return new PointWeatherForecastError(
      'provider-timeout',
      'Open-Meteo did not respond before the forecast request deadline.',
    );
  }
  if (error instanceof HTTPError) {
    if (error.response.status === 429) {
      return new PointWeatherForecastError(
        'provider-rate-limited',
        'Open-Meteo is rate limiting forecast requests.',
      );
    }
    if (error.response.status >= 500) {
      return new PointWeatherForecastError(
        'provider-unavailable',
        'Open-Meteo returned an unavailable response.',
      );
    }
    return new PointWeatherForecastError(
      'invalid-request',
      'Open-Meteo rejected the forecast request.',
    );
  }
  if (error instanceof z.ZodError) {
    return invalidResponse('Open-Meteo returned an unsupported forecast response.');
  }
  return new PointWeatherForecastError(
    'provider-unavailable',
    'Open-Meteo could not be reached from this browser.',
  );
}

/** Open-Meteo adapter for one explicit ECMWF point-model request. */
export class OpenMeteoWeatherForecastGateway implements WeatherForecastGateway {
  readonly #metadataCache = new Map<WeatherModel, MetadataCacheEntry>();

  public constructor(
    private readonly httpClient: KyInstance,
    private readonly configuration: WeatherProviderConfiguration,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  public async fetch(
    input: {
      readonly coordinate: { readonly longitude: number; readonly latitude: number };
      readonly elevationMeters: number | null;
      readonly model: WeatherModel;
    },
    signal: AbortSignal,
  ): Promise<WeatherForecastData> {
    if (
      !Number.isFinite(input.coordinate.latitude) ||
      input.coordinate.latitude < -90 ||
      input.coordinate.latitude > 90 ||
      !Number.isFinite(input.coordinate.longitude) ||
      input.coordinate.longitude < -180 ||
      input.coordinate.longitude > 180 ||
      (input.elevationMeters !== null && !Number.isFinite(input.elevationMeters))
    ) {
      throw new PointWeatherForecastError(
        'invalid-request',
        'The point forecast request is invalid.',
      );
    }

    const model = this.configuration.models[input.model];
    const operationId = this.idGenerator.generate();
    const searchParams = new URLSearchParams({
      latitude: input.coordinate.latitude.toFixed(5),
      longitude: input.coordinate.longitude.toFixed(5),
      models: model.requestIdentifier,
      timezone: 'auto',
      forecast_days: '8',
      timeformat: 'iso8601',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm',
      current: currentVariables.join(','),
      hourly: hourlyVariables.join(','),
    });
    if (input.elevationMeters !== null) {
      searchParams.set('elevation', input.elevationMeters.toFixed(1));
    }

    try {
      const forecastRequest = this.httpClient
        .get(this.configuration.forecastUrl, {
          cache: 'no-store',
          context: { operationId },
          retry: 0,
          searchParams,
          signal,
          timeout: this.configuration.requestTimeoutMs,
        })
        .json<unknown>();
      const metadataRequest = this.fetchModelRunAt(input.model, signal, operationId);
      const [rawForecast, modelRunAt] = await Promise.all([
        forecastRequest,
        metadataRequest,
      ]);
      signal.throwIfAborted();
      const response = forecastSchema.parse(rawForecast);
      if (!isSupportedTimezone(response.timezone)) {
        throw invalidResponse('Open-Meteo returned an unsupported time zone.');
      }
      validateHourlyShape(response);
      return {
        requestedCoordinate: { ...input.coordinate },
        resolvedCoordinate: {
          longitude: response.longitude,
          latitude: response.latitude,
        },
        elevationMeters: response.elevation,
        timezone: response.timezone,
        timezoneAbbreviation: response.timezone_abbreviation,
        utcOffsetSeconds: response.utc_offset_seconds,
        model: input.model,
        modelRunAt,
        fetchedAt: this.clock.now().toISOString(),
        current: normalizeCurrent(response),
        hourly: normalizeHourly(response),
      };
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw error;
      throw mapTransportError(error);
    }
  }

  private async fetchModelRunAt(
    model: WeatherModel,
    signal: AbortSignal,
    operationId: string,
  ): Promise<string | null> {
    const cached = this.#metadataCache.get(model);
    const now = this.clock.now().getTime();
    if (cached !== undefined && cached.expiresAt > now) return cached.modelRunAt;

    try {
      const raw = await this.httpClient
        .get(this.configuration.models[model].metadataUrl, {
          cache: 'no-store',
          context: { operationId },
          retry: 0,
          signal,
          timeout: this.configuration.requestTimeoutMs,
        })
        .json<unknown>();
      const metadata = metadataSchema.parse(raw);
      const modelRunAt = new Date(
        metadata.last_run_initialisation_time * 1_000,
      ).toISOString();
      this.#metadataCache.set(model, {
        modelRunAt,
        expiresAt: now + this.configuration.metadataTtlMs,
      });
      return modelRunAt;
    } catch {
      return null;
    }
  }
}
