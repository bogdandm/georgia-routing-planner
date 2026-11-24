import lookupTimeZone from '@photostructure/tz-lookup';

/** Civil wall-clock time in an IANA time zone, to the minute; `month` is 1–12. */
export interface ZonedWallTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/**
 * IANA zone at a route's start, whose clock every route time uses. Rounded like the map's
 * sun panel, so nearby points share one zone.
 */
export function routeTimeZone([longitude, latitude]: readonly [
  longitude: number,
  latitude: number,
]): string {
  return lookupTimeZone(
    Math.round(latitude * 100) / 100,
    Math.round(longitude * 100) / 100,
  );
}

const millisecondsPerMinute = 60_000;
const millisecondsPerDay = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields read as if they were UTC, in epoch milliseconds (seconds included). */
function wallClockAsUtcMilliseconds(instant: Date, timeZone: string): number {
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of wallTimeFormatter(timeZone).formatToParts(instant)) {
    const value = Number(part.value);
    if (part.type === 'year') year = value;
    else if (part.type === 'month') month = value;
    else if (part.type === 'day') day = value;
    else if (part.type === 'hour') hour = value;
    else if (part.type === 'minute') minute = value;
    else if (part.type === 'second') second = value;
  }
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** UTC offset in minutes (east positive) of `timeZone` at `instant`, e.g. +240 for Asia/Tbilisi. */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const wholeSecond = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round(
    (wallClockAsUtcMilliseconds(instant, timeZone) - wholeSecond) /
      millisecondsPerMinute,
  );
}

/** Wall-clock time of `instant` in `timeZone`; seconds are truncated. */
export function instantToZonedWallTime(instant: Date, timeZone: string): ZonedWallTime {
  const wall = new Date(wallClockAsUtcMilliseconds(instant, timeZone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
  };
}

/**
 * Instant of a wall-clock time in `timeZone` with Temporal `'compatible'` disambiguation:
 * a time skipped by a forward transition moves forward by the gap, and a repeated time
 * resolves to the earlier instant. Assumes at most one offset change within ±1 day.
 */
export function zonedWallTimeToInstant(wall: ZonedWallTime, timeZone: string): Date {
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );
  const offsetBefore = timeZoneOffsetMinutes(
    new Date(wallAsUtc - millisecondsPerDay),
    timeZone,
  );
  const offsetAfter = timeZoneOffsetMinutes(
    new Date(wallAsUtc + millisecondsPerDay),
    timeZone,
  );

  // A larger offset gives an earlier instant, so trying it first selects the earlier overlap.
  for (const offset of [
    Math.max(offsetBefore, offsetAfter),
    Math.min(offsetBefore, offsetAfter),
  ]) {
    const candidate = new Date(wallAsUtc - offset * millisecondsPerMinute);
    if (wallClockAsUtcMilliseconds(candidate, timeZone) === wallAsUtc) return candidate;
  }
  // Gap: interpret with the pre-transition offset, which lands after the gap.
  return new Date(wallAsUtc - offsetBefore * millisecondsPerMinute);
}
