import type { HourlyWeatherForecast } from '@/application/ports/WeatherForecastGateway';
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
import type { TrackMarker, TrackRouteTiming } from '@/domain/tracks/localTrack';
import { recordedElapsedSeconds } from '@/domain/tracks/profileTiming';
import { analyzeRecordedHike } from '@/domain/tracks/recordedHikeAnalysis';
import { instantToZonedWallTime, routeTimeZone } from '@/domain/time/zonedWallTime';
import {
  estimateHikingTime,
  type HikingTimeEstimate,
  type HikingTimeParameters,
} from '@/domain/tracks/hikingTime';
import {
  geodesicDistanceMeters,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';

/** Browser-local track forecast view state, shared by every track. */
export interface TrackWeatherPreferences {
  readonly expanded: boolean;
  /** Local weekday whose next occurrence the forecast date selector opens on. */
  readonly weekday: MarkerWeatherWeekday;
}

export const defaultTrackWeatherPreferences: TrackWeatherPreferences = {
  expanded: false,
  weekday: 6,
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

/** One forecast hour at the highest point the hiker passes during that hour. */
export interface TrackWeatherHour {
  /** Whole hours from the forecast date's local midnight; past 23 on the next date. */
  readonly hour: number;
  readonly location: TrackWeatherLocation;
}

export interface TrackWeatherCheckpoint extends TrackWeatherLocation {
  readonly kind: 'start' | 'interval' | 'finish';
  /** Time after the start at which the hiker reaches this location. */
  readonly elapsedSeconds: number;
  /**
   * The forecast window: every hour from the arrival hour until the next checkpoint, or
   * the arrival hour alone for the finish.
   */
  readonly hours: readonly TrackWeatherHour[];
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

export interface TrackTimingPoint extends TrackPoint {
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

/**
 * The highest point the hiker passes between two elapsed times, ends included; the
 * point at `fromSeconds` when no elevation is known.
 */
function highestLocationBetween(
  points: readonly TrackTimingPoint[],
  elapsed: readonly number[],
  fromSeconds: number,
  toSeconds: number,
): TrackWeatherLocation {
  const passed = points.flatMap((point, index): TrackWeatherLocation[] => {
    const seconds = elapsed[index] ?? 0;
    return seconds > fromSeconds && seconds < toSeconds
      ? [
          {
            coordinate: point.coordinate,
            elevationMeters: point.elevationMeters,
            distanceMeters: point.distanceMeters,
          },
        ]
      : [];
  });
  let highest = locationAtElapsed(points, elapsed, fromSeconds);
  for (const candidate of [...passed, locationAtElapsed(points, elapsed, toSeconds)]) {
    if (
      (candidate.elevationMeters ?? -Infinity) > (highest.elevationMeters ?? -Infinity)
    ) {
      highest = candidate;
    }
  }
  return highest;
}

/** Bounds and step of the pace adjustment, a multiplier of moving time. */
export const TRACK_WEATHER_MINIMUM_PACE_FACTOR = 0.5;
export const TRACK_WEATHER_MAXIMUM_PACE_FACTOR = 2;
export const TRACK_WEATHER_PACE_FACTOR_STEP = 0.05;
/** Bounds and step of the stop adjustment, a multiplier of breaks and lunch. */
export const TRACK_WEATHER_MINIMUM_STOP_FACTOR = 0;
export const TRACK_WEATHER_MAXIMUM_STOP_FACTOR = 3;
export const TRACK_WEATHER_STOP_FACTOR_STEP = 0.05;

/**
 * Route timing plus the map's light coloring of the track, which is session view state:
 * it is never stored and resets on reload.
 */
export interface TrackWeatherTimelineSettings extends TrackRouteTiming {
  /** The map colors the track by its light along the hike instead of its grade. */
  readonly lightOnMap: boolean;
}

export const defaultTrackRouteTiming: TrackRouteTiming = {
  startHour: TRACK_WEATHER_DEFAULT_START_HOUR,
  paceFactor: 1,
  stopFactor: 1,
  presetId: null,
  ignoreRecordedTime: false,
  timeMarkers: null,
  relativeTimeMarkers: false,
  hikeDate: null,
};

export const defaultTrackWeatherTimelineSettings: TrackWeatherTimelineSettings = {
  ...defaultTrackRouteTiming,
  lightOnMap: false,
};

/** A recorded start instant and the IANA zone at the route start, whose clock it shows. */
export interface RecordedRouteStart {
  readonly at: string;
  readonly timeZone: string;
}

/** The recorded start on the clock of the route start, which timing defaults use. */
export function recordedRouteStart(
  metrics: Pick<TrackMetrics, 'recordedStartAt' | 'startCoordinate'>,
): RecordedRouteStart | undefined {
  return metrics.recordedStartAt === undefined
    ? undefined
    : { at: metrics.recordedStartAt, timeZone: routeTimeZone(metrics.startCoordinate) };
}

/**
 * Stored adjustments win; otherwise use the recorded start's local clock time at the
 * route, rounded to the nearest half-hour. Light coloring starts off.
 */
export function trackWeatherTimeline(
  stored: TrackRouteTiming | undefined,
  recordedStart?: RecordedRouteStart,
): TrackWeatherTimelineSettings {
  if (stored !== undefined) return { ...stored, lightOnMap: false };
  if (recordedStart === undefined) return defaultTrackWeatherTimelineSettings;
  const start = new Date(recordedStart.at);
  if (!Number.isFinite(start.getTime())) return defaultTrackWeatherTimelineSettings;
  const wall = instantToZonedWallTime(start, recordedStart.timeZone);
  // Zone offsets are whole minutes, so the UTC seconds are the local ones.
  const seconds = wall.hour * 3600 + wall.minute * 60 + start.getUTCSeconds();
  const startHour = (Math.round(seconds / 1800) % 48) / 2;
  return { ...defaultTrackWeatherTimelineSettings, startHour };
}

export function sameTrackRouteTiming(
  left: TrackRouteTiming,
  right: TrackRouteTiming,
): boolean {
  return (
    left.startHour === right.startHour &&
    left.paceFactor === right.paceFactor &&
    left.stopFactor === right.stopFactor &&
    left.presetId === right.presetId &&
    left.ignoreRecordedTime === right.ignoreRecordedTime &&
    left.timeMarkers === right.timeMarkers &&
    left.relativeTimeMarkers === right.relativeTimeMarkers &&
    left.hikeDate === right.hikeDate
  );
}

/**
 * The route timing a track stores, without the session-only light coloring: null when
 * it equals the track's defaults, so only adjusted tracks carry it.
 */
export function adjustedTrackRouteTiming(
  settings: TrackRouteTiming,
  recordedStart?: RecordedRouteStart,
): TrackRouteTiming | null {
  if (sameTrackRouteTiming(settings, trackWeatherTimeline(undefined, recordedStart))) {
    return null;
  }
  return {
    startHour: settings.startHour,
    paceFactor: settings.paceFactor,
    stopFactor: settings.stopFactor,
    presetId: settings.presetId,
    ignoreRecordedTime: settings.ignoreRecordedTime,
    timeMarkers: settings.timeMarkers,
    relativeTimeMarkers: settings.relativeTimeMarkers,
    hikeDate: settings.hikeDate,
  };
}

/** Track metrics the route timeline reads. */
export type TrackTimingMetrics = Pick<
  TrackMetrics,
  'elapsedSeconds' | 'ascentMeters' | 'descentMeters'
>;

/** The settings that change how long the route takes, and the preset's parameters. */
export type TrackWeatherTiming = Pick<
  TrackWeatherTimelineSettings,
  'paceFactor' | 'stopFactor' | 'ignoreRecordedTime'
> & { readonly hikingTime: HikingTimeParameters };

export interface RouteElapsedSeconds {
  readonly elapsed: readonly number[];
  readonly recorded: boolean;
  /** The preset estimate; null while recorded timestamps time the route. */
  readonly estimate: HikingTimeEstimate | null;
}

/**
 * The preset's estimate of the route, without the recorded-time choice. A DIN movement
 * is anchored to the route's stored ascent and descent rather than the noisier
 * per-sample sum.
 */
export function estimateRouteHikingTime(
  points: readonly TrackTimingPoint[],
  metrics: TrackTimingMetrics,
  timing: Omit<TrackWeatherTiming, 'ignoreRecordedTime'>,
): HikingTimeEstimate {
  const totals: { ascentMeters?: number; descentMeters?: number } = {};
  if (metrics.ascentMeters !== undefined) totals.ascentMeters = metrics.ascentMeters;
  if (metrics.descentMeters !== undefined) totals.descentMeters = metrics.descentMeters;
  return estimateHikingTime(points, timing.hikingTime, timing, totals);
}

/**
 * Elapsed seconds at each profile point. Recorded timestamps drive the pace when the
 * track has a recorded duration and `ignoreRecordedTime` is off; `paceFactor` then
 * stretches only the recorded walking, keeping its stops. Otherwise the hiking time
 * preset estimates moving time, breaks, and lunch, and the pace and stop factors scale
 * them separately.
 */
export function routeElapsedSeconds(
  points: readonly TrackTimingPoint[],
  metrics: TrackTimingMetrics,
  timing: TrackWeatherTiming,
): RouteElapsedSeconds {
  const recorded =
    metrics.elapsedSeconds === undefined || timing.ignoreRecordedTime
      ? null
      : recordedElapsedSeconds(points);
  if (recorded !== null) {
    const movingSteps =
      timing.paceFactor === 1 ? null : analyzeRecordedHike(points)?.movingStepSeconds;
    let adjusted = 0;
    const elapsed = recorded.map((seconds, index) => {
      const step = index === 0 ? 0 : seconds - (recorded[index - 1] ?? seconds);
      const moving = movingSteps?.[index] ?? step;
      adjusted += step + moving * (timing.paceFactor - 1);
      return adjusted;
    });
    return { elapsed, recorded: true, estimate: null };
  }
  const estimate = estimateRouteHikingTime(points, metrics, timing);
  return { elapsed: estimate.elapsedSeconds, recorded: false, estimate };
}

/** Route timing settings with the parameters of the track's resolved preset. */
export type TimedTrackWeatherSettings = TrackWeatherTimelineSettings & {
  readonly hikingTime: HikingTimeParameters;
};

/**
 * Places the hiker on the route every three hours from the start and at the finish,
 * timed by `routeElapsedSeconds`; the timing adjusts the time for the forecast only.
 * Each checkpoint's forecast hour H is located at the highest point the hiker passes
 * from H:00 to the next hour on a hike that starts at the fractional local
 * `startHour`, waiting at the start before it and at the finish after it, so the hour
 * never misses a summit between two full hours. Only day hikes qualify: shorter than
 * 30 km and, after the adjustment, 12 hours.
 */
export function planTrackWeatherTimeline(
  profile: TrackTimingRoute,
  metrics: TrackTimingMetrics & Pick<TrackMetrics, 'distanceMeters'>,
  timing: TrackWeatherTiming,
  startHour: number,
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
    const untilSeconds = times[index + 1] ?? seconds;
    const firstHour = Math.floor(startHour + seconds / 3_600);
    const endHour = Math.max(
      firstHour + 1,
      Math.ceil(startHour + untilSeconds / 3_600),
    );
    const hours: TrackWeatherHour[] = [];
    for (let hour = firstHour; hour < endHour; hour += 1) {
      const fromSeconds = (hour - startHour) * 3_600;
      hours.push({
        hour,
        location: highestLocationBetween(
          points,
          elapsed,
          fromSeconds,
          fromSeconds + 3_600,
        ),
      });
    }
    return {
      ...locationAtElapsed(points, elapsed, seconds),
      kind: index === 0 ? 'start' : last ? 'finish' : 'interval',
      elapsedSeconds: seconds,
      hours,
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
  settings: TimedTrackWeatherSettings,
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
  settings: TimedTrackWeatherSettings,
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

/** Browser-local calendar date; forecast dates are labels in the track's time zone. */
export function localCalendarDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear().toString()}-${month}-${day}`;
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
 * Summarizes a checkpoint's forecast hours, each read from the forecast at the hiker's
 * location in that hour: `forecasts[index]` belongs to `checkpoint.hours[index]`. Hours
 * after midnight read the next date. Null unless every hour is forecast, so a late start
 * on the last date never summarizes a truncated window.
 */
export function summarizeTrackWeatherCheckpoint(
  date: string,
  checkpoint: TrackWeatherCheckpoint,
  forecasts: readonly PointWeatherForecast[],
): TrackWeatherCheckpointPeriod | null {
  const dayStart = parseLocalDate(date);
  const hours: HourlyWeatherForecast[] = [];
  for (const [index, { hour }] of checkpoint.hours.entries()) {
    const time = localDateTime(dayStart + hour * 3_600_000);
    const sample = forecasts[index]?.hourly.find((value) => value.time === time);
    if (sample === undefined) return null;
    hours.push(sample);
  }
  if (hours.length === 0) return null;
  const isDay = hours.filter((hour) => hour.isDay).length * 2 >= hours.length;
  return { isDay, period: summarizeWeatherPeriod(hours, isDay ? 'day' : 'night') };
}
