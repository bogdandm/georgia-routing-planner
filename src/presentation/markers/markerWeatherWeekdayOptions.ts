import type { MarkerWeatherWeekday } from '@/application/weather/MarkerWeatherForecast';

export const markerWeatherWeekdayOptions = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const satisfies readonly {
  readonly value: MarkerWeatherWeekday;
  readonly label: string;
}[];

export function markerWeatherWeekdayLabel(
  weekdays: readonly MarkerWeatherWeekday[],
): string {
  const selected = new Set(weekdays);
  return markerWeatherWeekdayOptions
    .filter((option) => selected.has(option.value))
    .map((option) => option.label)
    .join(', ');
}
