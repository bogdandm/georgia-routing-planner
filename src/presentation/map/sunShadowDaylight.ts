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
 * The current instant while the Sun is up at `place`; otherwise 11:00 on the same local
 * day, so a session or **Now** at night never opens with the whole map in shade.
 * Unchanged on a day without sunrise and sunset.
 */
export function sunlitNow(
  nowMs: number,
  place: { readonly latitude: number; readonly longitude: number },
  timeZone: string,
): number {
  const window = daylightWindow(nowMs, place, timeZone);
  if (window === null || (nowMs >= window.sunriseMs && nowMs <= window.sunsetMs)) {
    return nowMs;
  }
  const date = instantToZonedWallTime(new Date(nowMs), timeZone);
  return zonedWallTimeToInstant({ ...date, hour: 11, minute: 0 }, timeZone).getTime();
}

/** The longest step between frames, as a multiple of the average step. */
const frameMaximumStepFactor = 3;

/**
 * Day playback frames: whole minutes from `firstMinuteMs` to `lastMinuteMs`, as many as
 * an even schedule every `averageStepMinutes` would have (from the first minute, plus the
 * last), packed around sunrise and sunset. A frame d minutes from the nearer event steps
 * min(3 × average, 1 + k·d²) minutes ahead, rounded and at least one, so the minutes
 * around each event are all shown and the step grows smoothly to its maximum over the
 * middle of the day. k is the smallest value whose schedule fits that frame count, found
 * by bisection; a window too short to need it gets every minute.
 */
export function daylightFrameInstants(
  window: DaylightWindow,
  averageStepMinutes: number,
): readonly number[] {
  const { firstMinuteMs, lastMinuteMs, sunriseMs, sunsetMs } = window;
  const frameBudget =
    Math.ceil(
      (lastMinuteMs - firstMinuteMs) / (averageStepMinutes * millisecondsPerMinute),
    ) + 1;
  const maximumStepMinutes = frameMaximumStepFactor * averageStepMinutes;
  const schedule = (growth: number): number[] => {
    const frames: number[] = [];
    let instant = firstMinuteMs;
    while (instant < lastMinuteMs) {
      frames.push(instant);
      const eventMinutes =
        Math.min(Math.abs(instant - sunriseMs), Math.abs(instant - sunsetMs)) /
        millisecondsPerMinute;
      const stepMinutes = Math.min(
        maximumStepMinutes,
        1 + growth * eventMinutes * eventMinutes,
      );
      instant += Math.max(1, Math.round(stepMinutes)) * millisecondsPerMinute;
    }
    frames.push(lastMinuteMs);
    return frames;
  };
  const everyMinute = schedule(0);
  if (everyMinute.length <= frameBudget) return everyMinute;
  // At growth 1 the step reaches its maximum about 5 minutes from each event, so that
  // schedule has the fewest frames.
  let fits = 1;
  let tooMany = 0;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const growth = (fits + tooMany) / 2;
    if (schedule(growth).length <= frameBudget) fits = growth;
    else tooMany = growth;
  }
  return schedule(fits);
}
