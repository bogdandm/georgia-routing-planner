import { ThemeProvider } from '@mui/material/styles';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_WEATHER_MODEL,
  type PointWeatherForecast,
} from '@/application/weather/GetPointWeatherForecast';
import { PointWeatherForecastError } from '@/application/ports/WeatherForecastGateway';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import {
  requestWeatherForecast,
  resetMapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import { WeatherPanel } from '@/presentation/weather/WeatherPanel';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '@test/helpers/createTestServices';

function renderPanel(services = createTestServices()) {
  return {
    services,
    ...render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <WeatherPanel />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    ),
  };
}

async function testForecast(): Promise<PointWeatherForecast> {
  const services = createTestServices();
  return services.pointWeatherForecast.execute(
    {
      coordinate: { longitude: 44.8271, latitude: 41.7151 },
      model: DEFAULT_WEATHER_MODEL,
    },
    new AbortController().signal,
  );
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error('Deferred promise initialization failed.');
  }
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe('WeatherPanel', () => {
  beforeEach(() => {
    resetMapInteractionStore();
  });

  it('starts with map selection guidance and no attribution footer', () => {
    renderPanel();

    expect(screen.getByText('Select a forecast point')).toBeInTheDocument();
    expect(
      screen.getByText('Click a point on the map to load its ECMWF IFS forecast.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Weather data by Open-Meteo' }),
    ).not.toBeInTheDocument();
  });

  it('shows the current hour, next 24 local slots, derived days, and attribution', async () => {
    const baseline = await testForecast();
    const hourly = baseline.hourly.map((hour, index) => ({
      ...hour,
      precipitationMm:
        index === 18
          ? 99
          : index === 19
            ? 0.2
            : index === 20
              ? 1.2
              : index === 21
                ? 8.6
                : 0,
    }));
    const current = hourly[18];
    if (current === undefined) throw new Error('Expected a current-hour fixture.');
    const forecast: PointWeatherForecast = {
      ...baseline,
      current,
      hourly,
      days: baseline.days.map((day, index) =>
        index === 0
          ? {
              ...day,
              daylightTemperatureMinCelsius: 7,
              daylightTemperatureMaxCelsius: 24,
              daylightWindSpeedMinKmh: 3,
              daylightWindSpeedMaxKmh: 18,
              daylightPrecipitationMm: 1.25,
              status: {
                ...day.status,
                visibility: {
                  level: 'fog',
                  period: 'morning',
                  label: 'Morning fog',
                  icon: 'fog',
                },
              },
            }
          : day,
      ),
    };
    const services = createTestServices();
    const execute = vi
      .spyOn(services.pointWeatherForecast, 'execute')
      .mockResolvedValue(forecast);
    renderPanel(services);

    act(() => {
      requestWeatherForecast({ longitude: 44.8271, latitude: 41.7151 });
    });

    expect(await screen.findByText('41.71510, 44.82710 · 1,234 m')).toBeInTheDocument();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual({
      coordinate: { longitude: 44.8271, latitude: 41.7151 },
      model: 'ecmwf_ifs',
    });
    expect(screen.queryByText(/All times:/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Click another map point/u)).not.toBeInTheDocument();
    expect(screen.getByText('Clear sky')).toBeInTheDocument();
    expect(screen.queryByText(/Next 3 hours/u)).not.toBeInTheDocument();
    expect(screen.getByText('2.8 m/s S')).toBeInTheDocument();
    expect(screen.getByText('4.2 m/s')).toBeInTheDocument();
    expect(screen.getByLabelText('Feels like')).toBeInTheDocument();
    expect(screen.getByLabelText('Wind')).toBeInTheDocument();
    expect(screen.getByLabelText('Gusts')).toBeInTheDocument();
    expect(screen.getByLabelText('Cloud')).toBeInTheDocument();
    expect(screen.getByLabelText('Visibility')).toBeInTheDocument();

    const hourlyRegion = screen.getByRole('region', { name: 'Hourly forecast' });
    const hourlyCards = within(hourlyRegion).getAllByRole('article');
    expect(hourlyCards).toHaveLength(24);
    expect(hourlyCards[0]).toHaveAccessibleName(
      'Sat 18 Jul 2026, 18:00, Clear sky, 20 degrees Celsius, 99 mm precipitation',
    );
    expect(hourlyCards[23]).toHaveAccessibleName(
      'Sun 19 Jul 2026, 17:00, Clear sky, 20 degrees Celsius, 0 mm precipitation',
    );

    const dailyList = screen.getByRole('list', { name: 'Seven-day forecast' });
    expect(within(dailyList).getAllByRole('listitem')).toHaveLength(7);
    expect(within(dailyList).getAllByText('Clear')).toHaveLength(7);
    expect(within(dailyList).getByText('Morning fog')).toBeInTheDocument();
    expect(within(dailyList).getByLabelText('Morning fog')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Daytime temperature 7 to 24 degrees Celsius'),
    ).toHaveTextContent('7…24 °C');
    expect(
      screen.getByLabelText('Daytime wind 0.8 to 5.0 metres per second'),
    ).toHaveTextContent('0.8…5.0 m/s');
    expect(
      screen.getByLabelText('Daylight precipitation 1.25 millimetres'),
    ).toHaveTextContent('1.3 mm');
    expect(screen.getAllByLabelText('Daylight wind')).toHaveLength(7);
    expect(screen.getAllByLabelText('Daylight precipitation')).toHaveLength(7);

    expect(screen.getByText('ECMWF IFS · Updated 18 Jul, 04:00')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Weather data by Open-Meteo' }),
    ).toHaveAttribute('href', 'https://open-meteo.com/');
  });

  it('formats update metadata in the provider time zone without expanding the header', async () => {
    const baseline = await testForecast();
    const services = createTestServices();
    vi.spyOn(services.pointWeatherForecast, 'execute')
      .mockResolvedValueOnce({
        ...baseline,
        elevationMeters: 590,
        elevationSource: 'open-meteo-dem',
        timezone: 'America/New_York',
        timezoneAbbreviation: 'GMT-4',
        utcOffsetSeconds: -14_400,
      })
      .mockResolvedValueOnce({
        ...baseline,
        modelRunAt: null,
      });
    renderPanel(services);

    act(() => {
      requestWeatherForecast({ longitude: -74.006, latitude: 40.7128 });
    });
    expect(await screen.findByText('40.71280, -74.00600 · 590 m')).toBeInTheDocument();
    expect(screen.getByText('ECMWF IFS · Updated 17 Jul, 20:00')).toBeInTheDocument();

    act(() => {
      requestWeatherForecast({ longitude: 44.8271, latitude: 41.7151 });
    });
    expect(await screen.findByText('41.71510, 44.82710 · 1,234 m')).toBeInTheDocument();
    expect(screen.getByText('ECMWF IFS · Update time unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Trail Planner terrain/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Open-Meteo terrain/u)).not.toBeInTheDocument();
  });

  it('aborts the previous point and shows the replacement while it loads', async () => {
    const first = deferred<PointWeatherForecast>();
    const second = deferred<PointWeatherForecast>();
    const baseline = await testForecast();
    const services = createTestServices();
    const signals: AbortSignal[] = [];
    vi.spyOn(services.pointWeatherForecast, 'execute').mockImplementation(
      (
        _input: {
          readonly coordinate: {
            readonly longitude: number;
            readonly latitude: number;
          };
        },
        signal: AbortSignal,
      ) => {
        signals.push(signal);
        return signals.length === 1 ? first.promise : second.promise;
      },
    );
    renderPanel(services);

    act(() => {
      requestWeatherForecast({ longitude: 44.8, latitude: 41.7 });
    });
    expect(await screen.findByText('41.70000, 44.80000')).toBeInTheDocument();
    expect(screen.getByText('ECMWF IFS · Update time unavailable')).toBeInTheDocument();

    act(() => {
      requestWeatherForecast({ longitude: 45.25, latitude: 42.125 });
    });
    expect(await screen.findByText('42.12500, 45.25000')).toBeInTheDocument();
    expect(signals[0]?.aborted).toBe(true);

    second.resolve({
      ...baseline,
      selectedCoordinate: { longitude: 45.25, latitude: 42.125 },
      forecastCoordinate: { longitude: 45.25, latitude: 42.125 },
    });
    expect(await screen.findByText('42.12500, 45.25000 · 1,234 m')).toBeInTheDocument();
    first.resolve(baseline);
  });

  it('maps provider failures to safe copy and retries the selected point', async () => {
    const user = userEvent.setup();
    const baseline = await testForecast();
    const services = createTestServices();
    const execute = vi
      .spyOn(services.pointWeatherForecast, 'execute')
      .mockRejectedValueOnce(
        new PointWeatherForecastError(
          'provider-rate-limited',
          'secret provider detail',
        ),
      )
      .mockResolvedValueOnce(baseline);
    renderPanel(services);

    act(() => {
      requestWeatherForecast({ longitude: 44.8271, latitude: 41.7151 });
    });

    expect(
      await screen.findByText(
        'Weather service is temporarily rate-limited. Try again shortly.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('secret provider detail')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Weather data by Open-Meteo' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('41.71510, 44.82710 · 1,234 m')).toBeInTheDocument();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0].coordinate).toEqual({
      longitude: 44.8271,
      latitude: 41.7151,
    });
  });

  it('aborts an in-flight forecast when the panel unmounts', async () => {
    const pending = deferred<PointWeatherForecast>();
    const services = createTestServices();
    let signal: AbortSignal | null = null;
    vi.spyOn(services.pointWeatherForecast, 'execute').mockImplementation(
      (
        _input: {
          readonly coordinate: {
            readonly longitude: number;
            readonly latitude: number;
          };
        },
        requestSignal: AbortSignal,
      ) => {
        signal = requestSignal;
        return pending.promise;
      },
    );
    const { unmount } = renderPanel(services);

    act(() => {
      requestWeatherForecast({ longitude: 44.8, latitude: 41.7 });
    });
    await screen.findByText('41.70000, 44.80000');
    unmount();

    expect(signal).not.toBeNull();
    expect((signal as unknown as AbortSignal).aborted).toBe(true);
    pending.reject(new DOMException('cancelled', 'AbortError'));
    await waitFor(() => {
      expect((signal as unknown as AbortSignal).aborted).toBe(true);
    });
  });
});
