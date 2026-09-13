import { HttpResponse, delay, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { weatherProviderConfiguration } from '@/bootstrap/configuration/WeatherProviderConfiguration';
import type { WeatherProviderConfiguration } from '@/bootstrap/configuration/WeatherProviderConfiguration';
import { OpenMeteoWeatherForecastGateway } from '@/infrastructure/weather/OpenMeteoWeatherForecastGateway';
import { createTestServices } from '@test/helpers/createTestServices';
import { mswServer } from '@test/setup/mswServer';

const currentFields =
  'temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m,is_day';
const hourlyFields =
  'temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,precipitation_type,weather_code,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m,is_day';

function responseFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const time = Array.from({ length: 192 }, (_, index) => {
    const day = 18 + Math.floor(index / 24);
    const hour = index % 24;
    return `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`;
  });
  const numbers = (value: number) => time.map(() => value);
  return {
    latitude: 40.71,
    longitude: -74.01,
    elevation: 1_234.4,
    utc_offset_seconds: -14_400,
    timezone: 'America/New_York',
    timezone_abbreviation: 'GMT-4',
    current_units: {
      time: 'iso8601',
      temperature_2m: '°C',
      apparent_temperature: '°C',
      precipitation: 'mm',
      rain: 'mm',
      showers: 'mm',
      snowfall: 'cm',
      weather_code: 'wmo code',
      cloud_cover: '%',
      visibility: 'm',
      wind_speed_10m: 'km/h',
      wind_gusts_10m: 'km/h',
      is_day: '',
    },
    current: {
      time: time[0],
      interval: 900,
      temperature_2m: 21.5,
      apparent_temperature: 20.1,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
      weather_code: 2,
      cloud_cover: 35,
      visibility: 18_000,
      wind_speed_10m: 12.3,
      wind_gusts_10m: 20.4,
      is_day: 1,
    },
    hourly_units: {
      time: 'iso8601',
      temperature_2m: '°C',
      apparent_temperature: '°C',
      precipitation: 'mm',
      rain: 'mm',
      showers: 'mm',
      snowfall: 'cm',
      precipitation_type: '',
      weather_code: 'wmo code',
      cloud_cover: '%',
      visibility: 'm',
      wind_speed_10m: 'km/h',
      wind_gusts_10m: 'km/h',
      is_day: '',
    },
    hourly: {
      time,
      temperature_2m: numbers(20),
      apparent_temperature: numbers(19),
      precipitation: numbers(0.2),
      rain: numbers(0.2),
      showers: numbers(0),
      snowfall: numbers(0),
      precipitation_type: time.map(() => null),
      weather_code: numbers(2),
      cloud_cover: numbers(35),
      visibility: numbers(18_000),
      wind_speed_10m: numbers(12),
      wind_gusts_10m: numbers(20),
      is_day: time.map((_, index) => (index % 24 >= 6 && index % 24 < 20 ? 1 : 0)),
    },
    ...overrides,
  };
}

function createGateway(
  configuration: WeatherProviderConfiguration = weatherProviderConfiguration,
) {
  const services = createTestServices();
  return {
    services,
    gateway: new OpenMeteoWeatherForecastGateway(
      services.httpClient,
      configuration,
      services.clock,
      services.idGenerator,
    ),
  };
}

function installMetadata(timestamp = 1_752_796_800) {
  const handler = vi.fn(() =>
    HttpResponse.json({ last_run_initialisation_time: timestamp }),
  );
  mswServer.use(
    http.get(weatherProviderConfiguration.models.ecmwf_ifs.metadataUrl, handler),
  );
  return handler;
}

