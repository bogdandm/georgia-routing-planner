import { beforeEach, describe, expect, it } from 'vitest';

import type {
  Precipitation,
  Sky,
  VisibilityStatus,
  WeatherPeriodKind,
} from '@/domain/weather/aggregateWeatherPeriodStatus';
import { activateAppLocale, appI18n } from '@/presentation/localization/appI18n';
import {
  describeWeatherPeriodCondition,
  describeWeatherVisibility,
} from '@/presentation/weather/weatherConditionLabels';

function condition(sky: Sky, precipitation: Precipitation): string {
  return appI18n._(
    describeWeatherPeriodCondition({
      sky,
      precipitation,
      icon: { sky, phenomenon: precipitation === 'none' ? null : precipitation },
    }),
  );
}

function visibility(
  level: VisibilityStatus['level'],
  period: VisibilityStatus['period'],
  periodKind: WeatherPeriodKind,
): string | null {
  const message = describeWeatherVisibility({
    periodKind,
    visibility: { level, period, icon: level === 'normal' ? null : level },
  });
  return message === null ? null : appI18n._(message);
}

describe('weather period descriptions', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it.each<[Sky, Precipitation, string]>([
    ['mostly_clear', 'none', 'Mostly clear'],
    ['clear', 'isolated_showers', 'Clear with isolated showers'],
    ['partly_cloudy', 'showers', 'Partly cloudy with showers'],
    ['clear', 'occasional_rain', 'Mostly clear with occasional rain'],
    ['overcast', 'occasional_rain', 'Overcast with occasional rain'],
    ['partly_cloudy', 'rain', 'Rain with sunny intervals'],
    ['mostly_cloudy', 'rain', 'Rain'],
    ['overcast', 'mixed', 'Rain and snow'],
    ['overcast', 'freezing', 'Freezing precipitation'],
  ])('describes %s sky with %s precipitation as %s', (sky, precipitation, expected) => {
    expect(condition(sky, precipitation)).toBe(expected);
  });

  it.each<
    [VisibilityStatus['level'], VisibilityStatus['period'], WeatherPeriodKind, string]
  >([
    ['fog', 'morning', 'day', 'Morning fog'],
    ['fog', 'overnight', 'night', 'Fog overnight'],
    ['fog', 'most_of_period', 'current', 'Fog for most of the interval'],
    ['poor', 'afternoon', 'day', 'Poor visibility in the afternoon'],
    ['haze', 'brief', 'day', 'Brief reduced visibility'],
    ['poor', 'intermittent', 'night', 'Intermittent reduced visibility'],
    ['haze', 'most_of_period', 'night', 'Reduced visibility for most of the night'],
  ])(
    'describes %s visibility during %s (%s) as %s',
    (level, period, kind, expected) => {
      expect(visibility(level, period, kind)).toBe(expected);
    },
  );

  it('omits a description for normal visibility', () => {
    expect(visibility('normal', 'none', 'day')).toBeNull();
  });
});
