import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import {
  DAY_HIKE_TIME_PRESET_ID,
  DIN_HIKING_TIME_PRESET_ID,
  MULTI_DAY_HIKE_TIME_PRESET_ID,
  type HikingTimePreset,
} from '@/domain/tracks/hikingTime';

import { formatPercent } from '@/presentation/formatPercent';

/** Built-in presets are named in the active locale; user presets keep their own name. */
export function hikingTimePresetName(preset: HikingTimePreset, i18n: I18n): string {
  switch (preset.id) {
    case DIN_HIKING_TIME_PRESET_ID:
      return i18n._(msg`DIN 33466 (standard)`);
    case DAY_HIKE_TIME_PRESET_ID:
      return i18n._(msg`Day hike`);
    case MULTI_DAY_HIKE_TIME_PRESET_ID:
      return i18n._(msg`Multi-day trek`);
    default:
      return preset.name;
  }
}

/** Estimate relative to recorded time: `0.1` means the estimate is 10 % longer. */
export function estimateDivergence(
  estimatedSeconds: number,
  recordedSeconds: number,
): number {
  return estimatedSeconds / recordedSeconds - 1;
}

/** How close an estimate came: within 10 %, within 20 %, or further off. */
export type EstimateMatch = 'close' | 'fair' | 'far';

export function estimateMatch(divergence: number): EstimateMatch {
  const magnitude = Math.abs(divergence);
  return magnitude <= 0.1 ? 'close' : magnitude <= 0.2 ? 'fair' : 'far';
}

/** Signed whole percent such as `+12%` or `-4%`; zero stays unsigned. */
export function formatEstimateDivergence(divergence: number, i18n: I18n): string {
  return formatPercent(divergence, i18n.locale, {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option token.
    signDisplay: 'exceptZero',
    maximumFractionDigits: 0,
  });
}
