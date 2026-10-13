import { ThemeProvider } from '@mui/material';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PointWeatherForecastError } from '@/application/ports/WeatherForecastGateway';
import type { TrackWeatherPreferences } from '@/application/weather/TrackWeatherForecast';
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
import { useUiStore } from '@/presentation/shell/uiStore';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { TrackWeatherSection } from '@/presentation/tracks/TrackWeatherSection';
import type { TrackStatsMetrics } from '@/presentation/tracks/TrackSummary';
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

const dayHike: TrackStatsMetrics = {
  distanceMeters: 12_000,
  estimatedSeconds: 5.5 * 3_600,
};

const expandedPreferences: TrackWeatherPreferences = {
  expanded: true,
  weekday: 6,
  timelines: {},
};

let services: ReturnType<typeof createTestServices>;

function renderSection(
  initial: TrackWeatherPreferences | null,
  metrics: TrackStatsMetrics = dayHike,
  savedTrackId: string | null = null,
) {
  const onPreferencesChange = vi.fn();
  function Harness() {
    const [preferences, setPreferences] = useState(initial);
    return (
      <TrackWeatherSection
        profile={ridge}
        metrics={metrics}
        savedTrackId={savedTrackId}
        preferences={preferences}
        onPreferencesChange={(next) => {
          onPreferencesChange(next);
          setPreferences(next);
        }}
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
  return { onPreferencesChange };
}

function expandedSection(metrics: TrackStatsMetrics) {
  return (
    <RuntimeServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <TrackWeatherSection
          profile={ridge}
          metrics={metrics}
          savedTrackId={null}
          preferences={expandedPreferences}
          onPreferencesChange={vi.fn()}
        />
      </ThemeProvider>
    </RuntimeServicesProvider>
  );
}

beforeEach(() => {
  activateAppLocale('en');
  services = createTestServices();
});

describe('TrackWeatherSection', () => {
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
    const highest = screen.getByRole('group', { name: 'Highest, 2,900 m' });
    expect(
      await within(highest).findByRole('article', { name: 'Day forecast' }),
    ).toBeVisible();
    expect(
      within(highest).queryByRole('article', { name: 'Night forecast' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Lowest, 2,000 m' })).toBeVisible();
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
      '09:00, Start, 2,000 m',
      '12:00, At 4.8 km, 2,720 m',
      '14:30, Finish, 2,400 m',
    ]);
    expect(
      await within(route).findAllByRole('article', { name: /forecast$/ }),
    ).toHaveLength(3);
    // Three elevation points plus three checkpoints; the start is also the lowest point.
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('opens the full forecast at a clicked location in Weather', async () => {
    resetMapInteractionStore();
    const user = userEvent.setup();
    renderSection(expandedPreferences);

    await user.click(
      await screen.findByRole('button', {
        name: 'Open the forecast for 12:00, At 4.8 km, 2,720 m in Weather',
      }),
    );

    const request = mapInteractionStore.getState().weatherForecastRequest;
    expect(request?.placeLabel).toBe('12:00, At 4.8 km');
    expect(request?.elevationMeters).toBeCloseTo(2_720, 6);
    expect(request?.coordinate.longitude).toBeCloseTo(44.048, 6);
    expect(useUiStore.getState().activeTab).toBe('weather');
    expect(window.location.hash).toBe('#weather');
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

  it('limits the route timeline and its start and pace adjustments to day hikes', () => {
    renderSection(expandedPreferences, { distanceMeters: 31_000 });

    expect(
      screen.getByText('Available for day hikes shorter than 30 km and 12 hours.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('list', { name: 'Forecast along the route' }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole('slider')).toEqual([]);
  });

  it('moves the route forecast to a chosen start time above the pace control', async () => {
    const user = userEvent.setup();
    const { onPreferencesChange } = renderSection(expandedPreferences);
    const route = screen.getByRole('list', { name: 'Forecast along the route' });
    const labels = () =>
      within(route)
        .getAllByRole('group')
        .map((card) => card.getAttribute('aria-label'));

    const sliders = screen.getAllByRole('slider');
    expect(sliders.map((slider) => slider.getAttribute('aria-labelledby'))).toEqual([
      screen.getByText('Route start').id,
      screen.getByText('Adjust pace').id,
    ]);
    const start = screen.getByRole('slider', { name: 'Route start' });
    expect(start).toHaveAttribute('aria-valuetext', '09:00');

    start.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');

    expect(start).toHaveAttribute('aria-valuetext', '10:30');
    expect(labels()).toEqual([
      '10:30, Start, 2,000 m',
      '13:30, At 4.8 km, 2,720 m',
      '16:00, Finish, 2,400 m',
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
    expect(labels()[2]).toBe('05:00, Finish, 2,400 m');
    // An unsaved track keeps its start time only in the open section.
    expect(onPreferencesChange).not.toHaveBeenCalled();
  });

  it('restores and remembers the start time and pace of a saved track', async () => {
    const user = userEvent.setup();
    const other = { startHour: 6, paceFactor: 1.5 };
    const { onPreferencesChange } = renderSection(
      {
        ...expandedPreferences,
        timelines: {
          'local:other': other,
          'local:ridge': { startHour: 7, paceFactor: 2 },
        },
      },
      dayHike,
      'local:ridge',
    );
    const start = screen.getByRole('slider', { name: 'Route start' });
    const pace = screen.getByRole('slider', { name: 'Adjust pace' });
    expect(start).toHaveAttribute('aria-valuetext', '07:00');
    expect(pace).toHaveAttribute('aria-valuetext', '×2');
    expect(
      screen.getByText(
        'Starting at 07:00 at the adjusted pace, about 11h 0m in total.',
      ),
    ).toBeVisible();

    start.focus();
    await user.keyboard('{ArrowRight}');
    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      ...expandedPreferences,
      timelines: {
        'local:other': other,
        'local:ridge': { startHour: 7.5, paceFactor: 2 },
      },
    });

    // Back at the defaults the track's entry is dropped; other tracks keep theirs.
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    pace.focus();
    await user.keyboard('{Home}');
    await user.keyboard(Array.from({ length: 10 }, () => '{ArrowRight}').join(''));
    expect(pace).toHaveAttribute('aria-valuetext', '×1');
    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      ...expandedPreferences,
      timelines: { 'local:other': other },
    });
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

    const highest = screen.getByRole('group', { name: 'Highest, 2,900 m' });
    expect(
      await within(highest).findByRole('article', { name: 'Day forecast' }),
    ).toBeVisible();
  });

  it('reports a forecast that cannot be loaded at its location', async () => {
    vi.spyOn(services.pointWeatherForecast, 'execute').mockRejectedValue(
      new PointWeatherForecastError('provider-unavailable', 'Unavailable.'),
    );
    renderSection(expandedPreferences);

    const highest = screen.getByRole('group', { name: 'Highest, 2,900 m' });
    expect(
      await within(highest).findByText('The forecast could not be loaded.'),
    ).toBeVisible();
  });
});
