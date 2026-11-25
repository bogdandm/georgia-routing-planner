/**
 * Moving time, breaks, and lunch of a recorded hike, measured the way the hiking time
 * calibration measured them, so a preset's estimate can be compared part by part.
 */

import {
  GRADE_BANDS_ASCENDING,
  gradeBandForGrade,
  type GradeBand,
} from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { recordedElapsedSeconds } from '@/domain/tracks/profileTiming';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';

/** A stop is judged on displacement across this many seconds either side. */
const STOP_WINDOW_HALF_SECONDS = 30;
/** Slower than this across the window counts as standing. */
const STOP_MAXIMUM_METERS_PER_SECOND = 0.25;
/** Climbing or descending faster than this is walking, however small the displacement. */
const STOP_MAXIMUM_VERTICAL_METERS_PER_HOUR = 126;
/** Stops separated by less movement than this are one stop. */
const STOP_MERGE_MOVING_SECONDS = 60;
/** Shorter stops are part of walking. */
const BREAK_MINIMUM_SECONDS = 60;
const LUNCH_MINIMUM_SECONDS = 20 * 60;
/** Lunch starts within this share of the hike's moving time. */
const LUNCH_EARLIEST_MOVING_FRACTION = 0.15;
const LUNCH_LATEST_MOVING_FRACTION = 0.85;

/** Grade is measured over this distance, matching the hiking time estimate. */
const GRADE_WINDOW_METERS = 120;
/** Bands walked for less than this say little about speed. */
const MINIMUM_BAND_DISTANCE_METERS = 200;

export interface RecordedHikePoint {
  readonly coordinate: TrackCoordinate;
  readonly recordedAt?: string;
  readonly elevationMeters?: number;
  readonly distanceMeters: number;
  readonly sourceSegmentIndex: number;
}

export interface RecordedHikeAnalysis {
  /** First to last timestamp. */
  readonly totalSeconds: number;
  readonly movingSeconds: number;
  /** Interior stops of at least a minute, lunch excluded. */
  readonly breakSeconds: number;
  /** The lunch stop; zero when the hike had none. */
  readonly lunchSeconds: number;
  /** Standing before the first and after the last movement. */
  readonly idleSeconds: number;
  /** Moving seconds of each step `index - 1 → index`; zero inside stops. */
  readonly movingStepSeconds: readonly number[];
}

interface Stop {
  /** First and last stopped step. */
  firstStep: number;
  lastStep: number;
  readonly startSeconds: number;
  endSeconds: number;
}

/** Position and elevation at an elapsed time; `hint` speeds ascending queries. */
function positionAt(
  points: readonly RecordedHikePoint[],
  elapsed: readonly number[],
  seconds: number,
  hint: { index: number },
): { coordinate: TrackCoordinate; elevationMeters?: number } {
  const last = points.length - 1;
  while (hint.index < last && (elapsed[hint.index + 1] ?? 0) <= seconds) {
    hint.index += 1;
  }
  const next = Math.min(hint.index + 1, last);
  const start = points[hint.index];
  const end = points[next];
  if (start === undefined || end === undefined) {
    throw new RangeError('A recorded hike needs points.');
  }
  const startSeconds = elapsed[hint.index] ?? 0;
  const endSeconds = elapsed[next] ?? startSeconds;
  const fraction =
    endSeconds > startSeconds
      ? Math.min(Math.max((seconds - startSeconds) / (endSeconds - startSeconds), 0), 1)
      : 0;
  const coordinate: TrackCoordinate = [
    start.coordinate[0] + (end.coordinate[0] - start.coordinate[0]) * fraction,
    start.coordinate[1] + (end.coordinate[1] - start.coordinate[1]) * fraction,
  ];
  if (start.elevationMeters === undefined || end.elevationMeters === undefined) {
    return { coordinate };
  }
  return {
    coordinate,
    elevationMeters:
      start.elevationMeters + (end.elevationMeters - start.elevationMeters) * fraction,
  };
}

