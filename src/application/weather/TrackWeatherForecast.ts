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
import type { TrackCoordinate, TrackPoint } from '@/domain/tracks/gpx';
import type { TrackMarker } from '@/domain/tracks/localTrack';
import { recordedElapsedSeconds } from '@/domain/tracks/profileTiming';
import {
  estimateHikingSeconds,
  geodesicDistanceMeters,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';

/**
 * Route timeline adjustments for one track; they never change its recorded time. They
 * also decide whether and how the map labels the track with these times.
 */
export interface TrackWeatherTimelineSettings {
  /** Fractional local hour of the day at which the hike starts. */
  readonly startHour: number;
  /** Multiplier of hiking time: above 1 is slower, below 1 faster. */
  readonly paceFactor: number;
  /** Times the route by the DIN 33466 estimate even when it has recorded time. */
  readonly ignoreRecordedTime: boolean;
  /** Clock times on the map line; null follows the Layers default. */
  readonly timeMarkers: boolean | null;
  /** Map times count from 00:00 at the start instead of the route start's clock time. */
  readonly relativeTimeMarkers: boolean;
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
  readonly elevationMeters: number | undefined;
  readonly distanceMeters: number;
}

interface TrackElevationLocation extends TrackWeatherLocation {
  readonly elevationMeters: number;
}

export interface TrackElevationLocations {
  readonly highest: TrackElevationLocation;
  readonly median: TrackElevationLocation;
  readonly lowest: TrackElevationLocation;
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
      readonly durationSource: 'recorded' | 'estimated';
      readonly distanceMeters: number;
      readonly durationSeconds: number;
    };

export interface TrackWeatherCheckpointPeriod {
  readonly isDay: boolean;
  readonly period: PointWeatherForecastPeriod;
}

interface TrackTimingPoint extends TrackPoint {
  readonly distanceMeters: number;
  readonly sourceSegmentIndex: number;
}

/** Full-route samples for labels; unlike an elevation profile, no geometry is omitted. */
export interface TrackTimingRoute {
  readonly points: readonly TrackTimingPoint[];
}

/**
 * Reuse a complete profile's filtered elevation. If elevation omitted any route span,
 * keep all original points and timestamps; unknown elevation contributes no vertical
 * travel, but its horizontal distance still counts.
 */
export function createTrackTimingRoute(
  profile: ElevationProfile,
  segments: readonly (readonly TrackPoint[])[],
  distanceMeters: number,
): TrackTimingRoute {
  const first = segments[0]?.[0];
  const last = segments.at(-1)?.at(-1);
  const profileFirst = profile.points[0];
  const profileLast = profile.points.at(-1);
  if (
    first !== undefined &&
    last !== undefined &&
    profileFirst !== undefined &&
    profileLast !== undefined &&
    first.coordinate[0] === profileFirst.coordinate[0] &&
    first.coordinate[1] === profileFirst.coordinate[1] &&
    last.coordinate[0] === profileLast.coordinate[0] &&
    last.coordinate[1] === profileLast.coordinate[1] &&
    first.recordedAt === profileFirst.recordedAt &&
    last.recordedAt === profileLast.recordedAt &&
    Math.abs(profileLast.distanceMeters - distanceMeters) < 0.001
  ) {
    return profile;
  }

  const points: TrackTimingPoint[] = [];
  let cumulativeDistance = 0;
  for (
    let sourceSegmentIndex = 0;
    sourceSegmentIndex < segments.length;
    sourceSegmentIndex += 1
  ) {
    const segment = segments[sourceSegmentIndex];
    if (segment === undefined) continue;
    for (let index = 0; index < segment.length; index += 1) {
      const point = requiredPoint(segment, index);
      const previous = segment[index - 1];
      if (previous !== undefined) {
        cumulativeDistance += geodesicDistanceMeters(
          previous.coordinate,
          point.coordinate,
        );
      }
      const sample = {
        ...point,
        distanceMeters: cumulativeDistance,
        sourceSegmentIndex,
      };
      const before = previous?.elevationMeters;
      const current = point.elevationMeters;
      const after = segment[index + 1]?.elevationMeters;
      if (before !== undefined && current !== undefined && after !== undefined) {
        sample.elevationMeters =
          before +
          current +
          after -
          Math.min(before, current, after) -
          Math.max(before, current, after);
      }
      points.push(sample);
    }
  }
  return { points };
}

function location(point: ElevationProfilePoint): TrackElevationLocation {
  return {
    coordinate: point.coordinate,
    elevationMeters: point.elevationMeters,
    distanceMeters: point.distanceMeters,
  };
}

function requiredPoint<Point>(points: readonly Point[], index: number): Point {
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
 * DIN 33466 elapsed seconds per profile point from cumulative distance, ascent, and
 * descent, scaled so the finish matches the track's stored estimate when one exists.
 */
function estimatedElapsedSeconds(
  points: readonly TrackTimingPoint[],
  totalSeconds: number | undefined,
): readonly number[] {
  const elapsed: number[] = [];
  let ascentMeters = 0;
  let descentMeters = 0;
  let previous: TrackTimingPoint | undefined;
  for (const point of points) {
    if (
      previous?.sourceSegmentIndex === point.sourceSegmentIndex &&
      previous.elevationMeters !== undefined &&
      point.elevationMeters !== undefined
    ) {
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
  points: readonly TrackTimingPoint[],
  elapsed: readonly number[],
  seconds: number,
): TrackWeatherLocation {
  const index = elapsed.findIndex((value) => value >= seconds);
  if (index <= 0) {
    const point = requiredPoint(points, index < 0 ? points.length - 1 : 0);
    return {
      coordinate: point.coordinate,
      elevationMeters: point.elevationMeters,
      distanceMeters: point.distanceMeters,
    };
  }
  const before = requiredPoint(points, index - 1);
  const after = requiredPoint(points, index);
  const beforeSeconds = elapsed[index - 1] ?? 0;
  const afterSeconds = elapsed[index] ?? beforeSeconds;
  // Between source segments no track is drawn: the hiker waits at the previous
  // segment's end until the next one starts.
  const fraction =
    afterSeconds <= beforeSeconds
      ? 0
      : before.sourceSegmentIndex !== after.sourceSegmentIndex
        ? seconds < afterSeconds
          ? 0
          : 1
        : (seconds - beforeSeconds) / (afterSeconds - beforeSeconds);
  return {
    coordinate: [
      interpolate(before.coordinate[0], after.coordinate[0], fraction),
      interpolate(before.coordinate[1], after.coordinate[1], fraction),
    ],
    elevationMeters:
      before.elevationMeters === undefined || after.elevationMeters === undefined
        ? undefined
        : interpolate(before.elevationMeters, after.elevationMeters, fraction),
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
  ignoreRecordedTime: false,
  timeMarkers: null,
  relativeTimeMarkers: false,
};

/**
 * Saved overrides win; otherwise use the recorded start's browser-local clock time,
 * rounded to the nearest half-hour. Only own entries count for untrusted track IDs.
 */
export function trackWeatherTimeline(
  preferences: TrackWeatherPreferences | null,
  trackId: string | null,
  recordedStartAt?: string,
): TrackWeatherTimelineSettings {
  if (
    preferences !== null &&
    trackId !== null &&
    Object.hasOwn(preferences.timelines, trackId)
  ) {
    const stored = preferences.timelines[trackId];
    if (stored !== undefined) return stored;
  }
  if (recordedStartAt === undefined) return defaultTrackWeatherTimelineSettings;
  const start = new Date(recordedStartAt);
  if (!Number.isFinite(start.getTime())) return defaultTrackWeatherTimelineSettings;
  const seconds =
    start.getHours() * 3600 + start.getMinutes() * 60 + start.getSeconds();
  const startHour = (Math.round(seconds / 1800) % 48) / 2;
  return { ...defaultTrackWeatherTimelineSettings, startHour };
}

/**
 * Stores a saved track's timeline settings. Default settings and null remove its entry,
 * so the record only holds adjusted tracks.
 */
export function withTrackWeatherTimeline(
  preferences: TrackWeatherPreferences,
  trackId: string,
  settings: TrackWeatherTimelineSettings | null,
  recordedStartAt?: string,
): TrackWeatherPreferences {
  const others = Object.entries(preferences.timelines).filter(([id]) => id !== trackId);
  const defaults = trackWeatherTimeline(null, null, recordedStartAt);
  const adjusted =
    settings !== null &&
    (settings.startHour !== defaults.startHour ||
      settings.paceFactor !== defaults.paceFactor ||
      settings.ignoreRecordedTime !== defaults.ignoreRecordedTime ||
      settings.timeMarkers !== defaults.timeMarkers ||
      settings.relativeTimeMarkers !== defaults.relativeTimeMarkers);
  // `fromEntries` defines own properties, so even a `__proto__` ID becomes an entry.
  return {
    ...preferences,
    timelines: Object.fromEntries(
      adjusted ? [...others, [trackId, settings] as const] : others,
    ),
  };
}

/** Track metrics the route timeline reads. */
export type TrackTimingMetrics = Pick<
  TrackMetrics,
  'elapsedSeconds' | 'estimatedSeconds' | 'ascentMeters' | 'descentMeters'
>;

/**
 * Elapsed seconds at each profile point. Recorded timestamps drive the pace when the
 * track has a recorded duration and `ignoreRecordedTime` is off; otherwise the DIN 33466
 * estimate adds climbing and descending time to horizontal walking time, scaled to the
 * track's stored estimate. Recorded tracks store none, so the DIN total of the route's
 * distance and the stored ascent and descent anchors it instead of the noisier
 * per-sample sum. `paceFactor` stretches (above 1) or compresses that time.
 */
function routeElapsedSeconds(
  points: readonly TrackTimingPoint[],
  metrics: TrackTimingMetrics,
  timing: TrackWeatherTiming,
): { readonly elapsed: readonly number[]; readonly recorded: boolean } {
  const recorded =
    metrics.elapsedSeconds === undefined || timing.ignoreRecordedTime
      ? null
      : recordedElapsedSeconds(points);
  const estimateTotal =
    metrics.estimatedSeconds ??
    (metrics.ascentMeters === undefined || metrics.descentMeters === undefined
      ? undefined
      : estimateHikingSeconds(
          points.at(-1)?.distanceMeters ?? 0,
          metrics.ascentMeters,
          metrics.descentMeters,
        ));
  const elapsed = (recorded ?? estimatedElapsedSeconds(points, estimateTotal)).map(
    (seconds) => seconds * timing.paceFactor,
  );
  return { elapsed, recorded: recorded !== null };
}

/** The settings that change how long the route takes. */
export type TrackWeatherTiming = Pick<
  TrackWeatherTimelineSettings,
  'paceFactor' | 'ignoreRecordedTime'
>;

/**
 * Places the hiker on the route every three hours from the start and at the finish,
 * timed by `routeElapsedSeconds`; the timing adjusts the time for the forecast only.
 * Only day hikes qualify: shorter than 30 km and, after the adjustment, 12 hours.
 */
export function planTrackWeatherTimeline(
  profile: TrackTimingRoute,
  metrics: TrackTimingMetrics & Pick<TrackMetrics, 'distanceMeters'>,
  timing: TrackWeatherTiming = defaultTrackWeatherTimelineSettings,
): TrackWeatherTimeline {
  const { points } = profile;
  const { elapsed, recorded } = routeElapsedSeconds(points, metrics, timing);
  const durationSeconds = elapsed.at(-1) ?? 0;
  const durationSource = recorded ? 'recorded' : 'estimated';
  if (
    metrics.distanceMeters >= TRACK_WEATHER_TIMELINE_MAXIMUM_DISTANCE_METERS ||
    durationSeconds >= TRACK_WEATHER_TIMELINE_MAXIMUM_SECONDS
  ) {
    return {
      status: 'too-long',
      durationSource,
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
    durationSource,
    durationSeconds,
    checkpoints,
  };
}

/** Where the hiker is at one full hour. */
export interface TrackHourMarker {
  readonly coordinate: TrackCoordinate;
  /** `HH:00`. */
  readonly time: string;
}

/**
 * Times along a route: local clock times that wrap past midnight, or, for relative
 * markers, hours and minutes since the start that keep counting past 24.
 */
export interface TrackClockTimes {
  /** `HH:mm` at the start and at the finish. */
  readonly start: string;
  readonly finish: string;
  /** Every full hour strictly between the start and the finish, in route order. */
  readonly hours: readonly TrackHourMarker[];
}

/** `HH:mm` of a number of seconds; whole minutes are truncated. */
function hoursAndMinutes(seconds: number, wrapAtMidnight: boolean): string {
  const totalMinutes = Math.floor(seconds / 60);
  const minutes = wrapAtMidnight ? totalMinutes % 1_440 : totalMinutes;
  return [Math.floor(minutes / 60), minutes % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/**
 * Times for the map on the forecast's timeline, at the track's route start and timing,
 * or counted from 00:00 at the start for relative markers. Unlike the forecast, any
 * length qualifies: these are labels, not forecasts.
 */
export function planTrackClockTimes(
  profile: TrackTimingRoute,
  metrics: TrackTimingMetrics,
  settings: TrackWeatherTimelineSettings,
): TrackClockTimes {
  const { points } = profile;
  const { elapsed } = routeElapsedSeconds(points, metrics, settings);
  // Whole seconds, so a scaled estimate a hair short of a full hour still finishes on
  // it rather than a minute earlier, and that hour is not also labelled on the way.
  const durationSeconds = Math.round(elapsed.at(-1) ?? 0);
  const relative = settings.relativeTimeMarkers;
  const startSeconds = relative ? 0 : settings.startHour * 3_600;
  const hours: TrackHourMarker[] = [];
  for (
    let hourSeconds = (Math.floor(startSeconds / 3_600) + 1) * 3_600;
    hourSeconds - startSeconds < durationSeconds;
    hourSeconds += 3_600
  ) {
    hours.push({
      coordinate: locationAtElapsed(points, elapsed, hourSeconds - startSeconds)
        .coordinate,
      time: hoursAndMinutes(hourSeconds, !relative),
    });
  }
  return {
    start: hoursAndMinutes(startSeconds, !relative),
    finish: hoursAndMinutes(startSeconds + durationSeconds, !relative),
    hours,
  };
}

/**
 * Passage times at each marker's nearest discrete profile point, provided it is within
 * 500 m. This association only supplies timing; marker coordinates remain unchanged.
 * Equal-distance points keep the first passage in profile order.
 */
export function planTrackMarkerTimes(
  profile: TrackTimingRoute,
  metrics: TrackTimingMetrics,
  settings: TrackWeatherTimelineSettings,
  markers: readonly TrackMarker[],
): ReadonlyMap<string, string> {
  const times = new Map<string, string>();
  if (settings.timeMarkers === false || markers.length === 0) return times;

  const { points } = profile;
  const { elapsed } = routeElapsedSeconds(points, metrics, settings);
  const relative = settings.relativeTimeMarkers;
  const startSeconds = relative ? 0 : settings.startHour * 3_600;
  for (const marker of markers) {
    let nearestDistance = Infinity;
    let nearestIndex = -1;
    for (let index = 0; index < points.length; index += 1) {
      const point = requiredPoint(points, index);
      const distance = geodesicDistanceMeters(marker.coordinate, point.coordinate);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    const seconds = elapsed[nearestIndex];
    if (nearestDistance <= 500 && seconds !== undefined) {
      times.set(
        marker.id,
        hoursAndMinutes(startSeconds + Math.round(seconds), !relative),
      );
    }
  }
  return times;
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
