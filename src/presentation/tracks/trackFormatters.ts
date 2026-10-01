import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/** Display-only track formatting; pass `i18n` from `useLingui()` so output follows the active locale. */
export function formatTrackDistance(meters: number, i18n: I18n): string {
  const fractionDigits = meters < 10_000 ? 1 : 0;
  const distance = new Intl.NumberFormat(i18n.locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(meters / 1_000);
  return i18n._(msg`${distance} km`);
}

/** Below one kilometre, map measurements need whole metres rather than `0.4 km`. */
export function formatDistanceWithMeters(meters: number, i18n: I18n): string {
  if (meters >= 1_000) return formatTrackDistance(meters, i18n);
  const distance = new Intl.NumberFormat(i18n.locale, {
    maximumFractionDigits: 0,
  }).format(meters);
  return i18n._(msg`${distance} m`);
}

export function formatTrackElevation(meters: number, i18n: I18n): string {
  const elevation = new Intl.NumberFormat(i18n.locale).format(Math.round(meters));
  return i18n._(msg`${elevation} m`);
}

/** Signed change such as `+320 m` or `-45 m`; zero stays unsigned. */
export function formatElevationChange(meters: number, i18n: I18n): string {
  const elevation = new Intl.NumberFormat(i18n.locale, {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option token.
    signDisplay: 'exceptZero',
  }).format(Math.round(meters));
  return i18n._(msg`${elevation} m`);
}

export function formatTrackGrade(gradePct: number, i18n: I18n): string {
  return new Intl.NumberFormat(i18n.locale, {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    style: 'percent',
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    signDisplay: 'exceptZero',
  }).format(Math.round(gradePct) / 100);
}
