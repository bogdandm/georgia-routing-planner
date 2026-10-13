import {
  summarizeWeatherPeriod,
  type PointWeatherForecast,
  type PointWeatherForecastPeriod,
} from '@/application/weather/GetPointWeatherForecast';
import {
  markerWeatherWeekdays,
  type MarkerWeatherWeekday,
} from '@/application/weather/MarkerWeatherForecast';
import type {
  ElevationProfile,
  ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  estimateHikingSeconds,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';

/** Route timeline adjustments for one track; they never change its recorded time. */
export interface TrackWeatherTimelineSettings {
  /** Fractional local hour of the day at which the hike starts. */
  readonly startHour: number;
  /** Multiplier of hiking time: above 1 is slower, below 1 faster. */
  readonly paceFactor: number;
}

/** Browser-local track forecast view state. */
export interface TrackWeatherPreferences {
  /** Shared by every track. */
  readonly expanded: boolean;
  /** Local weekday whose next occurrence the forecast date selector opens on. */
  readonly weekday: MarkerWeatherWeekday;
  /** Adjusted saved tracks by ID; a track without an entry uses the defaults. */
  readonly timelines: Readonly<Record<string, TrackWeatherTimelineSettings>>;
}

export const defaultTrackWeatherPreferences: TrackWeatherPreferences = {
  expanded: false,
  weekday: 6,
  timelines: {},
};

/** Selectable forecast dates: the local day plus six days, all covered by the forecast. */
export const TRACK_WEATHER_DATE_COUNT = 7;
/** Local hour at which the timeline assumes the hike starts unless the user moves it. */
export const TRACK_WEATHER_DEFAULT_START_HOUR = 9;
/** The start hour selector covers the whole local day in half-hour steps. */
export const TRACK_WEATHER_START_HOUR_STEP = 0.5;
export const TRACK_WEATHER_LATEST_START_HOUR = 24 - TRACK_WEATHER_START_HOUR_STEP;
export const TRACK_WEATHER_TIMELINE_MAXIMUM_DISTANCE_METERS = 30_000;
export const TRACK_WEATHER_TIMELINE_MAXIMUM_SECONDS = 12 * 3_600;
export const TRACK_WEATHER_CHECKPOINT_INTERVAL_SECONDS = 3 * 3_600;

const millisecondsPerDay = 86_400_000;

export interface TrackWeatherLocation {
  readonly coordinate: TrackCoordinate;
  readonly elevationMeters: number;
  readonly distanceMeters: number;
}

export interface TrackElevationLocations {
  readonly highest: TrackWeatherLocation;
  readonly median: TrackWeatherLocation;
  readonly lowest: TrackWeatherLocation;
}

export interface TrackWeatherCheckpoint extends TrackWeatherLocation {
  readonly kind: 'start' | 'interval' | 'finish';
  /** Time after the start at which the hiker reaches this location. */
  readonly elapsedSeconds: number;
  /** End of the forecast window: the next checkpoint, or this one for the finish. */
  readonly untilElapsedSeconds: number;
}

export type TrackWeatherTimeline =
  | {
      readonly status: 'available';
      readonly durationSource: 'recorded' | 'estimated';
      readonly durationSeconds: number;
      readonly checkpoints: readonly TrackWeatherCheckpoint[];
    }
  | {
      readonly status: 'too-long';
      readonly distanceMeters: number;
      readonly durationSeconds: number;
    };

export interface TrackWeatherCheckpointPeriod {
  readonly isDay: boolean;
  readonly period: PointWeatherForecastPeriod;
}

function location(point: ElevationProfilePoint): TrackWeatherLocation {
  return {
    coordinate: point.coordinate,
    elevationMeters: point.elevationMeters,
    distanceMeters: point.distanceMeters,
  };
}

function requiredPoint(
  points: readonly ElevationProfilePoint[],
  index: number,
): ElevationProfilePoint {
  const point = points[index];
  if (point === undefined) throw new RangeError('The elevation profile is empty.');
  return point;
}

/**
 * Highest, lowest, and median-elevation profile samples. Profile samples are spaced
 * along distance, so the median is the elevation at or below which half the route lies.
 */
export function selectTrackElevationLocations(
  profile: ElevationProfile,
): TrackElevationLocations {
  const { points } = profile;
  let highest = requiredPoint(points, 0);
  let lowest = highest;
  for (const point of points) {
    if (point.elevationMeters > highest.elevationMeters) highest = point;
    if (point.elevationMeters < lowest.elevationMeters) lowest = point;
  }
  const sorted = points.map((point) => point.elevationMeters).sort((a, b) => a - b);
  const medianMeters = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
  let median = highest;
  for (const point of points) {
    if (
      Math.abs(point.elevationMeters - medianMeters) <
      Math.abs(median.elevationMeters - medianMeters)
    ) {
      median = point;
    }
  }
  return {
    highest: location(highest),
    median: location(median),
    lowest: location(lowest),
  };
}

/**
 * Recorded elapsed seconds per profile point, or null unless every point has a valid
 * timestamp and time advances. Pauses keep the hiker in place; reversed clock jumps do
 * not move time backward.
 */
function recordedElapsedSeconds(
  points: readonly ElevationProfilePoint[],
): readonly number[] | null {
  const elapsed: number[] = [];
  let startMilliseconds: number | undefined;
  let latestSeconds = 0;
  for (const point of points) {
    const milliseconds =
      point.recordedAt === undefined ? Number.NaN : Date.parse(point.recordedAt);
    if (!Number.isFinite(milliseconds)) return null;
    startMilliseconds ??= milliseconds;
    latestSeconds = Math.max(latestSeconds, (milliseconds - startMilliseconds) / 1_000);
    elapsed.push(latestSeconds);
  }
  return latestSeconds > 0 ? elapsed : null;
}

/**
 * DIN 33466 elapsed seconds per profile point from cumulative distance, ascent, and
 * descent, scaled so the finish matches the track's stored estimate when one exists.
 */
function estimatedElapsedSeconds(
  points: readonly ElevationProfilePoint[],
  totalSeconds: number | undefined,
): readonly number[] {
  const elapsed: number[] = [];
  let ascentMeters = 0;
  let descentMeters = 0;
  let previous: ElevationProfilePoint | undefined;
  for (const point of points) {
    if (previous !== undefined) {
      const change = point.elevationMeters - previous.elevationMeters;
      if (change > 0) ascentMeters += change;
      else descentMeters -= change;
    }
    elapsed.push(
      estimateHikingSeconds(point.distanceMeters, ascentMeters, descentMeters),
    );
    previous = point;
  }
  const profileSeconds = elapsed.at(-1) ?? 0;
  if (totalSeconds === undefined || profileSeconds <= 0) return elapsed;
  const scale = totalSeconds / profileSeconds;
  return elapsed.map((seconds) => seconds * scale);
}

function interpolate(start: number, end: number, fraction: number): number {
  return start + (end - start) * fraction;
}

function locationAtElapsed(
  points: readonly ElevationProfilePoint[],
  elapsed: readonly number[],
  seconds: number,
): TrackWeatherLocation {
  const index = elapsed.findIndex((value) => value >= seconds);
  if (index <= 0)
    return location(requiredPoint(points, index < 0 ? points.length - 1 : 0));
  const before = requiredPoint(points, index - 1);
  const after = requiredPoint(points, index);
  const beforeSeconds = elapsed[index - 1] ?? 0;
  const afterSeconds = elapsed[index] ?? beforeSeconds;
  const fraction =
    afterSeconds <= beforeSeconds
      ? 0
      : (seconds - beforeSeconds) / (afterSeconds - beforeSeconds);
  return {
    coordinate: [
      interpolate(before.coordinate[0], after.coordinate[0], fraction),
      interpolate(before.coordinate[1], after.coordinate[1], fraction),
    ],
    elevationMeters: interpolate(
      before.elevationMeters,
      after.elevationMeters,
      fraction,
    ),
    distanceMeters: interpolate(before.distanceMeters, after.distanceMeters, fraction),
  };
}

/** Bounds and step of the forecast-only pace adjustment, a multiplier of hiking time. */
export const TRACK_WEATHER_MINIMUM_PACE_FACTOR = 0.5;
export const TRACK_WEATHER_MAXIMUM_PACE_FACTOR = 2;
export const TRACK_WEATHER_PACE_FACTOR_STEP = 0.05;

export const defaultTrackWeatherTimelineSettings: TrackWeatherTimelineSettings = {
  startHour: TRACK_WEATHER_DEFAULT_START_HOUR,
  paceFactor: 1,
};

/**
 * The saved track's timeline settings, or the defaults. Only own entries count, so a
 * track ID such as `constructor` never reads an `Object.prototype` member.
 */
export function trackWeatherTimeline(
  preferences: TrackWeatherPreferences | null,
  trackId: string,
): TrackWeatherTimelineSettings {
  return preferences !== null && Object.hasOwn(preferences.timelines, trackId)
    ? (preferences.timelines[trackId] ?? defaultTrackWeatherTimelineSettings)
    : defaultTrackWeatherTimelineSettings;
}

/**
 * Stores a saved track's timeline settings. Default settings and null remove its entry,
 * so the record only holds adjusted tracks.
 */
export function withTrackWeatherTimeline(
  preferences: TrackWeatherPreferences,
  trackId: string,
  settings: TrackWeatherTimelineSettings | null,
): TrackWeatherPreferences {
  const others = Object.entries(preferences.timelines).filter(([id]) => id !== trackId);
  const adjusted =
    settings !== null &&
    (settings.startHour !== defaultTrackWeatherTimelineSettings.startHour ||
      settings.paceFactor !== defaultTrackWeatherTimelineSettings.paceFactor);
  // `fromEntries` defines own properties, so even a `__proto__` ID becomes an entry.
  return {
    ...preferences,
    timelines: Object.fromEntries(
      adjusted ? [...others, [trackId, settings] as const] : others,
    ),
  };
}

/**
 * Places the hiker on the route every three hours from the start and at the finish.
 * Recorded timestamps drive the pace when the track has a recorded duration; otherwise
 * the DIN 33466 estimate adds climbing and descending time to horizontal walking time.
 * `paceFactor` stretches (above 1) or compresses that time for the forecast only.
 * Only day hikes qualify: shorter than 30 km and, after the adjustment, 12 hours.
 */
export function planTrackWeatherTimeline(
  profile: ElevationProfile,
  metrics: Pick<TrackMetrics, 'distanceMeters' | 'elapsedSeconds' | 'estimatedSeconds'>,
  paceFactor = 1,
): TrackWeatherTimeline {
  const { points } = profile;
  const recorded =
    metrics.elapsedSeconds === undefined ? null : recordedElapsedSeconds(points);
  const elapsed = (
    recorded ?? estimatedElapsedSeconds(points, metrics.estimatedSeconds)
  ).map((seconds) => seconds * paceFactor);
  const durationSeconds = elapsed.at(-1) ?? 0;
  if (
    metrics.distanceMeters >= TRACK_WEATHER_TIMELINE_MAXIMUM_DISTANCE_METERS ||
    durationSeconds >= TRACK_WEATHER_TIMELINE_MAXIMUM_SECONDS
  ) {
    return {
      status: 'too-long',
      distanceMeters: metrics.distanceMeters,
      durationSeconds,
    };
  }

  const times: number[] = [];
  for (
    let seconds = 0;
    seconds < durationSeconds;
    seconds += TRACK_WEATHER_CHECKPOINT_INTERVAL_SECONDS
  ) {
    times.push(seconds);
  }
  times.push(durationSeconds);
  const checkpoints = times.map((seconds, index): TrackWeatherCheckpoint => {
    const last = index === times.length - 1;
    return {
      ...locationAtElapsed(points, elapsed, seconds),
      kind: index === 0 ? 'start' : last ? 'finish' : 'interval',
      elapsedSeconds: seconds,
      untilElapsedSeconds: times[index + 1] ?? seconds,
    };
  });
  return {
    status: 'available',
    durationSource: recorded === null ? 'estimated' : 'recorded',
    durationSeconds,
    checkpoints,
  };
}

function parseLocalDate(date: string): number {
  const milliseconds = Date.parse(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(milliseconds)) {
    throw new RangeError(`Invalid local forecast date: ${date}`);
  }
  return milliseconds;
}

function localDateTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 16);
}

