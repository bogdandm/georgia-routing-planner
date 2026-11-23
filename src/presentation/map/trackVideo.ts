import type { TrackTimingPoint } from '@/application/weather/TrackWeatherForecast';
import type { ElevationProfile } from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import { videoFrameRate, type VideoOverlay } from '@/presentation/map/mapCapture';

/** A timed route: `elapsedSeconds[i]` is when the hiker reaches `points[i]`. */
export interface TrackVideoRoute {
  readonly points: readonly TrackTimingPoint[];
  readonly elapsedSeconds: readonly number[];
  /**
   * Whether `elapsedSeconds` are recorded timestamps, whose breaks the video shortens;
   * an estimate has none, and its slow steep stretches are walking.
   */
  readonly recordedTime: boolean;
  /** When the hike starts; the finish is `startMs` plus the last elapsed second. */
  readonly startMs: number;
  /** The track's stated ascent: the climb shown in the video ends at it. */
  readonly ascentMeters: number | undefined;
  /**
   * Route distances, in meters, of the descents of the track's elevation profile (its
   * macro segments): where the camera may turn aside to keep the hiker in view.
   */
  readonly descents: readonly {
    readonly startMeters: number;
    readonly endMeters: number;
  }[];
  /**
   * Sun-shadow instant held through the whole video, or null for each moment's own
   * minute. A held instant renders the shadows once, so the recording is much faster.
   */
  readonly fixedSunInstantMs: number | null;
  /** Display text for the frame overlay, in the route's time zone and the UI locale. */
  readonly labels: {
    readonly time: (instantMs: number) => string;
    readonly distance: (meters: number) => string;
    readonly ascent: (meters: number) => string;
  };
}

export interface TrackVideoFrame {
  /** The hiker at this moment: the marker on the track. */
  readonly position: TrackCoordinate;
  /**
   * Camera center: the hiker's path averaged over a second, so the map glides instead
   * of following every kink of the track, and never far enough off to lose the hiker.
   */
  readonly center: TrackCoordinate;
  readonly bearing: number;
  readonly pitch: number;
  /** Sun-shadow instant of this moment, rounded to the minute. */
  readonly sunInstantMs: number;
  readonly overlay: VideoOverlay;
  readonly durationMs: number;
}

export interface TrackVideoPlan {
  readonly zoom: number;
  readonly frames: readonly TrackVideoFrame[];
  /** Frame ranges, `to` exclusive, of descents long enough for the camera to turn. */
  readonly descents: readonly { readonly from: number; readonly to: number }[];
}

/**
 * MapLibre event data of a track video's own camera jumps: `movestart` handlers tell
 * them from the user moving the map, which stops the recording.
 */
export const trackVideoCameraJump = { trackVideoCameraJump: true } as const;

export function isTrackVideoCameraJump(event: object): boolean {
  return 'trackVideoCameraJump' in event;
}

/**
 * Every track video lasts 25 seconds: 24 of travel, starting in motion, then the finish
 * held for a second.
 */
const travelVideoSeconds = 24;
const finishHoldMs = 1_000;
/** Share of the travel time spent speeding up at the start and slowing at the finish. */
const easeShare = 0.08;
/** Stops together take at most this share of the travel, the walking the rest. */
const maximumStopsShare = 0.25;
/**
 * The map moves along the route at an even speed, nudged by the hiker's pace: a stretch
 * walked at `r` times the route's average pace plays `r ** paceInfluence` times as fast,
 * within these bounds, so a climb is somewhat slower than a descent, never several times.
 */
const paceInfluence = 0.35;
const slowestPaceFactor = 0.75;
const fastestPaceFactor = 1.35;
/** The pace at a point is measured over this much of the route each side. */
const paceWindowMeters = 150;
/**
 * The user's zoom and pitch are kept within these bounds: closer or farther than this
 * the hiker's surroundings stop reading, and above this pitch the horizon fills the
 * frame and nearby ridges hide the hiker.
 */
const minimumZoom = 12;
const maximumZoom = 16;
const maximumPitchDegrees = 60;
/** Staying within this radius for at least this long is a stop. */
const stopRadiusMeters = 25;
const stopMinimumSeconds = 3 * 60;
/**
 * A recording gap at least `gapMinimumSeconds` long, covered slower than this speed, is
 * a paused recorder, also a stop.
 */
const gapMinimumSeconds = 60;
const gapMaximumMetersPerSecond = 0.2;
const gapWalkingMetersPerSecond = 1;
/**
 * The stop scan starts at most this often, bounding its work on dense recordings; a
 * stay that began among skipped points is measured from its first one.
 */
const stopAnchorSpacingSeconds = 5;
/**
 * A stop plays this much video per minute it lasted, up to the maximum: the hiker
 * visibly rests while the clock and the light run on, without long still stretches.
 */
