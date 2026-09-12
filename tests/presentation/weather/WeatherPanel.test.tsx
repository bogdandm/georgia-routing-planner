import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
          <WeatherPanel
            sidebarCollapsed={false}
            onSelectedPointChange={() => undefined}
          />
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
              day: {
                ...day.day,
                temperatureMinCelsius: 7,
                temperatureMaxCelsius: 24,
                windSpeedMinKmh: 3,
                windSpeedMaxKmh: 18,
                windGustsMinKmh: 9,
                windGustsMaxKmh: 27,
                precipitationMm: 1.25,
                status: {
                  ...day.day.status,
                  primary: {
                    ...day.day.status.primary,
                    precipitation: 'rain',
                    label: 'Rain',
                    icon: {
                      ...day.day.status.primary.icon,
                      phenomenon: 'rain',
                    },
                  },
                  visibility: {
                    level: 'fog',
                    period: 'morning',
                    label: 'Morning fog',
                    icon: 'fog',
                  },
                },
              },
              night: {
                ...day.night,
                temperatureMinCelsius: -3,
                temperatureMaxCelsius: 8,
                windSpeedMinKmh: 4,
                windSpeedMaxKmh: 20,
                windGustsMinKmh: 8,
                windGustsMaxKmh: 30,
                precipitationMm: 2.5,
                status: {
                  ...day.night.status,
                  visibility: {
                    level: 'fog',
                    period: 'overnight',
                    label: 'Fog overnight',
                    icon: 'fog',
                  },
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

    expect(
      await screen.findByRole('region', {
        name: 'Current, day, and night summary',
      }),
    ).toBeInTheDocument();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual({
      coordinate: { longitude: 44.8271, latitude: 41.7151 },
      model: 'ecmwf_ifs',
    });
    expect(screen.queryByText(/All times:/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Click another map point/u)).not.toBeInTheDocument();
    const summary = screen.getByRole('region', {
      name: 'Current, day, and night summary',
    });
    const currentSummary = within(summary).getByRole('article', {
      name: 'Now · next 3 h forecast',
    });
    expect(
      within(currentSummary).getByLabelText('Now · next 3 h: Clear'),
    ).toBeInTheDocument();
    expect(within(currentSummary).getByText('Saturday, 18 Jul · 18:00')).toBeVisible();
    expect(within(currentSummary).getByText('Clear')).toBeVisible();
    const currentArtwork = within(currentSummary).getByLabelText(
      'Now · next 3 h: Clear',
    );
    expect(currentArtwork.querySelectorAll('img')).toHaveLength(1);
    expect(currentArtwork.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/monochrome/clear-day.svg'),
    );
    expect(currentArtwork.querySelectorAll('svg')).toHaveLength(0);
    expect(
      within(currentSummary).getByLabelText(
        'Now · next 3 h wind 2.8 to 2.8 metres per second',
      ),
    ).toHaveTextContent(/^2\.8 m\/s$/u);
    expect(
      within(currentSummary).getByLabelText(
        'Now · next 3 h gusts 4.2 to 4.2 metres per second',
      ),
    ).toHaveTextContent('4.2 m/s');
    expect(
      within(currentSummary).getByLabelText(
        'Now · next 3 h precipitation 0 millimetres',
      ),
    ).toHaveTextContent('0 mm');
    const daySummary = within(summary).getByRole('article', { name: 'Day forecast' });
    const nightSummary = within(summary).getByRole('article', {
      name: 'Night forecast',
    });
    expect(daySummary).toBeVisible();
    expect(nightSummary).toBeVisible();
    expect(within(daySummary).getByText('Day')).toBeVisible();
    expect(within(nightSummary).getByText('Night')).toBeVisible();
    const daySummaryArtwork = within(daySummary).getByLabelText('Day: Rain');
    const nightSummaryArtwork = within(nightSummary).getByLabelText('Fog overnight');
    expect(daySummaryArtwork.querySelectorAll('img')).toHaveLength(1);
    expect(daySummaryArtwork.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/monochrome/mostly-clear-day-rain.svg'),
    );
    expect(daySummaryArtwork.querySelector('img')).toHaveAttribute('width', '44');
    expect(daySummaryArtwork.querySelector('img')).toHaveAttribute('height', '44');
    expect(daySummaryArtwork.querySelectorAll('svg')).toHaveLength(0);
    expect(nightSummaryArtwork.querySelectorAll('img')).toHaveLength(1);
    expect(nightSummaryArtwork.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/monochrome/mostly-clear-night-fog.svg'),
    );
    expect(nightSummaryArtwork.querySelector('img')).toHaveAttribute('width', '44');
    expect(nightSummaryArtwork.querySelector('img')).toHaveAttribute('height', '44');
    expect(nightSummaryArtwork.querySelectorAll('svg')).toHaveLength(0);
    expect(within(daySummary).getByText('Rain')).toBeInTheDocument();
    expect(within(nightSummary).getByText('Clear')).toBeInTheDocument();
    expect(within(daySummary).getByText('Wind')).toBeInTheDocument();
    expect(within(daySummary).getByText('Gusts')).toBeInTheDocument();
    expect(
      within(daySummary).getByLabelText('Day wind 0.8 to 5.0 metres per second'),
    ).toHaveTextContent('0.8…5.0 m/s');
    expect(
      within(daySummary).getByLabelText('Day gusts 2.5 to 7.5 metres per second'),
    ).toHaveTextContent('2.5…7.5 m/s');
    expect(
      within(daySummary).getByLabelText('Day precipitation 1.25 millimetres'),
    ).toHaveTextContent('1.3 mm');
    expect(screen.queryByLabelText('Feels like')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cloud')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Visibility')).not.toBeInTheDocument();

    const hourlyTable = screen.getByRole('table', { name: 'Hourly forecast' });
    expect(within(hourlyTable).getAllByRole('row')).toHaveLength(6);
    expect(within(hourlyTable).getAllByRole('columnheader')).toHaveLength(24);
    expect(
      within(hourlyTable).getByRole('columnheader', {
        name: '2026-07-18T18:00 local time',
      }),
    ).toHaveTextContent('Sat');
    expect(
      within(hourlyTable).getByRole('columnheader', {
        name: '2026-07-19T17:00 local time',
      }),
    ).toHaveTextContent('17:00');
    expect(
      within(hourlyTable).queryByRole('rowheader', { name: /direction/iu }),
    ).toBeNull();

    const scrollBy = vi.fn();
    Object.defineProperties(hourlyTable, {
      clientWidth: { configurable: true, value: 400 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 1_024 },
      scrollBy: { configurable: true, value: scrollBy },
    });
    fireEvent.scroll(hourlyTable);
    const forwardButton = screen.getByRole('button', {
      name: 'Scroll hourly forecast forward',
    });
    expect(forwardButton).toBeEnabled();
    fireEvent.click(forwardButton);
    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' });

    const dailyList = screen.getByRole('list', { name: 'Seven-day forecast' });
    const dailyRows = within(dailyList).getAllByRole('listitem');
    expect(dailyRows).toHaveLength(7);
    const firstDailyRow = dailyRows[0];
    if (firstDailyRow === undefined) throw new Error('Expected the first daily row.');
    const dayForecast = within(firstDailyRow).getByRole('article', {
      name: 'Day forecast',
    });
    const nightForecast = within(firstDailyRow).getByRole('article', {
      name: 'Night forecast',
    });
    expect(within(firstDailyRow).queryByText('Day')).not.toBeInTheDocument();
    expect(within(firstDailyRow).queryByText('Night')).not.toBeInTheDocument();
    const dayForecastArtwork = within(dayForecast).getByLabelText('Day: Rain');
    const nightForecastArtwork = within(nightForecast).getByLabelText('Fog overnight');
    expect(dayForecastArtwork.querySelectorAll('img')).toHaveLength(1);
    expect(dayForecastArtwork.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/monochrome/mostly-clear-day-rain.svg'),
    );
    expect(dayForecastArtwork.querySelector('img')).toHaveAttribute('width', '36');
    expect(dayForecastArtwork.querySelector('img')).toHaveAttribute('height', '36');
    expect(dayForecastArtwork.querySelectorAll('svg')).toHaveLength(0);
    expect(nightForecastArtwork.querySelectorAll('img')).toHaveLength(1);
    expect(nightForecastArtwork.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/monochrome/mostly-clear-night-fog.svg'),
    );
    expect(nightForecastArtwork.querySelector('img')).toHaveAttribute('width', '36');
    expect(nightForecastArtwork.querySelector('img')).toHaveAttribute('height', '36');
    expect(nightForecastArtwork.querySelectorAll('svg')).toHaveLength(0);
    expect(
      within(dayForecast).getByLabelText('Day temperature 7 to 24 degrees Celsius'),
    ).toHaveTextContent('7…24 °C');
    expect(
      within(dayForecast).getByLabelText('Day wind 0.8 to 5.0 metres per second'),
    ).toHaveTextContent('0.8…5.0 m/s');
    expect(
      within(dayForecast).getByLabelText('Day gusts 2.5 to 7.5 metres per second'),
    ).toHaveTextContent('2.5…7.5 m/s');
    expect(
      within(dayForecast).getByLabelText('Day precipitation 1.25 millimetres'),
    ).toHaveTextContent('1.3 mm');
    expect(
      within(nightForecast).getByLabelText('Night temperature -3 to 8 degrees Celsius'),
    ).toHaveTextContent('-3…8 °C');
    expect(
      within(nightForecast).getByLabelText('Night wind 1.1 to 5.6 metres per second'),
    ).toHaveTextContent('1.1…5.6 m/s');
    expect(
      within(nightForecast).getByLabelText('Night gusts 2.2 to 8.3 metres per second'),
    ).toHaveTextContent('2.2…8.3 m/s');
    expect(
      within(nightForecast).getByLabelText('Night precipitation 2.5 millimetres'),
    ).toHaveTextContent('2.5 mm');
    expect(within(dayForecast).getByText('Rain')).toBeVisible();

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
    expect(
      await screen.findByText('ECMWF IFS · Updated 17 Jul, 20:00'),
    ).toBeInTheDocument();

    act(() => {
      requestWeatherForecast({ longitude: 44.8271, latitude: 41.7151 });
    });
    expect(
      await screen.findByText('ECMWF IFS · Update time unavailable'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Trail Planner terrain/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Open-Meteo terrain/u)).not.toBeInTheDocument();
  });

  it('aborts the previous point and completes the replacement forecast', async () => {
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

    await waitFor(() => {
      expect(signals).toHaveLength(1);
    });
    expect(screen.getByText('ECMWF IFS · Update time unavailable')).toBeInTheDocument();

    act(() => {
      requestWeatherForecast({ longitude: 45.25, latitude: 42.125 });
    });
    await waitFor(() => {
      expect(signals).toHaveLength(2);
    });
    expect(signals[0]?.aborted).toBe(true);

    second.resolve({
      ...baseline,
      selectedCoordinate: { longitude: 45.25, latitude: 42.125 },
      forecastCoordinate: { longitude: 45.25, latitude: 42.125 },
    });
    await waitFor(() => {
      expect(
        screen.queryByLabelText('Loading hourly forecast'),
      ).not.toBeInTheDocument();
    });
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

    expect(
      await screen.findByRole('region', {
        name: 'Current, day, and night summary',
      }),
    ).toBeInTheDocument();
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
    await waitFor(() => {
      expect(signal).not.toBeNull();
    });
    unmount();

    expect(signal).not.toBeNull();
    expect((signal as unknown as AbortSignal).aborted).toBe(true);
    pending.reject(new DOMException('cancelled', 'AbortError'));
    await waitFor(() => {
      expect((signal as unknown as AbortSignal).aborted).toBe(true);
    });
  });
});