/** Selectable forecast dates starting at the given local date. */
export function trackWeatherDates(today: string): readonly string[] {
  const start = parseLocalDate(today);
  return Array.from({ length: TRACK_WEATHER_DATE_COUNT }, (_, index) =>
    localDateTime(start + index * millisecondsPerDay).slice(0, 10),
  );
}

export function trackWeatherWeekday(date: string): MarkerWeatherWeekday {
  const weekday = new Date(parseLocalDate(date)).getUTCDay();
  return markerWeatherWeekdays.find((value) => value === weekday) ?? 0;
}

/** The first selectable date on the preferred weekday; seven dates contain every one. */
export function defaultTrackWeatherDate(
  dates: readonly string[],
  weekday: MarkerWeatherWeekday,
): string {
  const date =
    dates.find((value) => trackWeatherWeekday(value) === weekday) ?? dates[0];
  if (date === undefined) throw new RangeError('No forecast dates are selectable.');
  return date;
}

/**
 * Local `YYYY-MM-DDTHH:mm` at which the hiker reaches a point on the chosen date when
 * starting at the fractional local `startHour`.
 */
export function trackWeatherLocalTime(
  date: string,
  startHour: number,
  elapsedSeconds: number,
): string {
  return localDateTime(
    parseLocalDate(date) + (startHour * 3_600 + elapsedSeconds) * 1_000,
  );
}

