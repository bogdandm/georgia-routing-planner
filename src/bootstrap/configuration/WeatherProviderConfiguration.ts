import type { WeatherModel } from '@/application/ports/WeatherForecastGateway';

export interface WeatherModelConfiguration {
  readonly requestIdentifier: WeatherModel;
  readonly displayName: string;
  readonly resolutionLabel: string;
  readonly metadataUrl: string;
}
export interface WeatherMapConfiguration {
  readonly model: 'ecmwf_ifs025';
  readonly metadataUrl: string;
}

export interface WeatherProviderConfiguration {
  readonly forecastUrl: string;
  readonly attributionUrl: string;
  readonly licenseUrl: string;
  readonly requestTimeoutMs: number;
  readonly metadataTtlMs: number;
  readonly map: WeatherMapConfiguration;
  readonly models: Readonly<Record<WeatherModel, WeatherModelConfiguration>>;
}

export const weatherProviderConfiguration = {
  forecastUrl: 'https://api.open-meteo.com/v1/forecast',
  attributionUrl: 'https://open-meteo.com/',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  requestTimeoutMs: 15_000,
  metadataTtlMs: 600_000,
  map: {
    model: 'ecmwf_ifs025',
    metadataUrl:
      'https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs025/latest.json',
  },
  models: {
    ecmwf_ifs: {
      requestIdentifier: 'ecmwf_ifs',
      displayName: 'ECMWF IFS',
      resolutionLabel: '9 km',
      metadataUrl: 'https://api.open-meteo.com/data/ecmwf_ifs/static/meta.json',
    },
  },
} as const satisfies WeatherProviderConfiguration;
