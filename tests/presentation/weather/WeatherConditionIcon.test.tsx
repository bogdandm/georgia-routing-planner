import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WeatherIcon } from '@/domain/weather/aggregateDailyWeatherStatus';
import {
  DailyWeatherIcon,
  WeatherConditionIcon,
} from '@/presentation/weather/WeatherConditionIcon';
import { describeWmoWeatherCode } from '@/presentation/weather/weatherConditionLabels';

const conditionCases: readonly [readonly number[], string][] = [
  [[0], 'Clear sky'],
  [[1], 'Mainly clear'],
  [[2], 'Partly cloudy'],
  [[3], 'Overcast'],
  [[45], 'Fog'],
  [[48], 'Depositing rime fog'],
  [[51], 'Light drizzle'],
  [[53], 'Moderate drizzle'],
  [[55], 'Dense drizzle'],
  [[56], 'Light freezing drizzle'],
  [[57], 'Dense freezing drizzle'],
  [[61], 'Slight rain'],
  [[63], 'Moderate rain'],
  [[65], 'Heavy rain'],
  [[66], 'Light freezing rain'],
  [[67], 'Heavy freezing rain'],
  [[71], 'Slight snow'],
  [[73], 'Moderate snow'],
  [[75], 'Heavy snow'],
  [[77], 'Snow grains'],
  [[80], 'Slight rain showers'],
  [[81], 'Moderate rain showers'],
  [[82], 'Violent rain showers'],
  [[85], 'Slight snow showers'],
  [[86], 'Heavy snow showers'],
  [[95], 'Thunderstorm'],
  [[96, 99], 'Thunderstorm with hail'],
];

describe('WeatherConditionIcon', () => {
  it.each(conditionCases)('describes WMO codes %j as %s', (codes, expected) => {
    for (const code of codes) expect(describeWmoWeatherCode(code)).toBe(expected);
  });

  it('uses a stable neutral description for unsupported WMO codes', () => {
    expect(describeWmoWeatherCode(-1)).toBe('Unknown weather');
    expect(describeWmoWeatherCode(100)).toBe('Unknown weather');
  });

  it.each([
    { isDay: true, label: 'Daytime clear sky' },
    { isDay: false, label: 'Night-time clear sky' },
  ])('keeps $label artwork decorative beside its text label', ({ isDay, label }) => {
    render(
      <div aria-label={label}>
        <WeatherConditionIcon code={0} isDay={isDay} />
      </div>,
    );

    expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each([
    {
      label: 'Partly cloudy with rain and fog',
      icon: { sky: 'partly_cloudy', phenomenon: 'rain', visibility: 'fog' },
    },
    {
      label: 'Overcast with mixed precipitation and poor visibility',
      icon: { sky: 'overcast', phenomenon: 'mixed', visibility: 'poor' },
    },
    {
      label: 'Mostly clear with freezing precipitation and haze',
      icon: { sky: 'mostly_clear', phenomenon: 'freezing', visibility: 'haze' },
    },
  ] satisfies readonly { readonly label: string; readonly icon: WeatherIcon }[])(
    'keeps layered artwork decorative for $label',
    ({ label, icon }) => {
      render(
        <div aria-label={label}>
          <DailyWeatherIcon icon={icon} />
        </div>,
      );

      expect(screen.getByLabelText(label)).toBeInTheDocument();
      expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    },
  );
});