const stopVideoSecondsPerMinute = 0.1;
const maximumStopVideoSeconds = 0.6;
/** Mini-profile resolution: elevation samples across the whole route. */
const profileSamples = 120;
const minuteMs = 60_000;
/** Camera-center smoothing: a triangular average over this many frames each side. */
const centerSmoothingFrames = 15;
/**
 * The smoothed center stays within this many CSS pixels of the hiker, which keeps the
 * hiker in view where the route jumps between recorded segments.
 */
const maximumCenterOffsetPixels = 120;
/**
 * The camera faces the route's general direction, from this far behind the hiker to
 * as far ahead (a share of the route, within bounds), so switchbacks and kinks cancel
 * out instead of swinging the view.
 */
const headingBaselineShare = 0.1;
const minimumHeadingBaselineMeters = 600;
const maximumHeadingBaselineMeters = 3_000;
/**
 * Where the route behind and ahead lie closer than this share of the baseline, right
 * at a turnaround, they give no direction and the previous heading holds. Kept small:
 * across switchbacks the chord is short too, yet still points up the slope.
 */
const minimumHeadingChordShare = 0.05;
/**
 * The heading is then averaged twice over this many frames each side: the view turns
 * gently over several seconds.
 */
const headingSmoothingFrames = 60;
/**
 * Descents shorter than this many frames are not worth a turn, and descents closer
 * than `descentMergeFrames` count as one, so the camera does not turn on short pieces.
 */
const minimumDescentFrames = 3 * videoFrameRate;
const descentMergeFrames = 2 * videoFrameRate;
const earthCircumferenceMeters = 40_075_016.686;
/** MapLibre world units per tile at zoom 0. */
const mapTileSizePixels = 512;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** First index whose value reaches `target` in a non-decreasing array, or the last. */
function firstAtLeast(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? Infinity) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** `values` at fractional position `position` between neighbouring entries. */
function valueAt(values: readonly number[], position: number): number {
  const below = clamp(Math.floor(position), 0, values.length - 1);
  const above = Math.min(values.length - 1, below + 1);
  const start = values[below] ?? 0;
  return start + ((values[above] ?? start) - start) * (position - below);
}

function metersPerPixel(latitude: number, zoom: number): number {
  return (
    (earthCircumferenceMeters * Math.cos((latitude * Math.PI) / 180)) /
    (mapTileSizePixels * 2 ** zoom)
  );
}

/** How a route plays: video seconds and the drawn hiker at each point. */
interface VideoTimeline {
  /** Video seconds of travel up to each point, the walking eased (see `videoAt`). */
  readonly seconds: readonly number[];
  /**
   * Video seconds at `fraction` of the way from point `step − 1` to point `step`. The
   * ease bends time within a step too, which matters where points are sparse.
   */
  readonly videoAt: (step: number, fraction: number) => number;
  /** Where the hiker is drawn at each point: through a stop, where it began. */
  readonly display: readonly TrackCoordinate[];
  /** Route distance shown at each point; a stop holds it as well. */
  readonly distances: readonly number[];
}

/**
 * On recorded time, a paused recorder (a gap of at least `gapMinimumSeconds` covered
 * slower than `gapMaximumMetersPerSecond`) gets a resting point at the gap's start,
 * timed so the gap's distance is then walked at `gapWalkingMetersPerSecond`. The step
 * to that point is a rest (`pausedSteps`), a stop however short the pause was.
 */
function withRestPoints(
  points: readonly TrackTimingPoint[],
  elapsed: readonly number[],
  recordedTime: boolean,
): {
  readonly points: TrackTimingPoint[];
  readonly elapsed: number[];
  readonly pausedSteps: number[];
} {
  const restedPoints: TrackTimingPoint[] = [];
  const restedElapsed: number[] = [];
  const pausedSteps: number[] = [];
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    const previousSeconds = elapsed[index - 1] ?? 0;
    const seconds = elapsed[index] ?? previousSeconds;
    if (
      recordedTime &&
      previous?.sourceSegmentIndex === point.sourceSegmentIndex &&
      seconds - previousSeconds >= gapMinimumSeconds
    ) {
      const meters = point.distanceMeters - previous.distanceMeters;
      if (meters < (seconds - previousSeconds) * gapMaximumMetersPerSecond) {
        pausedSteps.push(restedPoints.length);
        restedPoints.push(previous);
        restedElapsed.push(
          Math.max(previousSeconds, seconds - meters / gapWalkingMetersPerSecond),
        );
      }
    }
    restedPoints.push(point);
    restedElapsed.push(seconds);
  }
  return { points: restedPoints, elapsed: restedElapsed, pausedSteps };
}

/**
 * Longitudes made continuous, so the hiker and the camera cross the antimeridian the
 * short way instead of travelling around the world.
 */
function unwrappedPoints(points: readonly TrackTimingPoint[]): TrackTimingPoint[] {
  let previous: number | null = null;
  return points.map((point) => {
    let longitude = point.coordinate[0];
    if (previous !== null) longitude += Math.round((previous - longitude) / 360) * 360;
    previous = longitude;
    return longitude === point.coordinate[0]
      ? point
      : { ...point, coordinate: [longitude, point.coordinate[1]] };
  });
}

