import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  VisibilityStatus,
  WeatherIcon,
} from '@/domain/weather/aggregateDailyWeatherStatus';
import {
  DailyWeatherIcon,
  VisibilityStatusIcon,
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
    { isDay: true, label: 'Clear sky' },
    { isDay: false, label: 'Clear sky' },
  ])('labels $label artwork while keeping its SVG decorative', ({ isDay, label }) => {
    render(<WeatherConditionIcon code={0} isDay={isDay} />);

    expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each([
    {
      label: 'Partly cloudy with rain',
      icon: { sky: 'partly_cloudy', phenomenon: 'rain' },
    },
    {
      label: 'Overcast with mixed precipitation',
      icon: { sky: 'overcast', phenomenon: 'mixed' },
    },
    {
      label: 'Mostly clear with freezing precipitation',
      icon: { sky: 'mostly_clear', phenomenon: 'freezing' },
    },
  ] satisfies readonly { readonly label: string; readonly icon: WeatherIcon }[])(
    'labels layered artwork as $label',
    ({ label, icon }) => {
      render(<DailyWeatherIcon icon={icon} label={label} />);

      expect(screen.getByLabelText(label)).toBeInTheDocument();
      expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    },
  );

  it('shows condition details on mouse hover', async () => {
    render(<WeatherConditionIcon code={63} isDay />);
    const icon = screen.getByLabelText('Moderate rain');

    fireEvent.mouseOver(icon);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Moderate rain');

    fireEvent.mouseLeave(icon);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('toggles daily details when tapped on a touch screen', async () => {
    render(
      <DailyWeatherIcon
        icon={{ sky: 'overcast', phenomenon: 'rain' }}
        label="Overcast with rain"
      />,
    );
    const icon = screen.getByLabelText('Overcast with rain');

    fireEvent.pointerDown(icon, { pointerType: 'touch' });
    fireEvent.pointerUp(icon, { pointerType: 'touch' });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Overcast with rain');

    fireEvent.pointerDown(icon, { pointerType: 'touch' });
    fireEvent.pointerUp(icon, { pointerType: 'touch' });
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it.each([
    {
      level: 'fog',
      period: 'morning',
      label: 'Morning fog',
      icon: 'fog',
    },
    {
      level: 'poor',
      period: 'afternoon',
      label: 'Poor visibility in the afternoon',
      icon: 'poor',
    },
    {
      level: 'haze',
      period: 'intermittent',
      label: 'Intermittent reduced visibility',
      icon: 'haze',
    },
  ] satisfies readonly VisibilityStatus[])(
    'labels the secondary $level visibility icon independently',
    (status) => {
      render(<VisibilityStatusIcon status={status} />);

      expect(screen.getByLabelText(status.label)).toBeInTheDocument();
      expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    },
  );
});
