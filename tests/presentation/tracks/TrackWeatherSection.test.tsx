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

let services: ReturnType<typeof createTestServices>;

function renderSection(
  initial: TrackWeatherPreferences | null,
  metrics: TrackStatsMetrics = dayHike,
) {
  const onPreferencesChange = vi.fn();
  function Harness() {
    const [preferences, setPreferences] = useState(initial);
    return (
      <TrackWeatherSection
        profile={ridge}
        metrics={metrics}
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
          preferences={{ expanded: true, weekday: 6 }}
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

    expect(onPreferencesChange).toHaveBeenCalledWith({ expanded: true, weekday: 6 });
    expect(screen.getByRole('button', { name: /July 18/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const highest = screen.getByRole('group', { name: 'Highest, 2,900 m' });
    expect(
      await within(highest).findByRole('article', { name: 'Day forecast' }),
    ).toBeVisible();
    expect(
      within(highest).getByRole('article', { name: 'Night forecast' }),
    ).toBeVisible();
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

  it('remembers the weekday of a chosen forecast date', async () => {
    const user = userEvent.setup();
    const { onPreferencesChange } = renderSection({ expanded: true, weekday: 6 });

    await user.click(screen.getByRole('button', { name: /July 20/ }));

    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      expanded: true,
      weekday: 1,
    });
    expect(screen.getByRole('button', { name: /July 20/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('limits the route timeline to day hikes', () => {
    renderSection({ expanded: true, weekday: 6 }, { distanceMeters: 31_000 });

    expect(
      screen.getByText('Available for day hikes shorter than 30 km and 10 hours.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('list', { name: 'Forecast along the route' }),
    ).not.toBeInTheDocument();
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
    renderSection({ expanded: true, weekday: 6 });

    const highest = screen.getByRole('group', { name: 'Highest, 2,900 m' });
    expect(
      await within(highest).findByText('The forecast could not be loaded.'),
    ).toBeVisible();
  });
});
