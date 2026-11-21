import type { TrackTimingPoint } from '@/application/weather/TrackWeatherForecast';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import { videoFrameRate, type VideoOverlay } from '@/presentation/map/mapCapture';

/** A timed route: `elapsedSeconds[i]` is when the hiker reaches `points[i]`. */
export interface TrackVideoRoute {
  readonly points: readonly TrackTimingPoint[];
  readonly elapsedSeconds: readonly number[];
  /** When the hike starts; the finish is `startMs` plus the last elapsed second. */
  readonly startMs: number;
  /** The track's stated ascent: the climb shown in the video ends at it. */
  readonly ascentMeters: number | undefined;
  /** Display text for the frame overlay, in the route's time zone and the UI locale. */
  readonly labels: {
    readonly time: (instantMs: number) => string;
    readonly distance: (meters: number) => string;
    readonly ascent: (meters: number) => string;
  };
}

export interface TrackVideoFrame {
  /** The hiker at this moment: the marker and the camera center. */
  readonly position: TrackCoordinate;
  readonly bearing: number;
  /** Sun-shadow instant of this moment, rounded to the minute. */
  readonly sunInstantMs: number;
  readonly overlay: VideoOverlay;
  readonly durationMs: number;
}

export interface TrackVideoPlan {
  readonly zoom: number;
  readonly pitch: number;
  readonly frames: readonly TrackVideoFrame[];
}

/**
 * MapLibre event data of a track video's own camera jumps: `movestart` handlers tell
 * them from the user moving the map, which stops the recording.
 */
export const trackVideoCameraJump = { trackVideoCameraJump: true } as const;

export function isTrackVideoCameraJump(event: object): boolean {
  return 'trackVideoCameraJump' in event;
}

/** The walking plays in this time; the start and finish are each held for a second. */
const trackVideoTravelSeconds = 20;
const trackVideoHoldMs = 1_000;
/** Share of the travel time spent speeding up at the start and slowing at the finish. */
const easeShare = 0.12;
/**
 * The user's zoom and pitch are kept within these bounds: closer or farther than this
 * the hiker's surroundings stop reading, and above this pitch the horizon fills the
 * frame and nearby ridges hide the hiker.
 */
const minimumZoom = 12;
const maximumZoom = 16;
const maximumPitchDegrees = 60;
/** Staying within this radius for at least this long is a stop the video skips. */
const stopRadiusMeters = 25;
const stopMinimumSeconds = 3 * 60;
/**
 * A recording gap at least `gapMinimumSeconds` long, covered slower than this speed, is
 * a paused recorder: the hiker covers its distance at `gapWalkingMetersPerSecond`.
 */
const gapMinimumSeconds = 60;
const gapMaximumMetersPerSecond = 0.2;
const gapWalkingMetersPerSecond = 1;
/** Mini-profile resolution: elevation samples across the whole route. */
const profileSamples = 120;
const minuteMs = 60_000;

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

/**
 * Seconds of walking up to each point. Time spent within `stopRadiusMeters` of one
 * place for at least `stopMinimumSeconds` (a break, GPS jitter included) and waits
 * between recorded segments add none, and a paused recorder's gap only the time to
 * walk its distance, so the video skips them.
 */
