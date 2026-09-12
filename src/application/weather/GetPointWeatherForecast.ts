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
  aggregateWeatherPeriodStatus,
  type WeatherPeriodStatus,
  type WeatherPeriodKind,
} from '@/domain/weather/aggregateWeatherPeriodStatus';

export const DEFAULT_WEATHER_MODEL: WeatherModel = 'ecmwf_ifs';

export type ForecastElevationSource = 'trail-planner-dem' | 'open-meteo-dem';

export interface PointWeatherForecastPeriod {
  readonly temperatureMinCelsius: number;
  readonly temperatureMaxCelsius: number;
  readonly windSpeedMinKmh: number;
  readonly windSpeedMaxKmh: number;
  readonly windGustsMinKmh: number;
  readonly windGustsMaxKmh: number;
  readonly precipitationMm: number;
  readonly status: WeatherPeriodStatus;
}

export interface PointWeatherForecastDay {
  readonly date: string;
  readonly day: PointWeatherForecastPeriod;
  readonly night: PointWeatherForecastPeriod;
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
  readonly currentThreeHours: PointWeatherForecastPeriod;
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

function summarizePeriod(
  hours: readonly HourlyWeatherForecast[],
  kind: WeatherPeriodKind,
): PointWeatherForecastPeriod {
  if (hours.length === 0) {
    throw invalidResponse('The forecast weather period has no hourly samples.');
  }
  const temperatures = hours.map((hour) => hour.temperatureCelsius);
  const windSpeeds = hours.map((hour) => hour.windSpeedKmh);
  const windGusts = hours.map((hour) => hour.windGustsKmh);
  const status = aggregateWeatherPeriodStatus(hours, kind);
  return {
    temperatureMinCelsius: Math.min(...temperatures),
    temperatureMaxCelsius: Math.max(...temperatures),
    windSpeedMinKmh: Math.min(...windSpeeds),
    windSpeedMaxKmh: Math.max(...windSpeeds),
    windGustsMinKmh: Math.min(...windGusts),
    windGustsMaxKmh: Math.max(...windGusts),
    precipitationMm: status.debug.precipTotal,
    status,
  };
}

function deriveCurrentThreeHours(
  hourly: readonly HourlyWeatherForecast[],
  currentTime: string,
): PointWeatherForecastPeriod {
  const currentHour = `${currentTime.slice(0, 13)}:00`;
  const hours = hourly.filter((hour) => hour.time >= currentHour).slice(0, 3);
  if (hours.length !== 3) {
    throw invalidResponse(
      'The forecast does not contain the current three-hour period.',
    );
  }
  return summarizePeriod(hours, 'current');
}

function deriveDays(
  hourly: readonly HourlyWeatherForecast[],
): readonly PointWeatherForecastDay[] {
  const groups = new Map<string, HourlyWeatherForecast[]>();
  let previousTime: string | null = null;
  for (const hour of hourly) {
    if (previousTime !== null && hour.time <= previousTime) {
      throw invalidResponse('The forecast local hourly samples are not ordered.');
    }
    previousTime = hour.time;
    const date = hour.time.slice(0, 10);
    const group = groups.get(date);
    if (group === undefined) groups.set(date, [hour]);
    else group.push(hour);
  }

  if (groups.size !== 8) {
    throw invalidResponse('The forecast does not contain eight local calendar days.');
  }

  const dates = [...groups.keys()];
  return dates.slice(0, 7).map((date, index) => {
    const group = groups.get(date);
    const nextDate = dates[index + 1];
    const nextGroup = nextDate === undefined ? undefined : groups.get(nextDate);
    if (group === undefined || nextGroup === undefined) {
      throw invalidResponse('The forecast local calendar day is missing.');
    }
    const followingDate = new Date(`${date}T00:00:00.000Z`);
    followingDate.setUTCDate(followingDate.getUTCDate() + 1);
    if (nextDate !== followingDate.toISOString().slice(0, 10)) {
      throw invalidResponse('The forecast local calendar days are not consecutive.');
    }
    const daylight = group.filter((hour) => hour.isDay);
    const nextDaylight = nextGroup.filter((hour) => hour.isDay);
    const firstNextDaylight = nextDaylight[0];
    const lastDaylight = daylight.at(-1);
    if (lastDaylight === undefined || firstNextDaylight === undefined) {
      throw invalidResponse(`The local forecast day ${date} has no daylight hours.`);
    }
    const night = [
      ...group.filter((hour) => !hour.isDay && hour.time > lastDaylight.time),
      ...nextGroup.filter((hour) => !hour.isDay && hour.time < firstNextDaylight.time),
    ];
    if (night.length === 0) {
      throw invalidResponse(`The local forecast night ${date} has no hourly samples.`);
    }
    return {
      date,
      day: summarizePeriod(daylight, 'day'),
      night: summarizePeriod(night, 'night'),
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
    currentThreeHours: deriveCurrentThreeHours(data.hourly, data.current.time),
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