describe('OpenMeteoWeatherForecastGateway', () => {
  it('sends the exact point-model query and normalizes local forecast rows', async () => {
    const requestUrl = vi.fn<(url: URL) => void>();
    mswServer.use(
      http.get(weatherProviderConfiguration.forecastUrl, ({ request }) => {
        requestUrl(new URL(request.url));
        return HttpResponse.json(responseFixture());
      }),
    );
    const metadata = installMetadata();
    const { services, gateway } = createGateway();

    const result = await gateway.fetch(
      {
        coordinate: { longitude: -74.006, latitude: 40.7128 },
        elevationMeters: 1_234.4,
        model: 'ecmwf_ifs',
      },
      new AbortController().signal,
    );

    const url = requestUrl.mock.calls[0]?.[0];
    expect(url).toBeDefined();
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      latitude: '40.71280',
      longitude: '-74.00600',
      models: 'ecmwf_ifs',
      timezone: 'auto',
      forecast_days: '8',
      timeformat: 'iso8601',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm',
      current: currentFields,
      hourly: hourlyFields,
      elevation: '1234.4',
    });
    expect(url?.searchParams.has('daily')).toBe(false);
    expect(url?.searchParams.has('precipitation_probability')).toBe(false);
    expect(url?.searchParams.toString()).not.toContain('America%2FNew_York');
    expect(url?.searchParams.get('current')).not.toContain('wind_direction_10m');
    expect(url?.searchParams.get('hourly')).not.toContain('wind_direction_10m');
    expect(result).toMatchObject({
      requestedCoordinate: { longitude: -74.006, latitude: 40.7128 },
      resolvedCoordinate: { longitude: -74.01, latitude: 40.71 },
      elevationMeters: 1_234.4,
      timezone: 'America/New_York',
      timezoneAbbreviation: 'GMT-4',
      utcOffsetSeconds: -14_400,
      model: 'ecmwf_ifs',
      modelRunAt: '2025-07-18T00:00:00.000Z',
      current: { temperatureCelsius: 21.5, isDay: true },
    });
    expect(result.hourly).toHaveLength(192);
    expect(result.hourly[0]).toMatchObject({
      time: '2026-07-18T00:00',
      temperatureCelsius: 20,
      precipitationType: 1,
      isDay: false,
    });

    await gateway.fetch(
      {
        coordinate: { longitude: -74.006, latitude: 40.7128 },
        elevationMeters: null,
        model: 'ecmwf_ifs',
      },
      new AbortController().signal,
    );
    expect(metadata).toHaveBeenCalledOnce();
    services.dispose();
  });

  it('omits elevation when local terrain is unavailable', async () => {
    const elevation = vi.fn<(value: string | null) => void>();
    mswServer.use(
      http.get(weatherProviderConfiguration.forecastUrl, ({ request }) => {
        elevation(new URL(request.url).searchParams.get('elevation'));
        return HttpResponse.json(responseFixture());
      }),
    );
    installMetadata();
    const { services, gateway } = createGateway();

    await gateway.fetch(
      {
        coordinate: { longitude: -74.006, latitude: 40.7128 },
        elevationMeters: null,
        model: 'ecmwf_ifs',
      },
      new AbortController().signal,
    );

    expect(elevation).toHaveBeenCalledWith(null);
    services.dispose();
  });

  it('keeps a valid forecast when model metadata fails and does not cache failure', async () => {
    mswServer.use(
      http.get(weatherProviderConfiguration.forecastUrl, () =>
        HttpResponse.json(responseFixture()),
      ),
    );
    const metadata = vi.fn(() => HttpResponse.json({ malformed: true }));
    mswServer.use(
      http.get(weatherProviderConfiguration.models.ecmwf_ifs.metadataUrl, metadata),
    );
    const { services, gateway } = createGateway();
    const input = {
      coordinate: { longitude: -74.006, latitude: 40.7128 },
      elevationMeters: null,
      model: 'ecmwf_ifs' as const,
    };

    await expect(
      gateway.fetch(input, new AbortController().signal),
    ).resolves.toMatchObject({ modelRunAt: null });
    await gateway.fetch(input, new AbortController().signal);

    expect(metadata).toHaveBeenCalledTimes(2);
    services.dispose();
  });

  it.each([
    {
      name: 'rate limit',
      response: () => HttpResponse.json({}, { status: 429 }),
      code: 'provider-rate-limited',
    },
    {
      name: 'server failure',
      response: () => HttpResponse.json({}, { status: 503 }),
      code: 'provider-unavailable',
    },
    {
      name: 'network failure',
      response: () => HttpResponse.error(),
      code: 'provider-unavailable',
    },
  ])('maps $name without an automatic retry', async ({ response, code }) => {
    const forecast = vi.fn(response);
    mswServer.use(http.get(weatherProviderConfiguration.forecastUrl, forecast));
    installMetadata();
    const { services, gateway } = createGateway();

    await expect(
      gateway.fetch(
        {
          coordinate: { longitude: -74.006, latitude: 40.7128 },
          elevationMeters: null,
          model: 'ecmwf_ifs',
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code });

    expect(forecast).toHaveBeenCalledOnce();
    services.dispose();
  });

  it('maps provider timeout and preserves caller abort', async () => {
    // A real MSW delay is required to exercise Ky's platform timeout boundary.
    mswServer.use(
      http.get(weatherProviderConfiguration.forecastUrl, async () => {
        await delay(100);
        return HttpResponse.json(responseFixture());
      }),
    );
    installMetadata();
    const timeoutConfiguration = {
      ...weatherProviderConfiguration,
      requestTimeoutMs: 5,
    };
    const timeoutGateway = createGateway(timeoutConfiguration);

    await expect(
      timeoutGateway.gateway.fetch(
        {
          coordinate: { longitude: -74.006, latitude: 40.7128 },
          elevationMeters: null,
          model: 'ecmwf_ifs',
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'provider-timeout' });
    timeoutGateway.services.dispose();

    const abortGateway = createGateway();
    const controller = new AbortController();
    controller.abort();
    await expect(
      abortGateway.gateway.fetch(
        {
          coordinate: { longitude: -74.006, latitude: 40.7128 },
          elevationMeters: null,
          model: 'ecmwf_ifs',
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    abortGateway.services.dispose();
  });

  it.each([
    {
      name: 'mismatched arrays',
      mutate: () => {
        const response = responseFixture();
        const hourly = response.hourly as Record<string, unknown[]>;
        hourly.temperature_2m = hourly.temperature_2m?.slice(1) ?? [];
        return response;
      },
    },
    {
      name: 'malformed units',
      mutate: () => {
        const response = responseFixture();
        (response.hourly_units as Record<string, unknown>).temperature_2m = '°F';
        return response;
      },
    },
    {
      name: 'unsupported time zone',
      mutate: () => responseFixture({ timezone: 'Not/A_Zone' }),
    },
    {
      name: 'malformed local timestamp',
      mutate: () => {
        const response = responseFixture();
        const hourly = response.hourly as Record<string, unknown[]>;
        const times = [...(hourly.time ?? [])];
        times[0] = '2026-07-18T99:00';
        hourly.time = times;
        return response;
      },
    },
  ])('rejects $name as an invalid response', async ({ mutate }) => {
    mswServer.use(
      http.get(weatherProviderConfiguration.forecastUrl, () =>
        HttpResponse.json(mutate()),
      ),
    );
    installMetadata();
    const { services, gateway } = createGateway();

    await expect(
      gateway.fetch(
        {
          coordinate: { longitude: -74.006, latitude: 40.7128 },
          elevationMeters: null,
          model: 'ecmwf_ifs',
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });

    services.dispose();
  });
});