/**
 * Summarizes the checkpoint location's forecast hours from its arrival hour until the
 * next checkpoint; the finish covers its arrival hour. Arrivals after midnight read the
 * next date's hours. Null unless the forecast reaches the window's last hour, so a late
 * start on the last date never summarizes a truncated window.
 */
export function summarizeTrackWeatherCheckpoint(
  forecast: PointWeatherForecast,
  date: string,
  startHour: number,
  checkpoint: TrackWeatherCheckpoint,
): TrackWeatherCheckpointPeriod | null {
  const startHours = startHour + checkpoint.elapsedSeconds / 3_600;
  const untilHours = startHour + checkpoint.untilElapsedSeconds / 3_600;
  const firstHour = Math.floor(startHours);
  const endHour = Math.max(firstHour + 1, Math.ceil(untilHours));
  const dayStart = parseLocalDate(date);
  const start = localDateTime(dayStart + firstHour * 3_600_000);
  const lastHour = localDateTime(dayStart + (endHour - 1) * 3_600_000);
  const end = localDateTime(dayStart + endHour * 3_600_000);
  if ((forecast.hourly.at(-1)?.time ?? '') < lastHour) return null;
  const hours = forecast.hourly.filter((hour) => hour.time >= start && hour.time < end);
  if (hours.length === 0) return null;
  const isDay = hours.filter((hour) => hour.isDay).length * 2 >= hours.length;
  return { isDay, period: summarizeWeatherPeriod(hours, isDay ? 'day' : 'night') };
}
