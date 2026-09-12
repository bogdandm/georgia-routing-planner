import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  VisibilityStatus,
  WeatherIcon,
} from '@/domain/weather/aggregateWeatherPeriodStatus';
import {
  WeatherConditionIcon,
  WeatherPeriodIcon,
} from '@/presentation/weather/WeatherConditionIcon';
import { describeWmoWeatherCode } from '@/presentation/weather/weatherConditionLabels';

const normalVisibility: VisibilityStatus = {
  level: 'normal',
  period: 'none',
  label: null,
  icon: null,
};

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

function expectMeteoconArtwork(artwork: HTMLElement, name: string) {
  const images = artwork.querySelectorAll('img');
  expect(images).toHaveLength(1);
  const image = images[0];
  if (image === undefined) throw new Error('Expected one Meteocon image.');
  expect(image).toHaveAttribute(
    'src',
    expect.stringContaining(`/monochrome/${name}.svg`),
  );
  expect(image).toHaveAttribute('alt', '');
  expect(image).toHaveAttribute('aria-hidden', 'true');
  expect(artwork.querySelectorAll('svg')).toHaveLength(0);
}

describe('WeatherConditionIcon', () => {
  it.each(conditionCases)('describes WMO codes %j as %s', (codes, expected) => {
    for (const code of codes) expect(describeWmoWeatherCode(code)).toBe(expected);
  });

  it('uses a stable neutral description for unsupported WMO codes', () => {
    expect(describeWmoWeatherCode(-1)).toBe('Unknown weather');
    expect(describeWmoWeatherCode(100)).toBe('Unknown weather');
  });

  it.each([
    { codes: [0], isDay: true, name: 'clear-day' },
    { codes: [0], isDay: false, name: 'clear-night' },
    { codes: [1], isDay: true, name: 'mostly-clear-day' },
    { codes: [2], isDay: false, name: 'partly-cloudy-night' },
    { codes: [3], isDay: true, name: 'overcast-day' },
    { codes: [45, 48], isDay: false, name: 'fog-night' },
    { codes: [51, 53, 55], isDay: true, name: 'overcast-day-drizzle' },
    { codes: [56, 57], isDay: false, name: 'overcast-night-sleet' },
    { codes: [61, 63], isDay: true, name: 'overcast-day-rain' },
    { codes: [65, 82], isDay: false, name: 'extreme-night-rain' },
    { codes: [66], isDay: true, name: 'overcast-day-sleet' },
    { codes: [67], isDay: false, name: 'extreme-night-sleet' },
    { codes: [71, 73, 77], isDay: true, name: 'overcast-day-snow' },
    { codes: [75, 86], isDay: false, name: 'extreme-night-snow' },
    { codes: [80, 81], isDay: true, name: 'partly-cloudy-day-rain' },
    { codes: [85], isDay: false, name: 'partly-cloudy-night-snow' },
    { codes: [95], isDay: true, name: 'thunderstorms-day' },
    { codes: [96], isDay: false, name: 'thunderstorms-night-hail' },
    { codes: [99], isDay: false, name: 'extreme-thunderstorms-night-hail' },
    { codes: [100], isDay: true, name: 'not-available' },
  ])(
    'selects monochrome $name artwork for WMO codes $codes',
    ({ codes, isDay, name }) => {
      for (const code of codes) {
        const { unmount } = render(<WeatherConditionIcon code={code} isDay={isDay} />);
        expectMeteoconArtwork(
          screen.getByLabelText(describeWmoWeatherCode(code)),
          name,
        );
        unmount();
      }
    },
  );

  it.each([
    {
      icon: { sky: 'clear', phenomenon: null },
      isDay: true,
      label: 'Clear',
      name: 'clear-day',
    },
    {
      icon: { sky: 'mostly_clear', phenomenon: null },
      isDay: false,
      label: 'Mostly clear',
      name: 'mostly-clear-night',
    },
    {
      icon: { sky: 'partly_cloudy', phenomenon: null },
      isDay: true,
      label: 'Partly cloudy',
      name: 'partly-cloudy-day',
    },
    {
      icon: { sky: 'mostly_cloudy', phenomenon: null },
      isDay: false,
      label: 'Mostly cloudy',
      name: 'cloudy',
    },
    {
      icon: { sky: 'overcast', phenomenon: null },
      isDay: true,
      label: 'Overcast',
      name: 'overcast-day',
    },
    {
      icon: { sky: 'clear', phenomenon: 'isolated_showers' },
      isDay: true,
      label: 'Isolated showers',
      name: 'mostly-clear-day-rain',
    },
    {
      icon: { sky: 'partly_cloudy', phenomenon: 'snow_showers' },
      isDay: false,
      label: 'Snow showers',
      name: 'partly-cloudy-night-snow',
    },
    {
      icon: { sky: 'overcast', phenomenon: 'mixed' },
      isDay: true,
      label: 'Mixed precipitation',
      name: 'overcast-day-sleet',
    },
    {
      icon: { sky: 'mostly_clear', phenomenon: 'freezing' },
      isDay: false,
      label: 'Freezing precipitation',
      name: 'mostly-clear-night-sleet',
    },
    {
      icon: { sky: 'overcast', phenomenon: 'heavy_rain' },
      isDay: false,
      label: 'Heavy rain',
      name: 'extreme-night-rain',
    },
  ] satisfies readonly {
    readonly icon: WeatherIcon;
    readonly isDay: boolean;
    readonly label: string;
    readonly name: string;
  }[])('selects $name for $label', ({ icon, isDay, label, name }) => {
    render(
      <WeatherPeriodIcon
        icon={icon}
        visibility={normalVisibility}
        isDay={isDay}
        label={label}
      />,
    );

    expectMeteoconArtwork(screen.getByLabelText(label), name);
  });

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
      <WeatherPeriodIcon
        icon={{ sky: 'overcast', phenomenon: 'rain' }}
        visibility={normalVisibility}
        isDay
        label="Overcast with rain"
      />,
    );
    const icon = screen.getByLabelText('Overcast with rain');
    expectMeteoconArtwork(icon, 'overcast-day-rain');

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
      icon: { sky: 'clear', phenomenon: null },
      visibility: {
        level: 'fog',
        period: 'morning',
        label: 'Morning fog',
        icon: 'fog',
      },
      isDay: true,
      label: 'Morning fog',
      name: 'mostly-clear-day-fog',
    },
    {
      icon: { sky: 'mostly_clear', phenomenon: null },
      visibility: {
        level: 'haze',
        period: 'overnight',
        label: 'Reduced visibility overnight',
        icon: 'haze',
      },
      isDay: false,
      label: 'Reduced visibility overnight',
      name: 'mostly-clear-night-haze',
    },
    {
      icon: { sky: 'partly_cloudy', phenomenon: null },
      visibility: {
        level: 'fog',
        period: 'evening',
        label: 'Evening fog',
        icon: 'fog',
      },
      isDay: false,
      label: 'Evening fog',
      name: 'partly-cloudy-night-fog',
    },
    {
      icon: { sky: 'overcast', phenomenon: null },
      visibility: {
        level: 'haze',
        period: 'afternoon',
        label: 'Reduced visibility in the afternoon',
        icon: 'haze',
      },
      isDay: true,
      label: 'Reduced visibility in the afternoon',
      name: 'overcast-day-haze',
    },
    {
      icon: { sky: 'mostly_cloudy', phenomenon: null },
      visibility: {
        level: 'poor',
        period: 'most_of_period',
        label: 'Poor visibility for most of the day',
        icon: 'poor',
      },
      isDay: true,
      label: 'Poor visibility for most of the day',
      name: 'mist',
    },
  ] satisfies readonly {
    readonly icon: WeatherIcon;
    readonly visibility: VisibilityStatus;
    readonly isDay: boolean;
    readonly label: string;
    readonly name: string;
  }[])(
    'selects one monochrome $name for $label instead of layering status icons',
    ({ icon, visibility, isDay, label, name }) => {
      render(
        <WeatherPeriodIcon
          icon={icon}
          visibility={visibility}
          isDay={isDay}
          label={label}
        />,
      );

      expectMeteoconArtwork(screen.getByLabelText(label), name);
    },
  );

  it.each([
    {
      icon: { sky: 'clear', phenomenon: 'rain' },
      visibility: {
        level: 'fog',
        period: 'morning',
        label: 'Morning fog',
        icon: 'fog',
      },
      isDay: true,
      label: 'Rain',
      name: 'mostly-clear-day-rain',
    },
    {
      icon: { sky: 'partly_cloudy', phenomenon: 'snow' },
      visibility: {
        level: 'haze',
        period: 'overnight',
        label: 'Reduced visibility overnight',
        icon: 'haze',
      },
      isDay: false,
      label: 'Snow',
      name: 'partly-cloudy-night-snow',
    },
    {
      icon: { sky: 'overcast', phenomenon: 'mixed' },
      visibility: {
        level: 'poor',
        period: 'afternoon',
        label: 'Poor visibility in the afternoon',
        icon: 'poor',
      },
      isDay: true,
      label: 'Mixed precipitation',
      name: 'overcast-day-sleet',
    },
  ] satisfies readonly {
    readonly icon: WeatherIcon;
    readonly visibility: VisibilityStatus;
    readonly isDay: boolean;
    readonly label: string;
    readonly name: string;
  }[])(
    'keeps precipitation $name ahead of concurrent visibility status',
    ({ icon, visibility, isDay, label, name }) => {
      render(
        <WeatherPeriodIcon
          icon={icon}
          visibility={visibility}
          isDay={isDay}
          label={label}
        />,
      );

      expectMeteoconArtwork(screen.getByLabelText(label), name);
    },
  );
});
