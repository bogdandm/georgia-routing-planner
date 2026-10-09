import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/**
 * Display-only weather formatting; pass `i18n` from `useLingui()` so numbers and units
 * follow the active locale.
 */
function formatWeatherNumber(value: number, i18n: I18n, fractionDigits = 0): string {
  return new Intl.NumberFormat(i18n.locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Rounds to a whole number; `+ 0` turns a rounded `-0` into `0` so no `-0` is shown. */
function formatWholeWeatherNumber(value: number, i18n: I18n): string {
  return formatWeatherNumber(Math.round(value) + 0, i18n);
}

export function formatWeatherMillimetresValue(value: number, i18n: I18n): string {
  if (value === 0) return formatWeatherNumber(0, i18n);
  return value < 10
    ? formatWeatherNumber(value, i18n, 1)
    : formatWholeWeatherNumber(value, i18n);
}

export function formatWeatherWindMetresPerSecond(value: number, i18n: I18n): string {
  return formatWholeWeatherNumber(value, i18n);
}

export function formatWeatherVisibilityKilometres(
  valueInMeters: number,
  i18n: I18n,
): string {
  return formatWholeWeatherNumber(valueInMeters / 1_000, i18n);
}

export function formatWeatherMillimetres(value: number, i18n: I18n): string {
  const millimetres = formatWeatherMillimetresValue(value, i18n);
  return i18n._(msg`${millimetres} mm`);
}

export function formatWeatherTemperatureRange(
  minimumCelsius: number,
  maximumCelsius: number,
  i18n: I18n,
): string {
  const minimum = formatWholeWeatherNumber(minimumCelsius, i18n);
  const maximum = formatWholeWeatherNumber(maximumCelsius, i18n);
  return minimum === maximum
    ? i18n._(msg`${minimum} °C`)
    : i18n._(msg`${minimum}…${maximum} °C`);
}
