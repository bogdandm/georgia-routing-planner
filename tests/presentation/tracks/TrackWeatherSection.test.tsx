import { ThemeProvider } from '@mui/material';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PointWeatherForecastError } from '@/application/ports/WeatherForecastGateway';
import {
  defaultTrackWeatherDate,
  defaultTrackWeatherPreferences,
  defaultTrackWeatherTimelineSettings,
  localCalendarDate,
  trackWeatherDates,
  trackWeatherWeekday,
  type TrackTimingRoute,
  type TrackWeatherPreferences,
  type TrackWeatherTimelineSettings,
} from '@/application/weather/TrackWeatherForecast';
import {
  DAY_HIKE_TIME_PRESET_ID,
  DIN_HIKING_TIME_PRESET_ID,
  defaultHikingTimePresetSettings,
  resolveHikingTimePreset,
  type HikingTimeParameters,
} from '@/domain/tracks/hikingTime';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import type {
  ElevationProfile,
  ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import { activateAppLocale } from '@/presentation/localization/appI18n';
import {
  mapInteractionStore,
  resetMapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { daylightWindow } from '@/presentation/map/sunShadowDaylight';
import { useUiStore } from '@/presentation/shell/uiStore';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { TrackWeatherSection } from '@/presentation/tracks/TrackWeatherSection';
import type { TrackStatsMetrics } from '@/presentation/tracks/TrackSummary';
import type { TrackLightingView } from '@/presentation/tracks/useTrackLighting';
import { weatherResumeRetryDelayMs } from '@/presentation/weather/useWeatherRetryOnResume';
import { createTestServices } from '@test/helpers/createTestServices';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

/** 12 km: 900 m up, then 500 m down; DIN 33466 total is 5.5 h. */
const ridge: ElevationProfile = {
  points: Array.from({ length: 13 }, (_, kilometre): ElevationProfilePoint => {
    const elevationMeters =
      kilometre <= 6 ? 2_000 + 150 * kilometre : 2_900 - (500 / 6) * (kilometre - 6);
    return {
      coordinate: [44 + kilometre / 100, 42],
      rawElevationMeters: elevationMeters,
      elevationMeters,
      sourceSegmentIndex: 0,
      sampleIndex: kilometre,
      distanceMeters: kilometre * 1_000,
      trendElevationMeters: elevationMeters,
      localGradePct: 0,
    };
  }),
  segments: [],
  gradeSubsegments: [],
  minimumMeters: 2_000,
  maximumMeters: 2_900,
  algorithmVersion: 3,
};

/** The DIN 33466 preset reproduces the v1 timeline these tests were written for. */
const dinHikingTime = resolveHikingTimePreset(
  defaultHikingTimePresetSettings,
  DIN_HIKING_TIME_PRESET_ID,
).parameters;

const dayHike: TrackStatsMetrics = {
  distanceMeters: 12_000,
  ascentMeters: 900,
  descentMeters: 500,
};

const expandedPreferences: TrackWeatherPreferences = {
  expanded: true,
  weekday: 6,
};

let services: ReturnType<typeof createTestServices>;

function renderSection(
  initial: TrackWeatherPreferences | null,
  metrics: TrackStatsMetrics = dayHike,
  initialTimeline: TrackWeatherTimelineSettings = defaultTrackWeatherTimelineSettings,
  lighting: TrackLightingView | null = null,
  hikingTime: HikingTimeParameters = dinHikingTime,
) {
  const onPreferencesChange = vi.fn();
  const onTimelineSettingsChange = vi.fn();
  function Harness() {
    const [preferences, setPreferences] = useState(initial);
    const [timelineSettings, setTimelineSettings] = useState(initialTimeline);
    return (
      <TrackWeatherSection
        profile={ridge}
        metrics={metrics}
        timingRoute={ridge}
        preferences={preferences}
        onPreferencesChange={(next) => {
          onPreferencesChange(next);
          setPreferences(next);
        }}
        timelineSettings={timelineSettings}
        onTimelineSettingsChange={(next) => {
          onTimelineSettingsChange(next);
          setTimelineSettings(next);
        }}
        hikingTime={hikingTime}
        presetEstimates={new Map()}
        // The track panel shows the track's own date, else the forecast's selected date.
        lighting={
          lighting === null
            ? null
            : {
                ...lighting,
                date:
                  timelineSettings.hikeDate ??
                  defaultTrackWeatherDate(
                    forecastDates(),
                    (preferences ?? defaultTrackWeatherPreferences).weekday,
                  ),
              }
        }
      />
    );
  }
  renderWithI18n(
    <RuntimeServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <Harness />
      </ThemeProvider>
    </RuntimeServicesProvider>,
  );
  return { onPreferencesChange, onTimelineSettingsChange };
}

/** The forecast week from the test clock's browser-local today. */
function forecastDates(): readonly string[] {
  return trackWeatherDates(localCalendarDate(services.clock.now()));
}

function expandedSection(
  metrics: TrackStatsMetrics,
  timingRoute: TrackTimingRoute = ridge,
) {
  return (
    <RuntimeServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <TrackWeatherSection
          profile={ridge}
          metrics={metrics}
          timingRoute={timingRoute}
          preferences={expandedPreferences}
          onPreferencesChange={vi.fn()}
          timelineSettings={defaultTrackWeatherTimelineSettings}
          onTimelineSettingsChange={vi.fn()}
          lighting={null}
          hikingTime={dinHikingTime}
          presetEstimates={new Map()}
        />
      </ThemeProvider>
    </RuntimeServicesProvider>
  );
}

function setPageVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  activateAppLocale('en');
  services = createTestServices();
});

