import type { MarkerWeatherWeekday } from '@/application/weather/MarkerWeatherForecast';

/** Monday-first display order of the forecast weekday toggles. */
export const markerWeatherWeekdayOrder = [
  1, 2, 3, 4, 5, 6, 0,
] as const satisfies readonly MarkerWeatherWeekday[];

/**
 * Display-only weekday and day-month labels in `locale`. Forecast dates are calendar
 * dates (`YYYY-MM-DD`), so they are formatted in UTC to avoid local-offset shifts.
 */
export function createMarkerWeatherDateLabels(locale: string) {
  const weekdayFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const dayMonthFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return {
    /** Short name of a weekday index (0 = Sunday); 7 January 2024 was a Sunday. */
    weekday: (weekday: MarkerWeatherWeekday): string =>
      weekdayFormatter.format(Date.UTC(2024, 0, 7 + weekday)),
    date: (date: string): { readonly weekday: string; readonly dateLabel: string } => {
      const value = new Date(`${date}T00:00:00.000Z`);
      return {
        weekday: weekdayFormatter.format(value),
        dateLabel: dayMonthFormatter.format(value),
      };
    },
  };
}
