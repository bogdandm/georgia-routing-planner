import { solarDayEvents } from '@/domain/terrain/solarPosition';
import {
  instantToZonedWallTime,
  zonedWallTimeToInstant,
  type ZonedWallTime,
} from '@/domain/time/zonedWallTime';

const millisecondsPerMinute = 60_000;

export interface DaylightWindow {
  readonly sunriseMs: number;
  readonly sunsetMs: number;
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
 * Sunrise and sunset of the local calendar day containing `instantMs` at `place`; null
 * when the day lacks either (polar day or night).
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
  return sunsetMs > sunriseMs ? { sunriseMs, sunsetMs } : null;
}

function firstDaylightMinute(window: DaylightWindow): number {
  return Math.ceil(window.sunriseMs / millisecondsPerMinute) * millisecondsPerMinute;
}

function lastDaylightMinute(window: DaylightWindow): number {
  return Math.floor(window.sunsetMs / millisecondsPerMinute) * millisecondsPerMinute;
}

/**
 * Clamps to [sunrise rounded up, sunset rounded down] to whole minutes; unchanged when
 * `window` is null.
 */
export function clampToDaylight(
  instantMs: number,
  window: DaylightWindow | null,
): number {
  if (window === null) return instantMs;
  return Math.min(
    Math.max(instantMs, firstDaylightMinute(window)),
    lastDaylightMinute(window),
  );
}

/**
 * Whole-minute frames from rounded-up sunrise every `stepMinutes`, plus rounded-down
 * sunset when not already last.
 */
export function daylightFrameInstants(
  window: DaylightWindow,
  stepMinutes: number,
): readonly number[] {
  const first = firstDaylightMinute(window);
  const last = lastDaylightMinute(window);
  const frames: number[] = [];
  for (
    let instant = first;
    instant <= last;
    instant += stepMinutes * millisecondsPerMinute
  ) {
    frames.push(instant);
  }
  if (frames.at(-1) !== last) frames.push(last);
  return frames;
}