/** Whether each step stands still across the window centred on its middle. */
function stoppedSteps(
  points: readonly RecordedHikePoint[],
  elapsed: readonly number[],
  totalSeconds: number,
): boolean[] {
  const stopped = points.map(() => false);
  const lowHint = { index: 0 };
  const highHint = { index: 0 };
  for (let index = 1; index < points.length; index += 1) {
    const middle = ((elapsed[index - 1] ?? 0) + (elapsed[index] ?? 0)) / 2;
    const lowSeconds = Math.max(middle - STOP_WINDOW_HALF_SECONDS, 0);
    const highSeconds = Math.min(middle + STOP_WINDOW_HALF_SECONDS, totalSeconds);
    const duration = highSeconds - lowSeconds;
    const low = positionAt(points, elapsed, lowSeconds, lowHint);
    const high = positionAt(points, elapsed, highSeconds, highHint);
    const displacement = geodesicDistanceMeters(low.coordinate, high.coordinate);
    const verticalMetersPerHour =
      low.elevationMeters === undefined || high.elevationMeters === undefined
        ? 0
        : (Math.abs(high.elevationMeters - low.elevationMeters) / duration) * 3_600;
    stopped[index] =
      displacement / duration < STOP_MAXIMUM_METERS_PER_SECOND &&
      verticalMetersPerHour < STOP_MAXIMUM_VERTICAL_METERS_PER_HOUR;
  }
  return stopped;
}

/** Runs of stopped steps, merged across short movement. */
function mergedStops(stopped: readonly boolean[], elapsed: readonly number[]): Stop[] {
  const stops: Stop[] = [];
  for (let index = 1; index < stopped.length; index += 1) {
    if (stopped[index] !== true) continue;
    const startSeconds = elapsed[index - 1] ?? 0;
    const endSeconds = elapsed[index] ?? startSeconds;
    const previous = stops.at(-1);
    if (
      previous !== undefined &&
      startSeconds - previous.endSeconds < STOP_MERGE_MOVING_SECONDS
    ) {
      previous.lastStep = index;
      previous.endSeconds = endSeconds;
    } else {
      stops.push({ firstStep: index, lastStep: index, startSeconds, endSeconds });
    }
  }
  return stops;
}

/**
 * Splits recorded time into moving, breaks, lunch, and idle time; null unless every
 * point has a timestamp and time advances. Linear in the number of points.
 */
export function analyzeRecordedHike(
  points: readonly RecordedHikePoint[],
): RecordedHikeAnalysis | null {
  const elapsed = recordedElapsedSeconds(points);
  if (elapsed === null) return null;
  const totalSeconds = elapsed.at(-1) ?? 0;
  const stops = mergedStops(stoppedSteps(points, elapsed, totalSeconds), elapsed);

  const movingStepSeconds = elapsed.map((seconds, index) =>
    index === 0 ? 0 : seconds - (elapsed[index - 1] ?? seconds),
  );

  let idleSeconds = 0;
  const interiorStops: Stop[] = [];
  for (const stop of stops) {
    const duration = stop.endSeconds - stop.startSeconds;
    const idle = stop.startSeconds <= 0 || stop.endSeconds >= totalSeconds;
    if (!idle && duration < BREAK_MINIMUM_SECONDS) continue;
    for (let index = stop.firstStep; index <= stop.lastStep; index += 1) {
      movingStepSeconds[index] = 0;
    }
    if (idle) idleSeconds += duration;
    else interiorStops.push(stop);
  }

  let movingSeconds = 0;
  for (const seconds of movingStepSeconds) movingSeconds += seconds;

  // Lunch: the longest long stop in the middle part of the walking.
  let lunch: Stop | undefined;
  let stopIndex = 0;
  let movingBefore = 0;
  for (
    let index = 1;
    index < points.length && stopIndex < interiorStops.length;
    index += 1
  ) {
    const stop = interiorStops[stopIndex];
    if (stop === undefined) break;
    if (index === stop.firstStep) {
      const duration = stop.endSeconds - stop.startSeconds;
      const share = movingSeconds > 0 ? movingBefore / movingSeconds : 0;
      if (
        duration >= LUNCH_MINIMUM_SECONDS &&
        share >= LUNCH_EARLIEST_MOVING_FRACTION &&
        share <= LUNCH_LATEST_MOVING_FRACTION &&
        (lunch === undefined || duration > lunch.endSeconds - lunch.startSeconds)
      ) {
        lunch = stop;
      }
      stopIndex += 1;
    }
    movingBefore += movingStepSeconds[index] ?? 0;
  }

  let stoppedSeconds = 0;
  for (const stop of interiorStops)
    stoppedSeconds += stop.endSeconds - stop.startSeconds;
  const lunchSeconds = lunch === undefined ? 0 : lunch.endSeconds - lunch.startSeconds;
  return {
    totalSeconds,
    movingSeconds,
    breakSeconds: stoppedSeconds - lunchSeconds,
    lunchSeconds,
    idleSeconds,
    movingStepSeconds,
  };
}

