import { solarDayEvents } from '@/domain/terrain/solarPosition';
import {
  instantToZonedWallTime,
  zonedWallTimeToInstant,
  type ZonedWallTime,
} from '@/domain/time/zonedWallTime';

const millisecondsPerMinute = 60_000;
/** Shadows are offered this long before sunrise and after sunset, for dawn and dusk. */
const twilightMarginMilliseconds = 2 * 60 * millisecondsPerMinute;

export interface DaylightWindow {
  readonly sunriseMs: number;
  readonly sunsetMs: number;
  /**
   * First and last whole minute shadows may show: two hours before the rounded-up sunrise
   * and after the rounded-down sunset, kept inside the local calendar day.
   */
  readonly firstMinuteMs: number;
  readonly lastMinuteMs: number;
}

/** Instants of local midnight starting `date` and the next day in `timeZone`. */
export function localDayBounds(
  date: Pick<ZonedWallTime, 'year' | 'month' | 'day'>,
  timeZone: string,
): { readonly startMs: number; readonly endMs: number } {
  const nextDay = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    startMs: zonedWallTimeToInstant(
      { ...date, hour: 0, minute: 0 },
      timeZone,
    ).getTime(),
    endMs: zonedWallTimeToInstant(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
        hour: 0,
        minute: 0,
      },
      timeZone,
    ).getTime(),
  };
}

/**
 * Sunrise, sunset, and the shadow time range of the local calendar day containing
 * `instantMs` at `place`; null when the day lacks either event (polar day or night).
 */
export function daylightWindow(
  instantMs: number,
  place: { readonly latitude: number; readonly longitude: number },
  timeZone: string,
): DaylightWindow | null {
  const day = localDayBounds(
    instantToZonedWallTime(new Date(instantMs), timeZone),
    timeZone,
  );
  const events = solarDayEvents(
    new Date(day.startMs),
    new Date(day.endMs),
    place.latitude,
    place.longitude,
  );
  if (events.sunrise === null || events.sunset === null) return null;
  const sunriseMs = events.sunrise.getTime();
  const sunsetMs = events.sunset.getTime();
  if (sunsetMs <= sunriseMs) return null;
  return {
    sunriseMs,
    sunsetMs,
    firstMinuteMs: Math.max(
      Math.ceil(sunriseMs / millisecondsPerMinute) * millisecondsPerMinute -
        twilightMarginMilliseconds,
      day.startMs,
    ),
    lastMinuteMs: Math.min(
      Math.floor(sunsetMs / millisecondsPerMinute) * millisecondsPerMinute +
        twilightMarginMilliseconds,
      day.endMs - millisecondsPerMinute,
    ),
  };
}

/** Clamps to [`firstMinuteMs`, `lastMinuteMs`]; unchanged when `window` is null. */
export function clampToDaylight(
  instantMs: number,
  window: DaylightWindow | null,
): number {
  if (window === null) return instantMs;
  return Math.min(Math.max(instantMs, window.firstMinuteMs), window.lastMinuteMs);
}

/**
 * Whole-minute frames from `firstMinuteMs` every `stepMinutes`, plus `lastMinuteMs` when
 * not already last.
 */
export function daylightFrameInstants(
  window: DaylightWindow,
  stepMinutes: number,
): readonly number[] {
  const frames: number[] = [];
  for (
    let instant = window.firstMinuteMs;
    instant <= window.lastMinuteMs;
    instant += stepMinutes * millisecondsPerMinute
  ) {
    frames.push(instant);
  }
  if (frames.at(-1) !== window.lastMinuteMs) frames.push(window.lastMinuteMs);
  return frames;
}
