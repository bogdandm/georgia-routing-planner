import type { WeatherModel } from '@/application/ports/WeatherForecastGateway';

export interface WeatherModelConfiguration {
  readonly requestIdentifier: WeatherModel;
  readonly displayName: string;
  readonly resolutionLabel: string;
  readonly metadataUrl: string;
}

export interface WeatherProviderConfiguration {
  readonly forecastUrl: string;
  readonly attributionUrl: string;
  readonly licenseUrl: string;
  readonly requestTimeoutMs: number;
  readonly metadataTtlMs: number;
  readonly models: Readonly<Record<WeatherModel, WeatherModelConfiguration>>;
}

export const weatherProviderConfiguration = {
  forecastUrl: 'https://api.open-meteo.com/v1/forecast',
  attributionUrl: 'https://open-meteo.com/',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  requestTimeoutMs: 15_000,
  metadataTtlMs: 600_000,
  models: {
    ecmwf_ifs: {
      requestIdentifier: 'ecmwf_ifs',
      displayName: 'ECMWF IFS',
      resolutionLabel: '9 km',
      metadataUrl: 'https://api.open-meteo.com/data/ecmwf_ifs/static/meta.json',
    },
  },
} as const satisfies WeatherProviderConfiguration;