export interface GradeBandComparison {
  readonly band: GradeBand;
  readonly distanceMeters: number;
  readonly recordedMovingSeconds: number;
  readonly estimatedMovingSeconds: number;
}

interface ElevationRun {
  readonly distances: number[];
  readonly elevations: number[];
}

/** Linear elevation at distances queried in ascending order within one run. */
function elevationAt(
  run: ElevationRun,
  distanceMeters: number,
  hint: { index: number },
): number {
  const { distances, elevations } = run;
  const last = distances.length - 1;
  while (hint.index < last && (distances[hint.index + 1] ?? 0) <= distanceMeters) {
    hint.index += 1;
  }
  const start = distances[hint.index] ?? 0;
  const end = distances[hint.index + 1];
  const startElevation = elevations[hint.index] ?? 0;
  if (end === undefined || end <= start || distanceMeters <= start)
    return startElevation;
  const endElevation = elevations[hint.index + 1] ?? startElevation;
  return (
    startElevation +
    ((endElevation - startElevation) * (distanceMeters - start)) / (end - start)
  );
}

/**
 * Recorded and estimated moving time per grade band. A step's grade spans a 120 m
 * window centred on it within its source segment, as in the estimate; steps without
 * elevation count as flat. Bands walked for less than 200 m are left out.
 */
export function compareGradeBands(
  points: readonly RecordedHikePoint[],
  recordedMovingStepSeconds: readonly number[],
  estimatedMovingElapsedSeconds: readonly number[],
): readonly GradeBandComparison[] {
  const runs = new Map<number, ElevationRun>();
  for (const point of points) {
    if (point.elevationMeters === undefined) continue;
    let run = runs.get(point.sourceSegmentIndex);
    if (run === undefined) {
      run = { distances: [], elevations: [] };
      runs.set(point.sourceSegmentIndex, run);
    }
    run.distances.push(point.distanceMeters);
    run.elevations.push(point.elevationMeters);
  }

  const totals = new Map<
    GradeBand,
    { distance: number; recorded: number; estimated: number }
  >();
  const lowHint = { index: 0 };
  const highHint = { index: 0 };
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) continue;
    if (previous.sourceSegmentIndex !== point.sourceSegmentIndex) {
      lowHint.index = 0;
      highHint.index = 0;
      continue;
    }
    const distance = point.distanceMeters - previous.distanceMeters;
    if (distance <= 0) continue;
    const run = runs.get(point.sourceSegmentIndex);
    let grade = 0;
    if (
      run !== undefined &&
      previous.elevationMeters !== undefined &&
      point.elevationMeters !== undefined
    ) {
      const middle = (previous.distanceMeters + point.distanceMeters) / 2;
      const runStart = run.distances[0] ?? 0;
      const runEnd = run.distances.at(-1) ?? runStart;
      const low = Math.max(middle - GRADE_WINDOW_METERS / 2, runStart);
      const high = Math.min(middle + GRADE_WINDOW_METERS / 2, runEnd);
      if (high - low > 1) {
        grade =
          ((elevationAt(run, high, highHint) - elevationAt(run, low, lowHint)) /
            (high - low)) *
          100;
      }
    }
    const band = gradeBandForGrade(grade);
    let total = totals.get(band);
    if (total === undefined) {
      total = { distance: 0, recorded: 0, estimated: 0 };
      totals.set(band, total);
    }
    total.distance += distance;
    total.recorded += recordedMovingStepSeconds[index] ?? 0;
    total.estimated +=
      (estimatedMovingElapsedSeconds[index] ?? 0) -
      (estimatedMovingElapsedSeconds[index - 1] ?? 0);
  }

  const comparisons: GradeBandComparison[] = [];
  for (const band of GRADE_BANDS_ASCENDING) {
    const total = totals.get(band);
    if (total === undefined || total.distance < MINIMUM_BAND_DISTANCE_METERS) continue;
    comparisons.push({
      band,
      distanceMeters: total.distance,
      recordedMovingSeconds: total.recorded,
      estimatedMovingSeconds: total.estimated,
    });
  }
  return comparisons;
}
