import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type {
  ElevationCoordinate,
  ElevationProvider,
} from '@/application/ports/ElevationProvider';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import {
  PointWeatherForecastError,
  type CurrentWeatherForecast,
  type HourlyWeatherForecast,
  type WeatherForecastData,
  type WeatherForecastGateway,
  type WeatherModel,
} from '@/application/ports/WeatherForecastGateway';
import {
  aggregateDailyWeatherStatus,
  type DailyWeatherStatus,
} from '@/domain/weather/aggregateDailyWeatherStatus';

export const DEFAULT_WEATHER_MODEL: WeatherModel = 'ecmwf_ifs';

export type ForecastElevationSource = 'trail-planner-dem' | 'open-meteo-dem';

export interface PointWeatherForecastDay {
  readonly date: string;
  readonly daylightTemperatureMinCelsius: number;
  readonly daylightTemperatureMaxCelsius: number;
  readonly daylightWindSpeedMinKmh: number;
  readonly daylightWindSpeedMaxKmh: number;
  readonly daylightPrecipitationMm: number;
  readonly status: DailyWeatherStatus;
}

export interface PointWeatherForecast {
  readonly selectedCoordinate: ElevationCoordinate;
  readonly forecastCoordinate: ElevationCoordinate;
  readonly elevationMeters: number;
  readonly elevationSource: ForecastElevationSource;
  readonly timezone: string;
  readonly timezoneAbbreviation: string;
  readonly utcOffsetSeconds: number;
  readonly model: WeatherModel;
  readonly modelRunAt: string | null;
  readonly fetchedAt: string;
  readonly current: CurrentWeatherForecast;
  readonly hourly: readonly HourlyWeatherForecast[];
  readonly days: readonly PointWeatherForecastDay[];
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function validateCoordinate(coordinate: ElevationCoordinate): void {
  if (
    !Number.isFinite(coordinate.longitude) ||
    coordinate.longitude < -180 ||
    coordinate.longitude > 180 ||
    !Number.isFinite(coordinate.latitude) ||
    coordinate.latitude < -90 ||
    coordinate.latitude > 90
  ) {
    throw new PointWeatherForecastError(
      'invalid-request',
      'The forecast coordinate is outside the supported WGS84 bounds.',
    );
  }
}

function invalidResponse(message: string): PointWeatherForecastError {
  return new PointWeatherForecastError('invalid-response', message);
}

function deriveDays(
  hourly: readonly HourlyWeatherForecast[],
): readonly PointWeatherForecastDay[] {
  const groups = new Map<string, HourlyWeatherForecast[]>();
  for (const hour of hourly) {
    const date = hour.time.slice(0, 10);
    const group = groups.get(date);
    if (group === undefined) groups.set(date, [hour]);
    else group.push(hour);
  }

  if (groups.size !== 7) {
    throw invalidResponse('The forecast does not contain seven local calendar days.');
  }

  const dates = [...groups.keys()];
  if (dates.some((date, index) => index > 0 && date <= (dates[index - 1] as string))) {
    throw invalidResponse('The forecast local calendar days are not ordered.');
  }

  return dates.map((date) => {
    const daylight = (groups.get(date) as HourlyWeatherForecast[]).filter(
      (hour) => hour.isDay,
    );
    if (daylight.length === 0) {
      throw invalidResponse(`The local forecast day ${date} has no daylight hours.`);
    }
    const temperatures = daylight.map((hour) => hour.temperatureCelsius);
    const windSpeeds = daylight.map((hour) => hour.windSpeedKmh);
    const status = aggregateDailyWeatherStatus(daylight);
    return {
      date,
      daylightTemperatureMinCelsius: Math.min(...temperatures),
      daylightTemperatureMaxCelsius: Math.max(...temperatures),
      daylightWindSpeedMinKmh: Math.min(...windSpeeds),
      daylightWindSpeedMaxKmh: Math.max(...windSpeeds),
      daylightPrecipitationMm: status.debug.precipTotal,
      status,
    };
  });
}

function toResult(
  data: WeatherForecastData,
  selectedCoordinate: ElevationCoordinate,
  localElevationMeters: number | null,
): PointWeatherForecast {
  return {
    selectedCoordinate: { ...selectedCoordinate },
    forecastCoordinate: { ...data.resolvedCoordinate },
    elevationMeters: localElevationMeters ?? data.elevationMeters,
    elevationSource:
      localElevationMeters === null ? 'open-meteo-dem' : 'trail-planner-dem',
    timezone: data.timezone,
    timezoneAbbreviation: data.timezoneAbbreviation,
    utcOffsetSeconds: data.utcOffsetSeconds,
    model: data.model,
    modelRunAt: data.modelRunAt,
    fetchedAt: data.fetchedAt,
    current: data.current,
    hourly: data.hourly,
    days: deriveDays(data.hourly),
  };
}

/** Coordinates local terrain sampling with one stateless provider forecast request. */
export class GetPointWeatherForecast {
  public constructor(
    private readonly gateway: WeatherForecastGateway,
    private readonly elevationProvider: ElevationProvider | null,
    private readonly logger: DiagnosticLogger,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  public async execute(
    input: {
      readonly coordinate: ElevationCoordinate;
      readonly model?: WeatherModel;
    },
    signal: AbortSignal,
  ): Promise<PointWeatherForecast> {
    const operationId = this.idGenerator.generate();
    const model = input.model ?? DEFAULT_WEATHER_MODEL;
    const startedAt = this.clock.monotonicNow();
    this.logger.log({
      level: 'info',
      name: 'weather.forecast.started',
      data: { operationId, model },
    });

    try {
      validateCoordinate(input.coordinate);
      signal.throwIfAborted();
      let localElevationMeters: number | null = null;
      if (this.elevationProvider !== null) {
        try {
          const sample = await this.elevationProvider.sample(input.coordinate, signal);
          signal.throwIfAborted();
          if (sample.status === 'available' && Number.isFinite(sample.meters)) {
            localElevationMeters = sample.meters;
          }
        } catch (error) {
          if (signal.aborted || isAbortError(error)) throw error;
        }
      }

      const data = await this.gateway.fetch(
        {
          coordinate: input.coordinate,
          elevationMeters: localElevationMeters,
          model,
        },
        signal,
      );
      signal.throwIfAborted();
      const result = toResult(data, input.coordinate, localElevationMeters);
      this.logger.log({
        level: 'info',
        name: 'weather.forecast.completed',
        data: {
          operationId,
          model,
          durationMs: Math.max(0, this.clock.monotonicNow() - startedAt),
          hourlyCount: result.hourly.length,
          dayCount: result.days.length,
          elevationSource: result.elevationSource,
          modelUpdateAvailable: result.modelRunAt !== null,
        },
      });
      return result;
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw error;
      const safeError =
        error instanceof PointWeatherForecastError
          ? error
          : invalidResponse('The forecast response could not be processed.');
      this.logger.log({
        level: 'warn',
        name: 'weather.forecast.failed',
        data: {
          operationId,
          model,
          durationMs: Math.max(0, this.clock.monotonicNow() - startedAt),
          code: safeError.code,
        },
      });
      throw safeError;
    }
  }
}
