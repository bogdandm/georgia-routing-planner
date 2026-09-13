import type { ElevationCoordinate } from '@/application/ports/ElevationProvider';

export type WeatherModel = 'ecmwf_ifs';

export interface WeatherForecastValues {
  readonly temperatureCelsius: number;
  readonly apparentTemperatureCelsius: number;
  readonly precipitationMm: number;
  readonly rainMm: number;
  readonly showersMm: number;
  readonly snowfallCm: number;
  readonly weatherCode: number;
  readonly cloudCoverPercent: number;
  readonly visibilityMeters: number;
  readonly windSpeedKmh: number;
  readonly windGustsKmh: number;
  readonly isDay: boolean;
}

export interface CurrentWeatherForecast extends WeatherForecastValues {
  readonly time: string;
}

export interface HourlyWeatherForecast extends WeatherForecastValues {
  readonly time: string;
  readonly precipitationType: number;
}

export interface WeatherForecastData {
  readonly requestedCoordinate: ElevationCoordinate;
  readonly resolvedCoordinate: ElevationCoordinate;
  readonly elevationMeters: number;
  readonly timezone: string;
  readonly timezoneAbbreviation: string;
  readonly utcOffsetSeconds: number;
  readonly model: WeatherModel;
  readonly modelRunAt: string | null;
  readonly fetchedAt: string;
  readonly current: CurrentWeatherForecast;
  readonly hourly: readonly HourlyWeatherForecast[];
}

export type PointWeatherForecastErrorCode =
  | 'invalid-request'
  | 'provider-rate-limited'
  | 'provider-timeout'
  | 'provider-unavailable'
  | 'invalid-response';

/** Safe point-forecast failure contract shared by the provider and presentation. */
export class PointWeatherForecastError extends Error {
  public constructor(
    public readonly code: PointWeatherForecastErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PointWeatherForecastError';
  }
}

/** Fetches one normalized model forecast without exposing provider array schemas. */
export interface WeatherForecastGateway {
  fetch(
    input: {
      readonly coordinate: ElevationCoordinate;
      readonly elevationMeters: number | null;
      readonly model: WeatherModel;
    },
    signal: AbortSignal,
  ): Promise<WeatherForecastData>;
}