/** Inverse of `easedTravel`, by bisection: the time share at travel share `share`. */
function easedTime(share: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (easedTravel(middle) < share) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * Lays the route out in `travelVideoSeconds` of video. Walking is spread along the
 * drawn path by distance, nudged by the local pace (see `paceInfluence`), and eased in
 * and out at its ends. On recorded time, a stop (a stay within `stopRadiusMeters` for
 * `stopMinimumSeconds`, GPS jitter included, or a paused recorder's rest in
 * `pausedSteps`) plays briefly with the hiker held at its first point; stops at the
 * very start and end take no time. Waits between recorded segments take no time either.
 */
function videoTimeline(
  points: readonly TrackTimingPoint[],
  elapsed: readonly number[],
  recordedTime: boolean,
  pausedSteps: readonly number[],
): VideoTimeline {
  const display = points.map((point) => point.coordinate);
  const distances = points.map((point) => point.distanceMeters);
  // The stop each step (from point k − 1 to k) belongs to, as an index into `stops`.
  const stopOfStep = points.map(() => -1);
  const stops: number[] = [];
  if (recordedTime) {
    const within = (anchor: TrackTimingPoint, other: TrackTimingPoint | undefined) =>
      other?.sourceSegmentIndex === anchor.sourceSegmentIndex &&
      geodesicDistanceMeters(anchor.coordinate, other.coordinate) <= stopRadiusMeters;
    // A scan that reaches its segment's end too soon proves no later point of the
    // segment starts a stop either, since each has less time left; their scans are
    // skipped.
    let noStopThrough = -1;
    // Scans start at most every `stopAnchorSpacingSeconds` and cover three minutes, so
    // a point is visited a bounded number of times however dense the recording is.
    let lastScanSeconds = -Infinity;
    let lastScanIndex = -1;
    // A stop that starts where the previous one ended continues it: a long break with
    // GPS jitter beyond `stopRadiusMeters` stays one short pause, held in one place.
    let previousStopEnd = -1;
    let index = 0;
    while (index < points.length - 1) {
      const anchor = points[index];
      if (anchor === undefined) break;
      if (
        index > noStopThrough &&
        (index === previousStopEnd ||
          (elapsed[index] ?? 0) - lastScanSeconds >= stopAnchorSpacingSeconds)
      ) {
        lastScanSeconds = elapsed[index] ?? 0;
        // The stay may have begun among the points skipped since the last scan.
        let first = index;
        while (
          first - 1 > Math.max(lastScanIndex, previousStopEnd) &&
          within(anchor, points[first - 1])
        ) {
          first -= 1;
        }
        lastScanIndex = index;
        const startSeconds = elapsed[first] ?? 0;
        let end = index;
        while (
          (elapsed[end] ?? 0) - startSeconds < stopMinimumSeconds &&
          within(anchor, points[end + 1])
        ) {
          end += 1;
        }
        if ((elapsed[end] ?? 0) - startSeconds >= stopMinimumSeconds) {
          while (within(anchor, points[end + 1])) end += 1;
          const duration = (elapsed[end] ?? 0) - startSeconds;
          const continued = first === previousStopEnd ? (stopOfStep[first] ?? -1) : -1;
          const stop = continued === -1 ? stops.push(duration) - 1 : continued;
          if (continued !== -1) stops[stop] = (stops[stop] ?? 0) + duration;
          // `display[first]` is where the stay began, or where a continued stop is held.
          const heldAt = display[first] ?? anchor.coordinate;
          const heldDistance = distances[first] ?? anchor.distanceMeters;
          for (let held = first + 1; held <= end; held += 1) {
            stopOfStep[held] = stop;
            display[held] = heldAt;
            distances[held] = heldDistance;
          }
          previousStopEnd = end;
          index = end;
          continue;
        }
        if (points[end + 1]?.sourceSegmentIndex !== anchor.sourceSegmentIndex) {
          noStopThrough = end;
        }
      }
      index += 1;
    }
  }
  // A paused recorder rests in place however short the pause, joining a stop just
  // before it.
  for (const step of pausedSteps) {
    if (stopOfStep[step] !== -1) continue;
    const seconds = Math.max(0, (elapsed[step] ?? 0) - (elapsed[step - 1] ?? 0));
    const joined = stopOfStep[step - 1] ?? -1;
    const stop = joined === -1 ? stops.push(seconds) - 1 : joined;
    if (joined !== -1) stops[stop] = (stops[stop] ?? 0) + seconds;
    stopOfStep[step] = stop;
    display[step] = display[step - 1] ?? display[step] ?? [0, 0];
    distances[step] = distances[step - 1] ?? distances[step] ?? 0;
  }

  const sameSegment = (step: number) =>
    step > 0 &&
    points[step]?.sourceSegmentIndex === points[step - 1]?.sourceSegmentIndex;
  const stepMeters = points.map((_, step) =>
    sameSegment(step)
      ? geodesicDistanceMeters(
          display[step - 1] ?? display[step] ?? [0, 0],
          display[step] ?? [0, 0],
        )
      : 0,
  );
  const stepWalking = points.map((_, step) =>
    sameSegment(step) && stopOfStep[step] === -1
      ? Math.max(0, (elapsed[step] ?? 0) - (elapsed[step - 1] ?? 0))
      : 0,
  );
  let meters = 0;
  let walking = 0;
  const cumulativeMeters = stepMeters.map((step) => (meters += step));
  const cumulativeWalking = stepWalking.map((step) => (walking += step));
  const averagePace = walking > 0 ? meters / walking : 0;

  // Walking weight per step: distance over the pace factor of the stretch around it.
  const weights = stepMeters.map((stepLength, step) => {
    if (stepLength <= 0) return 0;
    if (averagePace <= 0) return stepLength;
    const here = cumulativeMeters[step] ?? 0;
    // The window always includes the step itself, from its start to its end.
    const from = firstAtLeast(cumulativeMeters, here - stepLength - paceWindowMeters);
    const to = firstAtLeast(cumulativeMeters, here + paceWindowMeters);
    const windowWalking = (cumulativeWalking[to] ?? 0) - (cumulativeWalking[from] ?? 0);
    const windowMeters = (cumulativeMeters[to] ?? 0) - (cumulativeMeters[from] ?? 0);
    const factor =
      windowWalking <= 0
        ? fastestPaceFactor
        : clamp(
            (windowMeters / windowWalking / averagePace) ** paceInfluence,
            slowestPaceFactor,
            fastestPaceFactor,
          );
    return stepLength / factor;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  // Waiting before the start or after the finish is not part of the hike: it takes no
  // video time, so the video opens and closes on the hiker moving.
  const leadingStop = stopOfStep[1] ?? -1;
  const trailingStop = stopOfStep.at(-1) ?? -1;
  const stopVideoSeconds = stops.map((seconds, stop) =>
    stop === leadingStop || stop === trailingStop
      ? 0
      : Math.min(maximumStopVideoSeconds, (seconds / 60) * stopVideoSecondsPerMinute),
  );
  const allStopsSeconds = stopVideoSeconds.reduce((sum, seconds) => sum + seconds, 0);
  // Many stops share the stop allowance; a route that never moves is all stop.
  const stopScale =
    totalWeight <= 0
      ? allStopsSeconds > 0
        ? travelVideoSeconds / allStopsSeconds
        : 0
      : Math.min(
          1,
          (travelVideoSeconds * maximumStopsShare) / Math.max(allStopsSeconds, 1e-9),
        );
  const walkingVideoSeconds =
    totalWeight <= 0 ? 0 : travelVideoSeconds - allStopsSeconds * stopScale;
  // Walking progress and stop time accumulate separately; only the walking is eased,
  // so a stop lasts its share of video wherever it falls.
  let walked = 0;
  let rested = 0;
  const walkedShares: number[] = [];
  const restedSeconds: number[] = [];
  for (let step = 0; step < points.length; step += 1) {
    if (totalWeight > 0) walked += (weights[step] ?? 0) / totalWeight;
    const stop = stopOfStep[step] ?? -1;
    const stopSeconds = stops[stop] ?? 0;
    if (stop !== -1 && stopSeconds > 0) {
      // Spread over the stop's points by their real time, so the clock runs evenly.
      const stepSeconds = Math.max(0, (elapsed[step] ?? 0) - (elapsed[step - 1] ?? 0));
      rested += ((stopVideoSeconds[stop] ?? 0) * stopScale * stepSeconds) / stopSeconds;
    }
    walkedShares.push(Math.min(1, walked));
    restedSeconds.push(rested);
  }
  const videoAt = (step: number, fraction: number) => {
    const before = Math.max(0, step - 1);
    const share = valueAt(walkedShares, before + (step - before) * fraction);
    const rest = valueAt(restedSeconds, before + (step - before) * fraction);
    return walkingVideoSeconds * easedTime(share) + rest;
  };
  const seconds = points.map((_, step) => videoAt(step, 1));
  return { seconds, videoAt, display, distances };
}

/**
 * Climb up to each point from elevation rises within recorded segments, scaled so the
 * finish matches the track's stated ascent; null when the route has no elevation.
 */
function cumulativeAscent(
  points: readonly TrackTimingPoint[],
  statedMeters: number | undefined,
): number[] | null {
  if (points.every((point) => point.elevationMeters === undefined)) return null;
  let climbed = 0;
  const ascent = points.map((point, index) => {
    const previous = points[index - 1];
    if (
      previous?.sourceSegmentIndex === point.sourceSegmentIndex &&
      previous.elevationMeters !== undefined &&
      point.elevationMeters !== undefined
    ) {
      climbed += Math.max(0, point.elevationMeters - previous.elevationMeters);
    }
    return climbed;
  });
  if (statedMeters === undefined || climbed <= 0) return ascent;
  return ascent.map((meters) => (meters * statedMeters) / climbed);
}

/** Elevation at `profileSamples` evenly spaced distances; null without elevation. */
function elevationProfile(points: readonly TrackTimingPoint[]): number[] | null {
  const known = points.filter((point) => point.elevationMeters !== undefined);
  const totalMeters = points.at(-1)?.distanceMeters ?? 0;
  if (known.length < 2 || totalMeters <= 0) return null;
  const distances = known.map((point) => point.distanceMeters);
  return Array.from({ length: profileSamples }, (_, index) => {
    const distance = (totalMeters * index) / (profileSamples - 1);
    const after = Math.max(1, firstAtLeast(distances, distance));
    const before = known[after - 1];
    const next = known[after];
    if (before === undefined || next === undefined) return 0;
    const span = next.distanceMeters - before.distanceMeters;
    const fraction =
      span <= 0 ? 1 : clamp((distance - before.distanceMeters) / span, 0, 1);
    const low = before.elevationMeters ?? 0;
    return low + ((next.elevationMeters ?? low) - low) * fraction;
  });
}

/** Route position `distanceMeters` along it, clamped to its ends. */
function coordinateAtDistance(
  points: readonly TrackTimingPoint[],
  distances: readonly number[],
  distanceMeters: number,
): TrackCoordinate {
  const index = firstAtLeast(distances, distanceMeters);
  const after = points[index];
  const before = points[Math.max(0, index - 1)];
  if (after === undefined || before === undefined) throw new RangeError('Empty route.');
  const span = after.distanceMeters - before.distanceMeters;
  const fraction =
    span <= 0 ? 1 : clamp((distanceMeters - before.distanceMeters) / span, 0, 1);
  return [
    before.coordinate[0] + (after.coordinate[0] - before.coordinate[0]) * fraction,
    before.coordinate[1] + (after.coordinate[1] - before.coordinate[1]) * fraction,
  ];
}

/** Screen bearing on a north-up Web Mercator map from `from` to `to`. */
function screenBearing(from: TrackCoordinate, to: TrackCoordinate): number {
  const east = (to[0] - from[0]) * Math.cos((((from[1] + to[1]) / 2) * Math.PI) / 180);
  return (Math.atan2(east, to[1] - from[1]) * 180) / Math.PI;
}

/**
 * Headings averaged twice with their neighbours `reach` frames each side. Each heading
 * is first taken the short way round from the one before, so the series is continuous:
 * a reversal, as at an out-and-back's turnaround, turns the view smoothly through a
 * side instead of cancelling out into a jump. A frame without a heading keeps the
 * previous one; the first known heading covers the frames before it.
 */
function smoothedBearings(
  headings: readonly (number | null)[],
  reach: number,
): number[] {
  let previous = headings.find((heading) => heading !== null) ?? 0;
  const continuous = headings.map((heading) => {
    if (heading !== null)
      previous += ((((heading - previous) % 360) + 540) % 360) - 180;
    return previous;
  });
  return smoothed(smoothed(continuous, reach), reach);
}

/**
 * Descents of the track's elevation profile at the timing route's own distances. A
 * profile leaves out spans without elevation, so its distances can run short of the
 * route's: each descent's ends are found among the route's points by coordinate, in
 * route order. A descent whose ends are not found, and those after it, are left out.
 */
export function trackVideoDescents(
  profile: ElevationProfile | null,
  points: readonly TrackTimingPoint[],
): TrackVideoRoute['descents'] {
  const descents: { startMeters: number; endMeters: number }[] = [];
  if (profile === null) return descents;
  let cursor = 0;
  const routeMeters = (sampleIndex: number): number | null => {
    const coordinate = profile.points[sampleIndex]?.coordinate;
    if (coordinate === undefined) return null;
    for (; cursor < points.length; cursor += 1) {
      const point = points[cursor];
      if (
        point?.coordinate[0] === coordinate[0] &&
        point.coordinate[1] === coordinate[1]
      ) {
        return point.distanceMeters;
      }
    }
    return null;
  };
  for (const segment of profile.segments) {
    if (segment.type !== 'descent') continue;
    const startMeters = routeMeters(segment.startSampleIndex);
    const endMeters = routeMeters(segment.endSampleIndex);
    if (startMeters === null || endMeters === null) break;
    descents.push({ startMeters, endMeters });
  }
  return descents;
}

/**
 * Frame ranges of the route's descents: frames whose distance lies within one, merged
 * across gaps under `descentMergeFrames`, without those under `minimumDescentFrames`.
 */
function descentFrames(
  descents: TrackVideoRoute['descents'],
  frameDistances: readonly number[],
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const { startMeters, endMeters } of descents) {
    const from = firstAtLeast(frameDistances, startMeters);
    const to = firstAtLeast(frameDistances, endMeters);
    if (to <= from) continue;
    const last = ranges.at(-1);
    if (last !== undefined && from - last.to < descentMergeFrames) last.to = to;
    else ranges.push({ from, to });
  }
  return ranges.filter(({ from, to }) => to - from >= minimumDescentFrames);
}

/**
 * Share of the travel at time share `time`: the speed rises along a half cosine over
 * the first `easeShare` of the time, stays even, and falls the same way before the
 * finish, so the hiker starts and stops smoothly (ease in-out).
 */
function easedTravel(time: number): number {
  const ramp = (share: number) =>
    (share - (easeShare / Math.PI) * Math.sin((Math.PI * share) / easeShare)) / 2;
  const area = 1 - easeShare;
  if (time <= easeShare) return ramp(time) / area;
  if (time >= 1 - easeShare) return 1 - ramp(1 - time) / area;
  return (easeShare / 2 + time - easeShare) / area;
}

/**
 * Frames of a 25-second time-lapse of the hike (see `videoTimeline` for its pacing),
 * eased at both ends and held on the finish, while the clock and the sun show the real
 * time of each moment. The camera keeps the user's zoom and pitch within bounds,
 * follows the hiker's averaged path, and faces the route's general direction (see
 * `headingBaselineShare`), turning gently.
 */
export function planTrackVideo(
  route: TrackVideoRoute,
  camera: { readonly zoom: number; readonly pitch: number },
): TrackVideoPlan {
  const { startMs, labels } = route;
  if (route.points.length === 0) throw new RangeError('The route has no points.');
  const {
    points,
    elapsed: elapsedSeconds,
    pausedSteps,
  } = withRestPoints(
    unwrappedPoints(route.points),
    route.elapsedSeconds,
    route.recordedTime,
  );
  const timeline = videoTimeline(
    points,
    elapsedSeconds,
    route.recordedTime,
    pausedSteps,
  );
  // `travelVideoSeconds`, or less only for a route that never moves.
  const travelSeconds = timeline.seconds.at(-1) ?? 0;
  const ascent = cumulativeAscent(points, route.ascentMeters);
  const profile = elevationProfile(points);
  const totalMeters = points.at(-1)?.distanceMeters ?? 0;
  const travelFrames = travelVideoSeconds * videoFrameRate;
  const baselineMeters = clamp(
    totalMeters * headingBaselineShare,
    minimumHeadingBaselineMeters,
    maximumHeadingBaselineMeters,
  );
  const routeDistances = points.map((point) => point.distanceMeters);
  const zoom = clamp(camera.zoom, minimumZoom, maximumZoom);

  const moments = Array.from({ length: travelFrames + 1 }, (_, frame) => {
    // The timeline is already eased, so frames sample it evenly.
    const target = (frame / travelFrames) * travelSeconds;
    // Between the points whose video time brackets the target. The last frame is the
    // real finish, even after a final stop.
    const after =
      frame === travelFrames
        ? points.length - 1
        : target <= 0
          ? 0
          : firstAtLeast(timeline.seconds, target);
    const before = Math.max(0, after - 1);
    // Within the step, the fraction whose eased video time is the target; a step that
    // takes no video time, and the finish, sit at its end.
    let fraction = 1;
    if (
      frame !== travelFrames &&
      after > 0 &&
      (timeline.seconds[after] ?? 0) > (timeline.seconds[before] ?? 0)
    ) {
      let low = 0;
      let high = 1;
      for (let iteration = 0; iteration < 30; iteration += 1) {
        const middle = (low + high) / 2;
        if (timeline.videoAt(after, middle) < target) low = middle;
        else high = middle;
      }
      fraction = (low + high) / 2;
    }
    const position = before + (after - before) * fraction;
    const from = timeline.display[before];
    const to = timeline.display[after];
    if (from === undefined || to === undefined) throw new RangeError('Empty route.');
    const distanceMeters = valueAt(timeline.distances, position);
    return {
      position: [
        from[0] + (to[0] - from[0]) * fraction,
        from[1] + (to[1] - from[1]) * fraction,
      ] as TrackCoordinate,
      instantMs: startMs + valueAt(elapsedSeconds, position) * 1_000,
      distanceMeters,
      ascentMeters: ascent === null ? null : valueAt(ascent, position),
    };
  });
  // The general direction from the route behind the hiker to the route ahead. Where
  // those nearly meet, as around an out-and-back's turnaround, it is no direction.
  const headings = moments.map((moment) => {
    const behind = coordinateAtDistance(
      points,
      routeDistances,
      moment.distanceMeters - baselineMeters,
    );
    const ahead = coordinateAtDistance(
      points,
      routeDistances,
      moment.distanceMeters + baselineMeters,
    );
    return geodesicDistanceMeters(behind, ahead) >=
      baselineMeters * minimumHeadingChordShare
      ? screenBearing(behind, ahead)
      : null;
  });

  const pitch = clamp(camera.pitch, 0, maximumPitchDegrees);
  const bearings = smoothedBearings(headings, headingSmoothingFrames);
  const frames = moments.map((moment, index): TrackVideoFrame => {
    let weight = 0;
    let longitude = 0;
    let latitude = 0;
    for (
      let other = Math.max(0, index - centerSmoothingFrames);
      other <= Math.min(moments.length - 1, index + centerSmoothingFrames);
      other += 1
    ) {
      const nearby = moments[other];
      if (nearby === undefined) continue;
      const share = centerSmoothingFrames + 1 - Math.abs(other - index);
      longitude += nearby.position[0] * share;
      latitude += nearby.position[1] * share;
      weight += share;
    }
    const averaged: TrackCoordinate = [longitude / weight, latitude / weight];
    const offsetMeters = geodesicDistanceMeters(moment.position, averaged);
    const allowedMeters =
      maximumCenterOffsetPixels * metersPerPixel(moment.position[1], zoom);
    const keep = offsetMeters <= allowedMeters ? 1 : allowedMeters / offsetMeters;
    const center: TrackCoordinate = [
      moment.position[0] + (averaged[0] - moment.position[0]) * keep,
      moment.position[1] + (averaged[1] - moment.position[1]) * keep,
    ];
    // Back within ±180° of longitude, the hiker shifted along so it stays beside it.
    const shift = Math.round(center[0] / 360) * -360;
    return {
      position: [moment.position[0] + shift, moment.position[1]],
      center: [center[0] + shift, center[1]],
      bearing: bearings[index] ?? 0,
      pitch,
      sunInstantMs:
        route.fixedSunInstantMs ?? Math.round(moment.instantMs / minuteMs) * minuteMs,
      overlay: {
        time: labels.time(moment.instantMs),
        distance: labels.distance(moment.distanceMeters),
        ascent:
          moment.ascentMeters === null ? null : labels.ascent(moment.ascentMeters),
        profile:
          profile === null
            ? null
            : {
                elevations: profile,
                progress: totalMeters <= 0 ? 0 : moment.distanceMeters / totalMeters,
              },
      },
      // Each frame lasts until the next; the last one holds the finish.
      durationMs: index === travelFrames ? finishHoldMs : 1_000 / videoFrameRate,
    };
  });

  return {
    zoom,
    frames,
    descents: descentFrames(
      route.descents,
      moments.map((moment) => moment.distanceMeters),
    ),
  };
}

/** Canvas and terrain of the map, for sight lines from its camera. */
export interface TrackVideoView {
  /** Canvas height in CSS pixels. */
  readonly heightPixels: number;
  readonly fieldOfViewDegrees: number;
  readonly terrainExaggeration: number;
}

/**
 * Turns tried on a descent, in order of preference: the smaller angle first, either
 * side. The view never turns to look back at the hiker: wide swings disorient.
 */
const descentTurns = [60, -60, 90, -90] as const;
/** The hiker may drop out of view for this many frames on end before the camera turns. */
const toleratedHiddenFrames = 2 * videoFrameRate;
/**
 * A turn is eased by two moving averages over this many frames each side: about four
 * seconds in all, starting before the descent and ending after it.
 */
const turnSmoothingFrames = 60;
/** Every this many frames gets sight lines; frames between share their verdict. */
const occlusionStride = 6;
/** Samples along each sight line, denser near the hiker where slopes hide them. */
const sightLineSamples = 24;
const sightLineNearestMeters = 15;
/** Relief must rise this far above a sight line to hide the hiker's dot. */
const sightLineClearanceMeters = 3;

/** One sight line from the hiker to the camera, as MapLibre places the camera. */
export interface TrackVideoSightLine {
  readonly frameIndex: number;
  /** Turn from the planned bearing: 0, or one of `descentTurns`. */
  readonly bearingOffset: number;
  /** The hiker, the camera center, then the ground under the line, nearest first. */
  readonly coordinates: readonly TrackCoordinate[];
  /** Share of the way from the hiker to the camera at each ground point. */
  readonly shares: readonly number[];
  /** Camera height above the center's rendered terrain, in meters. */
  readonly cameraHeightMeters: number;
}

/** Point `meters` from `origin` toward screen bearing `bearing` on a local tangent. */
function offsetCoordinate(
  origin: TrackCoordinate,
  bearing: number,
  meters: number,
): TrackCoordinate {
  const radians = (bearing * Math.PI) / 180;
  const metersPerDegree = earthCircumferenceMeters / 360;
  return [
    origin[0] +
      (Math.sin(radians) * meters) /
        (metersPerDegree * Math.cos((origin[1] * Math.PI) / 180)),
    origin[1] + (Math.cos(radians) * meters) / metersPerDegree,
  ];
}

/**
 * Sight lines from the hiker to the camera on the plan's descents, every
 * `occlusionStride`-th frame, for the planned bearing and each of `descentTurns`.
 * MapLibre places the camera `height / 2 / tan(fov / 2)` pixels from the center (see
 * `directedCameraFit`), behind it by sin(pitch) of that and above the center's rendered
 * terrain by cos(pitch).
 */
export function trackVideoSightLines(
  plan: TrackVideoPlan,
  view: TrackVideoView,
): TrackVideoSightLine[] {
  const cameraPixels =
    view.heightPixels / 2 / Math.tan((view.fieldOfViewDegrees * Math.PI) / 360);
  const lines: TrackVideoSightLine[] = [];
  for (const { from, to } of plan.descents) {
    const first = from - (from % occlusionStride);
    for (let frameIndex = first; frameIndex < to; frameIndex += occlusionStride) {
      const frame = plan.frames[frameIndex];
      if (frame === undefined) continue;
      const cameraMeters = cameraPixels * metersPerPixel(frame.center[1], plan.zoom);
      const pitch = (frame.pitch * Math.PI) / 180;
      for (const bearingOffset of [0, ...descentTurns]) {
        const cameraGround = offsetCoordinate(
          frame.center,
          frame.bearing + bearingOffset + 180,
          cameraMeters * Math.sin(pitch),
        );
        const groundMeters = Math.max(
          1,
          geodesicDistanceMeters(frame.position, cameraGround),
        );
        const coordinates: TrackCoordinate[] = [frame.position, frame.center];
        const shares: number[] = [];
        for (let sample = 1; sample <= sightLineSamples; sample += 1) {
          const share = Math.max(
            sightLineNearestMeters / groundMeters,
            (sample / sightLineSamples) ** 2,
          );
          if (share >= 1) break;
          coordinates.push([
            frame.position[0] + (cameraGround[0] - frame.position[0]) * share,
            frame.position[1] + (cameraGround[1] - frame.position[1]) * share,
          ]);
          shares.push(share);
        }
        lines.push({
          frameIndex,
          bearingOffset,
          coordinates,
          shares,
          cameraHeightMeters: cameraMeters * Math.cos(pitch),
        });
      }
    }
  }
  return lines;
}

/**
 * Whether relief, at `elevations` (bare-earth meters: the hiker, the camera center, then
 * the ground points), rises over the line from the hiker to the camera.
 */
function hidesHiker(
  line: TrackVideoSightLine,
  elevations: readonly (number | null)[],
  exaggeration: number,
): boolean {
  const hiker = elevations[0];
  const center = elevations[1];
  if (hiker === null || hiker === undefined) return false;
  const cameraRise =
    ((center ?? hiker) - hiker) * exaggeration + line.cameraHeightMeters;
  return line.shares.some((share, index) => {
    const ground = elevations[index + 2];
    return (
      ground !== null &&
      ground !== undefined &&
      (ground - hiker) * exaggeration > share * cameraRise + sightLineClearanceMeters
    );
  });
}

/** Values averaged with their neighbours `reach` frames each side, ends kept. */
function smoothed(values: readonly number[], reach: number): number[] {
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (
      let other = Math.max(0, index - reach);
      other <= Math.min(values.length - 1, index + reach);
      other += 1
    ) {
      sum += values[other] ?? 0;
      count += 1;
    }
    return sum / count;
  });
}

