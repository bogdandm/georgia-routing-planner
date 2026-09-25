import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import {
  requestWeatherForecast,
  resetMapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import { WeatherTimeControl } from '@/presentation/weather/WeatherTimeControl';
import { createTestServices } from '@test/helpers/createTestServices';

describe('WeatherTimeControl', () => {
  beforeEach(() => {
    resetMapInteractionStore();
    resetMapLayerStore();
  });

  it('shows the rendering thresholds used for cloud cover and precipitation', () => {
    const weatherMap = mapLayerStore.getState().weatherMap;
    mapLayerStore.setState({
      weatherMap: {
        ...weatherMap,
        enabled: true,
        status: 'ready',
        validTimes: ['2026-09-25T06:00Z', '2026-09-25T12:00Z'],
        selectedTimeIndex: 0,
      },
    });

    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <WeatherTimeControl />
      </RuntimeServicesProvider>,
    );

    expect(screen.getByLabelText('Weather map legend')).toBeVisible();
    expect(
      screen.getByLabelText(
        'Cloud cover · ≤30 transparent: 0 %, 30 %, 31 %, 50 %, 70 %, 90 %, 100 %',
      ),
    ).toBeVisible();
    expect(
      screen.getByLabelText(
        'Precipitation · ≤0.5 transparent: 0.5 mm, 1.5 mm, 2 mm, 3 mm, 7 mm, 10 mm, 20 mm, 30 mm',
      ),
    ).toBeVisible();
    expect(screen.getByText('Wind direction and speed')).toBeVisible();
    const windyLink = screen.getByRole('link', { name: 'Windy' });
    expect(windyLink).toHaveAttribute('href', 'https://www.windy.com/');
    expect(windyLink.parentElement).toHaveTextContent(
      'Low-resolution data. Use Windy for a precise forecast.',
    );
  });

  it('groups and labels frames in the selected location time zone', () => {
    const firstValidTime = '2026-09-25T01:00:00Z';
    const secondValidTime = '2026-09-25T07:00:00Z';
    requestWeatherForecast({ longitude: -74.006, latitude: 40.7128 });
    const weatherMap = mapLayerStore.getState().weatherMap;
    mapLayerStore.setState({
      weatherMap: {
        ...weatherMap,
        enabled: true,
        status: 'ready',
        validTimes: [firstValidTime, secondValidTime],
        selectedTimeIndex: 0,
      },
    });

    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <WeatherTimeControl />
      </RuntimeServicesProvider>,
    );

    const timeZone = 'America/New_York';
    const dayFormatter = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone,
    });
    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    });
    expect(
      screen.getByRole('button', {
        name: dayFormatter.format(new Date(firstValidTime)),
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: dayFormatter.format(new Date(secondValidTime)),
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: timeFormatter.format(new Date(firstValidTime)),
      }),
    ).toBeVisible();
  });
});