function walkingSeconds(
  points: readonly TrackTimingPoint[],
  elapsed: readonly number[],
): number[] {
  const walking = points.map(() => 0);
  let index = 0;
  while (index < points.length - 1) {
    const anchor = points[index];
    if (anchor === undefined) break;
    let end = index;
    while (
      end + 1 < points.length &&
      points[end + 1]?.sourceSegmentIndex === anchor.sourceSegmentIndex &&
      geodesicDistanceMeters(
        anchor.coordinate,
        points[end + 1]?.coordinate ?? anchor.coordinate,
      ) <= stopRadiusMeters
    ) {
      end += 1;
    }
    const base = walking[index] ?? 0;
    if (
      end > index &&
      (elapsed[end] ?? 0) - (elapsed[index] ?? 0) >= stopMinimumSeconds
    ) {
      for (let stopped = index + 1; stopped <= end; stopped += 1)
        walking[stopped] = base;
      index = end;
      continue;
    }
    const next = points[index + 1];
    const seconds = Math.max(0, (elapsed[index + 1] ?? 0) - (elapsed[index] ?? 0));
    const meters = (next?.distanceMeters ?? 0) - anchor.distanceMeters;
    const step =
      next?.sourceSegmentIndex !== anchor.sourceSegmentIndex
        ? 0
        : seconds >= gapMinimumSeconds && meters < seconds * gapMaximumMetersPerSecond
          ? Math.min(seconds, meters / gapWalkingMetersPerSecond)
          : seconds;
    walking[index + 1] = base + step;
    index += 1;
  }
  return walking;
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

/** Screen bearing on a north-up Web Mercator map, or null for no movement. */
function screenBearing(from: TrackCoordinate, to: TrackCoordinate): number | null {
  const east = (to[0] - from[0]) * Math.cos((((from[1] + to[1]) / 2) * Math.PI) / 180);
  const north = to[1] - from[1];
  if (east === 0 && north === 0) return null;
  return (Math.atan2(east, north) * 180) / Math.PI;
}

/**
 * Walked share of the route at travel-time share `time`: the speed rises along a half
 * cosine over the first `easeShare` of the time, stays even, and falls the same way
 * before the finish, so the hiker starts and stops smoothly (ease in-out).
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
 * Frames of a time-lapse of the hike. The video's travel runs evenly through walking
 * time, eased at both ends; stops are skipped, while the clock and the sun show the
 * real time of each moment. The camera keeps the user's zoom and pitch within bounds,
 * stays centered on the hiker, and turns to the travel direction across about two
 * percent of the route ahead and behind, averaged over a second of video.
 */
export function planTrackVideo(
  route: TrackVideoRoute,
  camera: { readonly zoom: number; readonly pitch: number },
): TrackVideoPlan {
  const { points, elapsedSeconds, startMs, labels } = route;
  if (points.length === 0) throw new RangeError('The route has no points.');
  const walking = walkingSeconds(points, elapsedSeconds);
  const totalWalking = walking.at(-1) ?? 0;
  const ascent = cumulativeAscent(points, route.ascentMeters);
  const profile = elevationProfile(points);
  const totalMeters = points.at(-1)?.distanceMeters ?? 0;
  const travelFrames = trackVideoTravelSeconds * videoFrameRate;
  const lookMeters = clamp(totalMeters * 0.02, 100, 1_000);
  const distances = points.map((point) => point.distanceMeters);

  const moments = Array.from({ length: travelFrames + 1 }, (_, frame) => {
    const target = easedTravel(frame / travelFrames) * totalWalking;
    // Between the points whose walking time brackets the target; a stop's points all
    // share one walking time, so the target never lands inside a stop.
    const after = target <= 0 ? 0 : firstAtLeast(walking, target);
    const before = Math.max(0, after - 1);
    const span = (walking[after] ?? 0) - (walking[before] ?? 0);
    const fraction =
      after === 0 || span <= 0 ? 1 : (target - (walking[before] ?? 0)) / span;
    const position = before + (after - before) * fraction;
    const from = points[before];
    const to = points[after];
    if (from === undefined || to === undefined) throw new RangeError('Empty route.');
    const distanceMeters = valueAt(distances, position);
    return {
      position: [
        from.coordinate[0] + (to.coordinate[0] - from.coordinate[0]) * fraction,
        from.coordinate[1] + (to.coordinate[1] - from.coordinate[1]) * fraction,
      ] as TrackCoordinate,
      instantMs: startMs + valueAt(elapsedSeconds, position) * 1_000,
      distanceMeters,
      ascentMeters: ascent === null ? null : valueAt(ascent, position),
      heading: screenBearing(
        coordinateAtDistance(points, distances, distanceMeters - lookMeters),
        coordinateAtDistance(points, distances, distanceMeters + lookMeters),
      ),
    };
  });

  // Averaging unit vectors keeps the mean correct across north (359° and 1° give 0°).
  let previousBearing = 0;
  const frames = moments.map((moment, index): TrackVideoFrame => {
    let east = 0;
    let north = 0;
    for (
      let other = Math.max(0, index - videoFrameRate);
      other <= Math.min(moments.length - 1, index + videoFrameRate);
      other += 1
    ) {
      const heading = moments[other]?.heading ?? null;
      if (heading === null) continue;
      east += Math.sin((heading * Math.PI) / 180);
      north += Math.cos((heading * Math.PI) / 180);
    }
    if (east !== 0 || north !== 0) {
      previousBearing = (Math.atan2(east, north) * 180) / Math.PI;
    }
    return {
      position: moment.position,
      bearing: previousBearing,
      sunInstantMs: Math.round(moment.instantMs / minuteMs) * minuteMs,
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
      // Each frame lasts until the next; the start adds the hold before travel begins.
      durationMs:
        index === travelFrames
          ? trackVideoHoldMs
          : (index === 0 ? trackVideoHoldMs : 0) + 1_000 / videoFrameRate,
    };
  });

  return {
    zoom: clamp(camera.zoom, minimumZoom, maximumZoom),
    pitch: clamp(camera.pitch, 0, maximumPitchDegrees),
    frames,
  };
}