/**
 * On each descent, turns the camera aside where relief would hide the hiker. A descent
 * keeps the planned view when it loses the hiker for at most `toleratedHiddenFrames` on
 * end; otherwise it takes the first of `descentTurns` that does, or failing all, the
 * view hiding the hiker least, ties going to the planned view and then the earlier
 * turn. One turn holds through the whole descent, eased in and out (see
 * `turnSmoothingFrames`), so the camera never swings on short pieces. Unknown heights
 * hide nothing. `elevations[i]` are the bare-earth heights at `lines[i].coordinates`.
 */
export function avoidTerrainOcclusion(
  plan: TrackVideoPlan,
  lines: readonly TrackVideoSightLine[],
  elevations: readonly (readonly (number | null)[])[],
  view: Pick<TrackVideoView, 'terrainExaggeration'>,
): TrackVideoPlan {
  // Hidden verdicts by bearing offset, then by sampled frame.
  const hidden = new Map<number, Map<number, boolean>>();
  for (const [index, line] of lines.entries()) {
    const verdicts = hidden.get(line.bearingOffset) ?? new Map<number, boolean>();
    hidden.set(line.bearingOffset, verdicts);
    verdicts.set(
      line.frameIndex,
      hidesHiker(line, elevations[index] ?? [], view.terrainExaggeration),
    );
  }

  const offsets = plan.frames.map(() => 0);
  for (const { from, to } of plan.descents) {
    let chosen = 0;
    let leastHidden = Infinity;
    for (const offset of [0, ...descentTurns]) {
      const verdicts = hidden.get(offset);
      let total = 0;
      let run = 0;
      let longest = 0;
      for (let frame = from; frame < to; frame += 1) {
        if (verdicts?.get(frame - (frame % occlusionStride)) === true) {
          total += 1;
          run += 1;
          longest = Math.max(longest, run);
        } else {
          run = 0;
        }
      }
      if (longest <= toleratedHiddenFrames) {
        chosen = offset;
        break;
      }
      if (total < leastHidden) {
        chosen = offset;
        leastHidden = total;
      }
    }
    for (let frame = from; frame < to; frame += 1) offsets[frame] = chosen;
  }
  if (offsets.every((offset) => offset === 0)) return plan;

  const eased = smoothed(smoothed(offsets, turnSmoothingFrames), turnSmoothingFrames);
  return {
    ...plan,
    frames: plan.frames.map((frame, index) => ({
      ...frame,
      bearing: frame.bearing + (eased[index] ?? 0),
    })),
  };
}
