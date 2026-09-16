import {
  summarizeWeatherPeriod,
  type PointWeatherForecast,
  type PointWeatherForecastPeriod,
} from '@/application/weather/GetPointWeatherForecast';
import type { HourlyWeatherForecast } from '@/application/ports/WeatherForecastGateway';
import type { WeatherPeriodKind } from '@/domain/weather/aggregateWeatherPeriodStatus';

export const markerWeatherWeekdays = [0, 1, 2, 3, 4, 5, 6] as const;

export type MarkerWeatherWeekday = (typeof markerWeatherWeekdays)[number];

export type MarkerWeatherPeriodSelection =
  | { readonly kind: 'day' }
  | { readonly kind: 'night' }
  | {
      readonly kind: 'custom';
      readonly startHour: number;
      readonly endHour: number;
    };

export interface WeatherIntervalPreferences {
  readonly weekdays: readonly MarkerWeatherWeekday[];
  readonly period: MarkerWeatherPeriodSelection;
  readonly showOnMap: boolean;
}

export const defaultWeatherIntervalPreferences: WeatherIntervalPreferences = {
  weekdays: [6, 0],
  period: { kind: 'day' },
  showOnMap: true,
};

export interface MarkerWeatherForecastPeriod {
  readonly date: string;
  readonly isDay: boolean;
  readonly period: PointWeatherForecastPeriod;
}

export interface MarkerWeatherForecast {
  readonly periods: readonly MarkerWeatherForecastPeriod[];
  readonly isDay: boolean;
  readonly period: PointWeatherForecastPeriod;
}

function nextLocalDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function weekdayForLocalDate(date: string): MarkerWeatherWeekday {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (!markerWeatherWeekdays.includes(weekday as MarkerWeatherWeekday)) {
    throw new RangeError(`Invalid local forecast date: ${date}`);
  }
  return weekday as MarkerWeatherWeekday;
}

function nightHours(
  hourly: readonly HourlyWeatherForecast[],
  date: string,
): readonly HourlyWeatherForecast[] {
  const currentDaylight = hourly.filter(
    (hour) => hour.time.startsWith(`${date}T`) && hour.isDay,
  );
  const followingDate = nextLocalDate(date);
  const followingDaylight = hourly.filter(
    (hour) => hour.time.startsWith(`${followingDate}T`) && hour.isDay,
  );
  const lastDaylight = currentDaylight.at(-1);
  const firstFollowingDaylight = followingDaylight[0];
  if (lastDaylight === undefined || firstFollowingDaylight === undefined) return [];
  return hourly.filter(
    (hour) =>
      (!hour.isDay &&
        hour.time.startsWith(`${date}T`) &&
        hour.time > lastDaylight.time) ||
      (!hour.isDay &&
        hour.time.startsWith(`${followingDate}T`) &&
        hour.time < firstFollowingDaylight.time),
  );
}

function customHours(
  hourly: readonly HourlyWeatherForecast[],
  date: string,
  startHour: number,
  endHour: number,
): readonly HourlyWeatherForecast[] {
  const start = `${date}T${String(startHour).padStart(2, '0')}:00`;
  const endDate = endHour <= startHour ? nextLocalDate(date) : date;
  const end = `${endDate}T${String(endHour).padStart(2, '0')}:00`;
  return hourly.filter((hour) => hour.time >= start && hour.time < end);
}

function selectedHours(
  forecast: PointWeatherForecast,
  date: string,
  selection: MarkerWeatherPeriodSelection,
): readonly HourlyWeatherForecast[] {
  switch (selection.kind) {
    case 'day':
      return forecast.hourly.filter(
        (hour) => hour.time.startsWith(`${date}T`) && hour.isDay,
      );
    case 'night':
      return nightHours(forecast.hourly, date);
    case 'custom':
      return customHours(forecast.hourly, date, selection.startHour, selection.endHour);
  }
}

/** Selects and summarizes the next occurrences of configured local weekdays. */
export function selectMarkerWeatherForecast(
  forecast: PointWeatherForecast,
  preferences: WeatherIntervalPreferences,
): MarkerWeatherForecast | null {
  if (preferences.weekdays.length === 0) return null;
  const selectedWeekdays = new Set(preferences.weekdays);
  const periods: MarkerWeatherForecastPeriod[] = [];
  const allHours: HourlyWeatherForecast[] = [];

  for (const day of forecast.days) {
    if (!selectedWeekdays.has(weekdayForLocalDate(day.date))) continue;
    const hours = selectedHours(forecast, day.date, preferences.period);
    if (hours.length === 0) {
      throw new RangeError(`Forecast period ${day.date} has no hourly samples.`);
    }
    const isDay =
      preferences.period.kind === 'day'
        ? true
        : preferences.period.kind === 'night'
          ? false
          : hours.filter((hour) => hour.isDay).length * 2 >= hours.length;
    const kind: WeatherPeriodKind =
      preferences.period.kind === 'custom'
        ? isDay
          ? 'day'
          : 'night'
        : preferences.period.kind;
    periods.push({
      date: day.date,
      isDay,
      period: summarizeWeatherPeriod(hours, kind),
    });
    allHours.push(...hours);
  }

  if (periods.length !== preferences.weekdays.length || allHours.length === 0) {
    throw new RangeError('The forecast does not cover every selected weekday.');
  }
  const isDay =
    preferences.period.kind === 'day'
      ? true
      : preferences.period.kind === 'night'
        ? false
        : allHours.filter((hour) => hour.isDay).length * 2 >= allHours.length;
  const kind: WeatherPeriodKind =
    preferences.period.kind === 'custom'
      ? isDay
        ? 'day'
        : 'night'
      : preferences.period.kind;
  return {
    periods,
    isDay,
    period: summarizeWeatherPeriod(allHours, kind),
  };
}