describe('TrackWeatherSection', () => {
  it('shows a track without its own preset as following the default preset', () => {
    renderSection(null);

    expect(
      screen.getByRole('combobox', { name: 'Hiking time preset' }),
    ).toHaveTextContent('Default (Day hike)');
  });

  it('sums breaks and lunch beside their own slider, which the pace leaves unchanged', async () => {
    const user = userEvent.setup();
    const { onTimelineSettingsChange } = renderSection(
      null,
      dayHike,
      defaultTrackWeatherTimelineSettings,
      null,
      resolveHikingTimePreset(defaultHikingTimePresetSettings, DAY_HIKE_TIME_PRESET_ID)
        .parameters,
    );
    const stopSum = () => screen.getByText(/^Breaks and lunch: ≈/u).textContent;
    const initialSum = stopSum();
    expect(initialSum).not.toBe('Breaks and lunch: ≈0h\u00a00m');

    screen.getByRole('slider', { name: 'Adjust pace' }).focus();
    await user.keyboard('{End}');
    expect(stopSum()).toBe(initialSum);

    screen.getByRole('slider', { name: 'Adjust breaks and lunch' }).focus();
    await user.keyboard('{Home}');
    expect(stopSum()).toBe('Breaks and lunch: ≈0h\u00a00m');
    expect(onTimelineSettingsChange).toHaveBeenLastCalledWith({
      ...defaultTrackWeatherTimelineSettings,
      paceFactor: 2,
      stopFactor: 0,
      timeMarkers: null,
    });
  });

  it('keeps the recorded-time override available but disabled without recorded timing', () => {
    renderSection(null);
    expect(
      screen.getByRole('checkbox', { name: 'Ignore recorded time' }),
    ).toBeDisabled();
  });

  it('stays collapsed without requests until expanded, then forecasts elevations and the route', async () => {
    const execute = vi.spyOn(services.pointWeatherForecast, 'execute');
    const user = userEvent.setup();
    const { onPreferencesChange } = renderSection(null);

    const disclosure = screen.getByRole('button', { name: 'Weather forecast' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(execute).not.toHaveBeenCalled();

    await user.click(disclosure);

    expect(onPreferencesChange).toHaveBeenCalledWith(expandedPreferences);
    expect(screen.getByRole('button', { name: /July 18/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const highest = screen.getByRole('group', { name: 'Highest, 2,900\u00a0m' });
    expect(
      await within(highest).findByRole('article', { name: 'Day forecast' }),
    ).toBeVisible();
    expect(
      within(highest).queryByRole('article', { name: 'Night forecast' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Lowest, 2,000\u00a0m' })).toBeVisible();
    expect(
      screen.getByText(
        'Starting at 09:00 at the estimated pace, about 5h 30m in total.',
      ),
    ).toBeVisible();
    const route = screen.getByRole('list', { name: 'Forecast along the route' });
    expect(
      within(route)
        .getAllByRole('group')
        .map((card) => card.getAttribute('aria-label')),
    ).toEqual([
      // Each card names the highest point of its hours: 4.8 km at 12:00, the summit
      // before 13:00, and the descent at 14:00.
      '09:00, Start, 2,720\u00a0m',
      '12:00, At 4.8\u00a0km, 2,900\u00a0m',
      '14:30, Finish, 2,543\u00a0m',
    ]);
    expect(
      await within(route).findAllByRole('article', { name: /forecast$/ }),
    ).toHaveLength(3);
    // Three elevation points plus the hiker at each hour from 09:00 to 14:00; at 09:00
    // the hiker is at the start, which is also the lowest point.
    expect(execute).toHaveBeenCalledTimes(8);
  });

  it('adjusts route timing with weather closed and uses it when forecasts open', async () => {
    const execute = vi.spyOn(services.pointWeatherForecast, 'execute');
    const user = userEvent.setup();
    renderSection(null);

    const timing = screen.getByRole('heading', { name: 'Route timing', level: 3 });
    const disclosure = screen.getByRole('button', { name: 'Weather forecast' });
    expect(
      timing.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    screen.getByRole('slider', { name: 'Route start' }).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    screen.getByRole('slider', { name: 'Adjust pace' }).focus();
    await user.keyboard('{Home}');
    await user.click(screen.getByRole('checkbox', { name: 'Show times on the map' }));
    expect(
      screen.getByRole('checkbox', { name: 'Show times on the map' }),
    ).not.toBeChecked();
    expect(execute).not.toHaveBeenCalled();

    await user.click(disclosure);
    const route = screen.getByRole('list', { name: 'Forecast along the route' });
    expect(
      within(route)
        .getAllByRole('group')
        .map((card) => card.getAttribute('aria-label')),
    ).toEqual(['10:00, Start, 2,900\u00a0m', '12:45, Finish, 2,829\u00a0m']);
    expect(
      await within(route).findAllByRole('article', { name: /forecast$/ }),
    ).toHaveLength(2);

    await user.click(disclosure);
    expect(
      screen.queryByRole('list', { name: 'Forecast along the route' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Route start' })).toHaveAttribute(
      'aria-valuetext',
      '10:00',
    );
    expect(screen.getByRole('slider', { name: 'Adjust pace' })).toHaveAttribute(
      'aria-valuetext',
      '×0.5',
    );
  });

  it('opens the full forecast at a card highest point in Weather', async () => {
    resetMapInteractionStore();
    const user = userEvent.setup();
    renderSection(expandedPreferences);

    await user.click(
      await screen.findByRole('button', {
        name: 'Open the forecast for 12:00, At 4.8\u00a0km, 2,900\u00a0m in Weather',
      }),
    );

    const request = mapInteractionStore.getState().weatherForecastRequest;
    expect(request?.placeLabel).toBe('12:00, At 4.8\u00a0km');
    // The summit, 6 km along, which the hiker passes during the 12:00 hour.
    expect(request?.elevationMeters).toBe(2_900);
    expect(request?.coordinate.longitude).toBeCloseTo(44.06, 6);
    expect(useUiStore.getState().activeTab).toBe('weather');
    expect(window.location.hash).toBe('#weather');
  });

  it('names a route card by its highest hour once every hour forecast supplies elevation', async () => {
    resetMapInteractionStore();
    const forecast = services.pointWeatherForecast;
    const execute = forecast.execute.bind(forecast);
    // The test library target predates Promise.withResolvers.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Forecast elevation rises 100 m per kilometre east; the 1,800 m hour waits.
    vi.spyOn(forecast, 'execute').mockImplementation(async (input, signal) => {
      const elevationMeters =
        1_000 + Math.round((input.coordinate.longitude - 44) * 10_000);
      if (elevationMeters === 1_800) await held;
      return execute({ ...input, elevationMeters }, signal);
    });
    const user = userEvent.setup();
    // Without elevation the 12 km route takes 3 h: the start card covers 09:00 at
    // 0 km, 10:00 at 4 km, and 11:00 at 8 km.
    renderWithI18n(
      expandedSection(
        { distanceMeters: 12_000 },
        {
          points: ridge.points.map(
            ({ coordinate, distanceMeters, sourceSegmentIndex }) => ({
              coordinate,
              distanceMeters,
              sourceSegmentIndex,
            }),
          ),
        },
      ),
    );
    const route = screen.getByRole('list', { name: 'Forecast along the route' });

    expect(
      await within(route).findByRole('group', {
        name: '12:00, Finish, 2,200\u00a0m',
      }),
    ).toBeVisible();
    expect(
      within(route).getByRole('group', { name: '09:00, Start, Loading elevation…' }),
    ).toBeVisible();

    act(release);
    await user.click(
      await within(route).findByRole('button', {
        name: 'Open the forecast for 09:00, Start, 1,800\u00a0m in Weather',
      }),
    );
    const request = mapInteractionStore.getState().weatherForecastRequest;
    expect(request?.elevationMeters).toBe(1_800);
    expect(request?.coordinate.longitude).toBeCloseTo(44.08, 6);
  });

  it('remembers the weekday of a chosen forecast date', async () => {
    const user = userEvent.setup();
    const { onPreferencesChange } = renderSection(expandedPreferences);

    await user.click(screen.getByRole('button', { name: /July 20/ }));

    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      ...expandedPreferences,
      weekday: 1,
    });
    expect(screen.getByRole('button', { name: /July 20/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('limits the route forecast to day hikes but keeps the start and pace for map times', () => {
    renderSection(expandedPreferences, { distanceMeters: 31_000 });

    expect(
      screen.getByText('Available for day hikes shorter than 30 km and 12 hours.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('list', { name: 'Forecast along the route' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Route start' })).toBeVisible();
    expect(screen.getByRole('slider', { name: 'Adjust pace' })).toBeVisible();
  });

  it('moves the route forecast to a chosen start time above the pace control', async () => {
    const user = userEvent.setup();
    const { onTimelineSettingsChange } = renderSection(expandedPreferences);
    const route = screen.getByRole('list', { name: 'Forecast along the route' });
    const labels = () =>
      within(route)
        .getAllByRole('group')
        .map((card) => card.getAttribute('aria-label'));

    const sliders = screen.getAllByRole('slider');
    expect(sliders.map((slider) => slider.getAttribute('aria-labelledby'))).toEqual([
      screen.getByText('Route start').id,
      screen.getByText('Adjust pace').id,
      screen.getByText('Adjust breaks and lunch').id,
    ]);
    const start = screen.getByRole('slider', { name: 'Route start' });
    expect(start).toHaveAttribute('aria-valuetext', '09:00');

    start.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');

    expect(start).toHaveAttribute('aria-valuetext', '10:30');
    expect(labels()).toEqual([
      '10:30, Start, 2,840\u00a0m',
      '13:30, At 4.8\u00a0km, 2,900\u00a0m',
      '16:00, Finish, 2,400\u00a0m',
    ]);
    expect(
      screen.getByText(
        'Starting at 10:30 at the estimated pace, about 5h 30m in total.',
      ),
    ).toBeVisible();

    await user.keyboard('{Home}');
    expect(start).toHaveAttribute('aria-valuetext', '00:00');
    await user.keyboard('{End}');
    expect(start).toHaveAttribute('aria-valuetext', '23:30');
    // Arrivals after midnight fall on the next date; only the time of day is shown.
    expect(labels()[2]).toBe('05:00, Finish, 2,400\u00a0m');
    expect(onTimelineSettingsChange).toHaveBeenLastCalledWith({
      ...defaultTrackWeatherTimelineSettings,
      startHour: 23.5,
      paceFactor: 1,
      timeMarkers: null,
    });
  });

  it('opens on the given start time and pace and reports released values on the step grid', async () => {
    const user = userEvent.setup();
    const { onTimelineSettingsChange } = renderSection(expandedPreferences, dayHike, {
      ...defaultTrackWeatherTimelineSettings,
      startHour: 7,
      paceFactor: 2,
      timeMarkers: null,
    });
    const pace = screen.getByRole('slider', { name: 'Adjust pace' });
    expect(screen.getByRole('slider', { name: 'Route start' })).toHaveAttribute(
      'aria-valuetext',
      '07:00',
    );
    expect(pace).toHaveAttribute('aria-valuetext', '×2');
    expect(
      screen.getByText(
        'Starting at 07:00 at the adjusted pace, about 11h 0m in total.',
      ),
    ).toBeVisible();

    // Ten keyboard steps up from ×0.5 add up to 1.0000000000000004 in floating point.
    pace.focus();
    await user.keyboard('{Home}');
    await user.keyboard(Array.from({ length: 10 }, () => '{ArrowRight}').join(''));
    expect(onTimelineSettingsChange).toHaveBeenLastCalledWith({
      ...defaultTrackWeatherTimelineSettings,
      startHour: 7,
      paceFactor: 1,
      timeMarkers: null,
    });
    expect(
      screen.getByText(
        'Starting at 07:00 at the estimated pace, about 5h 30m in total.',
      ),
    ).toBeVisible();
  });

  it('replans the route forecast for an adjusted pace', async () => {
    const user = userEvent.setup();
    renderSection(expandedPreferences);
    const route = () => screen.getByRole('list', { name: 'Forecast along the route' });
    const times = () =>
      within(route())
        .getAllByRole('group')
        .map((card) => card.getAttribute('aria-label')?.slice(0, 5));

    screen.getByRole('slider', { name: 'Adjust pace' }).focus();
    await user.keyboard('{Home}');

    expect(times()).toEqual(['09:00', '11:45']);
    expect(
      screen.getByText(
        'Starting at 09:00 at the adjusted pace, about 2h 45m in total.',
      ),
    ).toBeVisible();

    await user.keyboard('{End}');

    expect(times()).toEqual(['09:00', '12:00', '15:00', '18:00', '20:00']);
  });

  it('requests forecasts again when new track metrics abort the pending ones', async () => {
    const { rerender } = renderWithI18n(expandedSection(dayHike));
    // Same values in a new object: the effect reruns before the first requests settle.
    rerender(expandedSection({ ...dayHike }));

    const highest = screen.getByRole('group', { name: 'Highest, 2,900\u00a0m' });
    expect(
      await within(highest).findByRole('article', { name: 'Day forecast' }),
    ).toBeVisible();
  });

  it('reports a forecast that cannot be loaded at its location', async () => {
    vi.spyOn(services.pointWeatherForecast, 'execute').mockRejectedValue(
      new PointWeatherForecastError('provider-unavailable', 'Unavailable.'),
    );
    renderSection(expandedPreferences);

    const highest = screen.getByRole('group', { name: 'Highest, 2,900\u00a0m' });
    expect(
      await within(highest).findByText('The forecast could not be loaded.'),
    ).toBeVisible();
  });

  it('retries only failed forecasts once the resumed page stays visible', async () => {
    const realExecute = services.pointWeatherForecast.execute.bind(
      services.pointWeatherForecast,
    );
    let highestFailed = false;
    const execute = vi
      .spyOn(services.pointWeatherForecast, 'execute')
      .mockImplementation(async (input, signal) => {
        if (input.elevationMeters === 2_900 && !highestFailed) {
          highestFailed = true;
          throw new PointWeatherForecastError('provider-timeout', 'network suspended');
        }
        return realExecute(input, signal);
      });
    renderSection(expandedPreferences);
    const highest = screen.getByRole('group', { name: 'Highest, 2,900\u00a0m' });
    expect(
      await within(highest).findByText('The forecast could not be loaded.'),
    ).toBeVisible();
    const lowest = screen.getByRole('group', { name: 'Lowest, 2,000\u00a0m' });
    await within(lowest).findByRole('article', { name: 'Day forecast' });
    const initialCalls = execute.mock.calls.length;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      act(() => {
        setPageVisibility('hidden');
        setPageVisibility('visible');
        vi.advanceTimersByTime(weatherResumeRetryDelayMs - 1);
      });
      expect(execute).toHaveBeenCalledTimes(initialCalls);
      act(() => {
        vi.advanceTimersByTime(1);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(
      await within(highest).findByRole('article', { name: 'Day forecast' }),
    ).toBeVisible();
    expect(
      execute.mock.calls.slice(initialCalls).map(([input]) => input.elevationMeters),
    ).toEqual([2_900]);
  });

  describe('route lighting', () => {
    const timeZone = 'Asia/Tbilisi';
    const hikeLighting: TrackLightingView = {
      timeZone,
      // The harness replaces it with the track or forecast date.
      date: '2026-07-18',
      recordedDate: null,
      // 09:00 to 14:30 in Tbilisi (UTC+4 all year).
      startMs: Date.UTC(2026, 6, 18, 5),
      finishMs: Date.UTC(2026, 6, 18, 10, 30),
      recordedTiming: false,
      startCoordinate: [44.5, 42],
      finishCoordinate: [44.5, 42],
      sunEvents: [],
      terrain: { status: 'off' },
    };

    /** Lighting on 4 July finishing `offsetMs` from that day's sunset at the route. */
    function lightingAroundSunset(
      offsetMs: number,
      terrain: TrackLightingView['terrain'],
    ): TrackLightingView {
      const daylight = daylightWindow(
        Date.UTC(2026, 6, 4, 8),
        { latitude: 42, longitude: 44.5 },
        timeZone,
      );
      if (daylight === null) throw new Error('Expected a sunset in July.');
      const finishMs = daylight.sunsetMs + offsetMs;
      return {
        ...hikeLighting,
        recordedDate: '2026-07-04',
        startMs: finishMs - 3 * 3_600_000,
        finishMs,
        terrain,
      };
    }

    it('keeps a date outside the forecast week as the track date and moves the map shadows to it', () => {
      mapLayerStore.setState((state) => ({
        sunShadow: {
          ...state.sunShadow,
          enabled: true,
          // 15:30 in Tbilisi.
          instantMs: Date.UTC(2026, 6, 18, 11, 30),
        },
      }));
      const { mapLayers } = services;
      if (mapLayers === null) throw new Error('Expected test map layers.');
      const setSunShadow = vi.spyOn(mapLayers, 'setSunShadow');
      const { onPreferencesChange, onTimelineSettingsChange } = renderSection(
        null,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        hikeLighting,
      );
      const date = screen.getByLabelText('Hike date');
      expect(date).toHaveValue(defaultTrackWeatherDate(forecastDates(), 6));

      fireEvent.change(date, { target: { value: '2026-07-04' } });

      expect(onTimelineSettingsChange).toHaveBeenLastCalledWith({
        ...defaultTrackWeatherTimelineSettings,
        hikeDate: '2026-07-04',
      });
      expect(onPreferencesChange).not.toHaveBeenCalled();
      expect(setSunShadow).toHaveBeenLastCalledWith({
        enabled: true,
        instantMs: Date.UTC(2026, 6, 4, 11, 30),
      });
      expect(date).toHaveValue('2026-07-04');
    });

    it('selects a date within the forecast week as the forecast date', () => {
      const { onPreferencesChange, onTimelineSettingsChange } = renderSection(
        expandedPreferences,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        hikeLighting,
      );
      const inWeek = forecastDates()[2];
      if (inWeek === undefined) throw new Error('Expected a forecast week.');

      fireEvent.change(screen.getByLabelText('Hike date'), {
        target: { value: inWeek },
      });

      expect(onPreferencesChange).toHaveBeenLastCalledWith({
        ...expandedPreferences,
        weekday: trackWeatherWeekday(inWeek),
      });
      expect(onTimelineSettingsChange).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Hike date')).toHaveValue(inWeek);
    });

    it('moves the hike date and map shadows with the forecast date until the track has its own', async () => {
      const user = userEvent.setup();
      mapLayerStore.setState((state) => ({
        sunShadow: {
          ...state.sunShadow,
          enabled: true,
          // 15:30 in Tbilisi.
          instantMs: Date.UTC(2026, 6, 18, 11, 30),
        },
      }));
      const { mapLayers } = services;
      if (mapLayers === null) throw new Error('Expected test map layers.');
      const setSunShadow = vi.spyOn(mapLayers, 'setSunShadow');
      const inWeek = forecastDates()[2];
      if (inWeek === undefined) throw new Error('Expected a forecast week.');
      renderSection(
        expandedPreferences,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        hikeLighting,
      );
      const forecastDay = within(
        screen.getByRole('group', { name: 'Forecast date' }),
      ).getAllByRole('button')[2];
      if (forecastDay === undefined) throw new Error('Expected forecast days.');

      await user.click(forecastDay);

      expect(screen.getByLabelText('Hike date')).toHaveValue(inWeek);
      expect(setSunShadow).toHaveBeenLastCalledWith({
        enabled: true,
        instantMs: Date.parse(`${inWeek}T11:30:00Z`),
      });
    });

    it('moves the map shadows to the hike date of an opened track', () => {
      mapLayerStore.setState((state) => ({
        sunShadow: {
          ...state.sunShadow,
          enabled: true,
          // 15:30 in Tbilisi.
          instantMs: Date.UTC(2026, 6, 18, 11, 30),
        },
      }));
      const { mapLayers } = services;
      if (mapLayers === null) throw new Error('Expected test map layers.');
      const setSunShadow = vi.spyOn(mapLayers, 'setSunShadow');

      renderSection(
        expandedPreferences,
        dayHike,
        { ...defaultTrackWeatherTimelineSettings, hikeDate: '2026-07-04' },
        hikeLighting,
      );

      expect(setSunShadow).toHaveBeenLastCalledWith({
        enabled: true,
        instantMs: Date.UTC(2026, 6, 4, 11, 30),
      });
    });

    it('moves the hike to a date picked for the map shadows', () => {
      const inWeek = forecastDates()[2];
      if (inWeek === undefined) throw new Error('Expected a forecast week.');
      const { onPreferencesChange, onTimelineSettingsChange } = renderSection(
        expandedPreferences,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        hikeLighting,
      );
      const pickMapDate = (date: string) => {
        act(() => {
          mapLayerStore.setState((state) => ({
            sunShadow: {
              ...state.sunShadow,
              instantMs: Date.parse(`${date}T11:30:00Z`),
            },
          }));
        });
      };

      pickMapDate(inWeek);

      expect(screen.getByLabelText('Hike date')).toHaveValue(inWeek);
      expect(onPreferencesChange).toHaveBeenLastCalledWith({
        ...expandedPreferences,
        weekday: trackWeatherWeekday(inWeek),
      });

      pickMapDate('2026-07-04');

      expect(onTimelineSettingsChange).toHaveBeenLastCalledWith({
        ...defaultTrackWeatherTimelineSettings,
        hikeDate: '2026-07-04',
      });
    });

    it('moves the map shadows to the time clicked on the sun graph', () => {
      const { mapLayers } = services;
      if (mapLayers === null) throw new Error('Expected test map layers.');
      const setSunShadow = vi.spyOn(mapLayers, 'setSunShadow');
      renderSection(
        expandedPreferences,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        hikeLighting,
      );
      const graph = screen.getByRole('img', {
        name: /^Sun elevation over the hike day/u,
      });
      vi.spyOn(graph, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 240, 96),
      );

      // Half-way across the local day: noon in Tbilisi (UTC+4).
      fireEvent.click(graph, { clientX: 120 });

      expect(setSunShadow).toHaveBeenLastCalledWith({
        enabled: mapLayerStore.getState().sunShadow.enabled,
        instantMs: Date.parse(`${hikeLighting.date}T08:00:00Z`),
      });
    });

    it('returns from a track date to today, which the forecast then shows', async () => {
      const user = userEvent.setup();
      const [today, , , later] = forecastDates();
      if (today === undefined || later === undefined) {
        throw new Error('Expected a forecast week.');
      }
      // The forecast shows a later day of the week until Today selects today.
      const preferences = {
        ...expandedPreferences,
        weekday: trackWeatherWeekday(later),
      };
      const { onPreferencesChange, onTimelineSettingsChange } = renderSection(
        preferences,
        dayHike,
        { ...defaultTrackWeatherTimelineSettings, hikeDate: '2026-07-04' },
        hikeLighting,
      );
      const todayButton = screen.getByRole('button', { name: 'Today' });
      expect(screen.getByLabelText('Hike date')).toHaveValue('2026-07-04');

      await user.click(todayButton);

      expect(onTimelineSettingsChange).toHaveBeenLastCalledWith({
        ...defaultTrackWeatherTimelineSettings,
        hikeDate: null,
      });
      expect(onPreferencesChange).toHaveBeenLastCalledWith({
        ...preferences,
        weekday: trackWeatherWeekday(today),
      });
      expect(screen.getByLabelText('Hike date')).toHaveValue(today);
      expect(todayButton).toBeDisabled();
    });

    it('picks the recording date of a recorded track', async () => {
      const user = userEvent.setup();
      const { onTimelineSettingsChange } = renderSection(
        null,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        { ...hikeLighting, recordedDate: '2026-07-04' },
      );
      const recording = screen.getByRole('button', { name: 'Recording date' });

      await user.click(recording);

      expect(onTimelineSettingsChange).toHaveBeenLastCalledWith({
        ...defaultTrackWeatherTimelineSettings,
        hikeDate: '2026-07-04',
      });
      expect(recording).toBeDisabled();
    });

    it('offers no recording date for a planned route', () => {
      renderSection(null, dayHike, defaultTrackWeatherTimelineSettings, hikeLighting);

      expect(
        screen.queryByRole('button', { name: 'Recording date' }),
      ).not.toBeInTheDocument();
    });

    it('lists the light kinds the hike meets one per row', () => {
      renderSection(
        null,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        lightingAroundSunset(-2 * 3_600_000, {
          status: 'ready',
          samples: [
            {
              distanceMeters: 0,
              elapsedSeconds: 0,
              sunlitFraction: 1,
              sunElevationDegrees: 30,
              skyView: 1,
              groundElevationMeters: 2_000,
            },
            {
              distanceMeters: 8_000,
              elapsedSeconds: 7_200,
              sunlitFraction: 1,
              sunElevationDegrees: 18,
              skyView: 1,
              groundElevationMeters: 2_000,
            },
            {
              distanceMeters: 8_000,
              elapsedSeconds: 7_200,
              sunlitFraction: 0,
              sunElevationDegrees: 18,
              skyView: 1,
              groundElevationMeters: 2_000,
            },
            {
              distanceMeters: 12_000,
              elapsedSeconds: 10_800,
              sunlitFraction: 0,
              sunElevationDegrees: 10,
              skyView: 1,
              groundElevationMeters: 2_000,
            },
          ],
        }),
      );

      // No blue hour or darkness: the hike ends two hours before sunset.
      expect(
        screen.getAllByRole('listitem').map((kind) => kind.textContent.trim()),
      ).toEqual([
        'In the sun 2h 0m',
        'In the shade 1h 0m (2h\u00a00m before sunset)',
        'Blue hour 0h 0m',
        'After dark 0h 0m',
      ]);
      expect(
        screen.getByRole('img', { name: /^Sun elevation over the hike day/u }),
      ).toBeInTheDocument();
    });

    it.each([
      [-90 * 60_000, 'Finishing 1h 30m before sunset.'],
      [75 * 60_000, 'Finishing 1h 15m after sunset.'],
    ])('relates a finish %i ms from sunset to it', (offsetMs, sentence) => {
      renderSection(
        null,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        lightingAroundSunset(offsetMs, { status: 'off' }),
      );

      expect(screen.getByText(sentence)).toBeVisible();
    });

    it('keeps four light rows while terrain light is calculated, without a finish sentence', () => {
      renderSection(
        null,
        dayHike,
        defaultTrackWeatherTimelineSettings,
        lightingAroundSunset(-90 * 60_000, { status: 'loading' }),
      );

      expect(screen.getAllByRole('listitem')).toHaveLength(4);
      expect(screen.queryByText(/^Finishing /u)).not.toBeInTheDocument();
    });

    it('replaces the start caption with the estimated pace under the sun graph', () => {
      renderSection(null, dayHike, defaultTrackWeatherTimelineSettings, hikeLighting);

      expect(screen.queryByText(/^Starting at/u)).not.toBeInTheDocument();
      expect(screen.getByText('Estimated pace')).toBeVisible();
      // finishMs − startMs of the fixture: 09:00 to 14:30.
      expect(screen.getByText('≈ 5h 30m')).toBeVisible();
    });

    describe('light strip', () => {
      const station = (
        distanceMeters: number,
        elapsedSeconds: number,
        sunlitFraction: number,
      ) => ({
        distanceMeters,
        elapsedSeconds,
        sunlitFraction,
        sunElevationDegrees: 30,
        skyView: 1,
        groundElevationMeters: 2_000,
      });
      // Sunlit for the first 6 km and 3 hours, fading into shade by the 14:30 finish.
      const litThenShaded: TrackLightingView = {
        ...hikeLighting,
        sunEvents: [
          {
            kind: 'sunset',
            instantMs: Date.UTC(2026, 6, 18, 9),
            distanceMeters: 9_000,
          },
        ],
        terrain: {
          status: 'ready',
          samples: [
            station(0, 0, 1),
            station(6_000, 10_800, 1),
            station(12_000, 19_800, 0),
          ],
        },
      };

      function renderStrip(): HTMLElement {
        renderSection(
          null,
          dayHike,
          defaultTrackWeatherTimelineSettings,
          litThenShaded,
        );
        const hoverArea = screen.getByRole('img', {
          name: /^Light along the route/u,
        }).parentElement;
        if (hoverArea === null) throw new Error('Expected the strip hover area.');
        vi.spyOn(hoverArea, 'getBoundingClientRect').mockReturnValue(
          new DOMRect(0, 0, 100, 12),
        );
        return hoverArea;
      }

      it('labels the strip with the clock hours of the hike and marks its sunset', () => {
        const hoverArea = renderStrip();
        const strip = hoverArea.parentElement;
        if (strip === null) throw new Error('Expected the strip.');

        // Whole Tbilisi hours from the 09:00 start to the 14:30 finish.
        expect(within(strip).getByText('09:00')).toBeInTheDocument();
        expect(within(strip).getByText('14:00')).toBeInTheDocument();
        expect(within(strip).queryByText(/ km$/u)).not.toBeInTheDocument();
        expect(
          within(strip).getByRole('img', { name: 'Sunset 13:00' }),
        ).toBeInTheDocument();
      });

      it('shows no strip without terrain light', () => {
        renderSection(null, dayHike, defaultTrackWeatherTimelineSettings, hikeLighting);

        expect(
          screen.queryByRole('img', { name: /^Light along the route/u }),
        ).not.toBeInTheDocument();
      });

      it('reads out the light under the pointer and traces its route point on the map', () => {
        const { mapLayers } = services;
        if (mapLayers === null) throw new Error('Expected test map layers.');
        const setTracePoint = vi.spyOn(mapLayers, 'setImportedTrackTracePoint');
        const hoverArea = renderStrip();

        // 40 % of the 5.5-hour hike: 2h 12m in, 4.4 km along, nearest the 4 km point.
        fireEvent.pointerMove(hoverArea, { clientX: 40 });

        expect(screen.getByText('11:12 · 4.4 km · In the sun')).toBeInTheDocument();
        expect(setTracePoint).toHaveBeenLastCalledWith(ridge.points[4]?.coordinate);

        fireEvent.pointerLeave(hoverArea);

        expect(screen.queryByText(/· In the sun$/u)).not.toBeInTheDocument();
        expect(setTracePoint).toHaveBeenLastCalledWith(null);
      });

      it('goes to the route point clicked on the strip', () => {
        const hoverArea = renderStrip();

        // 90 % of the hike is 10.68 km along, nearest the 11 km point.
        fireEvent.click(hoverArea, { clientX: 90 });

        const [longitude, latitude] = ridge.points[11]?.coordinate ?? [];
        expect(mapInteractionStore.getState().navigationCommand?.target).toEqual({
          longitude,
          latitude,
          zoom: 13,
        });
      });
    });
  });
});
