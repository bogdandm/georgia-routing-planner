import type { MessageDescriptor } from '@lingui/core';
import { msg, select } from '@lingui/core/macro';

import type {
  Sky,
  WeatherPeriodStatus,
} from '@/domain/weather/aggregateWeatherPeriodStatus';

/** WMO weather-code description; render it with `i18n._()` or `t()` from `useLingui()`. */
export function describeWmoWeatherCode(code: number): MessageDescriptor {
  if (code === 0) return msg`Clear sky`;
  if (code === 1) return msg`Mainly clear`;
  if (code === 2) return msg`Partly cloudy`;
  if (code === 3) return msg`Overcast`;
  if (code === 45) return msg`Fog`;
  if (code === 48) return msg`Depositing rime fog`;
  if (code === 51) return msg`Light drizzle`;
  if (code === 53) return msg`Moderate drizzle`;
  if (code === 55) return msg`Dense drizzle`;
  if (code === 56) return msg`Light freezing drizzle`;
  if (code === 57) return msg`Dense freezing drizzle`;
  if (code === 61) return msg`Slight rain`;
  if (code === 63) return msg`Moderate rain`;
  if (code === 65) return msg`Heavy rain`;
  if (code === 66) return msg`Light freezing rain`;
  if (code === 67) return msg`Heavy freezing rain`;
  if (code === 71) return msg`Slight snow`;
  if (code === 73) return msg`Moderate snow`;
  if (code === 75) return msg`Heavy snow`;
  if (code === 77) return msg`Snow grains`;
  if (code === 80) return msg`Slight rain showers`;
  if (code === 81) return msg`Moderate rain showers`;
  if (code === 82) return msg`Violent rain showers`;
  if (code === 85) return msg`Slight snow showers`;
  if (code === 86) return msg`Heavy snow showers`;
  if (code === 95) return msg`Thunderstorm`;
  if (code === 96 || code === 99) return msg`Thunderstorm with hail`;
  return msg`Unknown weather`;
}

// ICU `select` keys below are domain classification tokens; `other` covers the last
// member of each union so every branch is a complete sentence.
function skyWithPrecipitationMessage(
  sky: Sky,
  precipitation: 'isolated_showers' | 'showers' | 'occasional_rain',
): MessageDescriptor {
  switch (precipitation) {
    case 'isolated_showers':
      return msg`${select(sky, {
        clear: 'Clear with isolated showers',
        mostly_clear: 'Mostly clear with isolated showers',
        partly_cloudy: 'Partly cloudy with isolated showers',
        mostly_cloudy: 'Mostly cloudy with isolated showers',
        other: 'Overcast with isolated showers',
      })}`;
    case 'showers':
      return msg`${select(sky, {
        clear: 'Clear with showers',
        mostly_clear: 'Mostly clear with showers',
        partly_cloudy: 'Partly cloudy with showers',
        mostly_cloudy: 'Mostly cloudy with showers',
        other: 'Overcast with showers',
      })}`;
    case 'occasional_rain':
      // A clear sky with rain reads as mostly clear.
      return msg`${select(sky, {
        clear: 'Mostly clear with occasional rain',
        mostly_clear: 'Mostly clear with occasional rain',
        partly_cloudy: 'Partly cloudy with occasional rain',
        mostly_cloudy: 'Mostly cloudy with occasional rain',
        other: 'Overcast with occasional rain',
      })}`;
  }
}

/** Primary sky-and-precipitation description of an aggregated forecast period. */
export function describeWeatherPeriodCondition(
  primary: WeatherPeriodStatus['primary'],
): MessageDescriptor {
  const { precipitation, sky } = primary;
  switch (precipitation) {
    case 'none':
      return msg`${select(sky, {
        clear: 'Clear',
        mostly_clear: 'Mostly clear',
        partly_cloudy: 'Partly cloudy',
        mostly_cloudy: 'Mostly cloudy',
        other: 'Overcast',
      })}`;
    case 'isolated_showers':
    case 'showers':
    case 'occasional_rain':
      return skyWithPrecipitationMessage(sky, precipitation);
    case 'rain':
      return sky === 'clear' || sky === 'mostly_clear' || sky === 'partly_cloudy'
        ? msg`Rain with sunny intervals`
        : msg`Rain`;
    case 'heavy_rain':
      return msg`Heavy rain`;
    case 'snow_showers':
      return msg`Snow showers`;
    case 'occasional_snow':
      return msg`Occasional snow`;
    case 'snow':
      return msg`Snow`;
    case 'mixed':
      return msg`Rain and snow`;
    case 'freezing':
      return msg`Freezing precipitation`;
  }
}

/** Reduced-visibility description, or `null` when visibility is normal. */
export function describeWeatherVisibility(
  status: Pick<WeatherPeriodStatus, 'periodKind' | 'visibility'>,
): MessageDescriptor | null {
  const { level, period } = status.visibility;
  const { periodKind } = status;
  if (level === 'normal' || period === 'none') return null;
  if (level === 'fog') {
    switch (period) {
      case 'brief':
        return msg`Brief fog`;
      case 'morning':
        return msg`Morning fog`;
      case 'afternoon':
        return msg`Afternoon fog`;
      case 'evening':
        return msg`Evening fog`;
      case 'overnight':
        return msg`Fog overnight`;
      case 'intermittent':
        return msg`Intermittent fog`;
      case 'most_of_period':
        return msg`${select(periodKind, {
          current: 'Fog for most of the interval',
          day: 'Fog for most of the day',
          other: 'Fog for most of the night',
        })}`;
    }
  }
  // `poor` reads as poor visibility; `haze` as reduced visibility.
  switch (period) {
    case 'brief':
      return msg`${select(level, {
        poor: 'Brief poor visibility',
        other: 'Brief reduced visibility',
      })}`;
    case 'morning':
      return msg`${select(level, {
        poor: 'Poor visibility in the morning',
        other: 'Reduced visibility in the morning',
      })}`;
    case 'afternoon':
      return msg`${select(level, {
        poor: 'Poor visibility in the afternoon',
        other: 'Reduced visibility in the afternoon',
      })}`;
    case 'evening':
      return msg`${select(level, {
        poor: 'Poor visibility in the evening',
        other: 'Reduced visibility in the evening',
      })}`;
    case 'overnight':
      return msg`${select(level, {
        poor: 'Poor visibility overnight',
        other: 'Reduced visibility overnight',
      })}`;
    case 'intermittent':
      return msg`Intermittent reduced visibility`;
    case 'most_of_period':
      return level === 'poor'
        ? msg`${select(periodKind, {
            current: 'Poor visibility for most of the interval',
            day: 'Poor visibility for most of the day',
            other: 'Poor visibility for most of the night',
          })}`
        : msg`${select(periodKind, {
            current: 'Reduced visibility for most of the interval',
            day: 'Reduced visibility for most of the day',
            other: 'Reduced visibility for most of the night',
          })}`;
  }
}
