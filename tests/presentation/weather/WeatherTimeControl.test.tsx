import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import { WeatherTimeControl } from '@/presentation/weather/WeatherTimeControl';
import { createTestServices } from '@test/helpers/createTestServices';

describe('WeatherTimeControl', () => {
  beforeEach(() => {
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
        'Cloud cover · <30 transparent: 0 %, 30 %, 31 %, 50 %, 70 %, 90 %, 100 %',
      ),
    ).toBeVisible();
    expect(
      screen.getByLabelText(
        'Precipitation · <0.5 transparent: 0.5 mm, 1.5 mm, 2 mm, 3 mm, 7 mm, 10 mm, 20 mm, 30 mm',
      ),
    ).toBeVisible();
    expect(screen.getByText('Wind direction and speed')).toBeVisible();
  });
});
