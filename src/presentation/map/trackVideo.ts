import type { TrackTimingPoint } from '@/application/weather/TrackWeatherForecast';
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
  /** Video seconds of travel up to each point. */
  readonly seconds: readonly number[];
  /** Where the hiker is drawn at each point: through a stop, where it began. */
  readonly display: readonly TrackCoordinate[];
  /** Route distance shown at each point; a stop holds it as well. */
  readonly distances: readonly number[];
}

/**
 * Lays the route out in video time. Walking gets a length-based total, spread along the
 * drawn path by distance and nudged by the local pace (see `paceInfluence`). On
 * recorded time, a stop (a stay within `stopRadiusMeters` for `stopMinimumSeconds`,
 * GPS jitter included, or a paused recorder's gap) plays briefly with the hiker held at
 * its first point. Waits between recorded segments take no time.
 */
function videoTimeline(
  points: readonly TrackTimingPoint[],
  elapsed: readonly number[],
  recordedTime: boolean,
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
    // A stop that starts where the previous one ended continues it: a long break with
    // GPS jitter beyond `stopRadiusMeters` stays one short pause, held in one place.
    let previousStopEnd = -1;
    let index = 0;
    while (index < points.length - 1) {
      const anchor = points[index];
      if (anchor === undefined) break;
      const startSeconds = elapsed[index] ?? 0;
      if (index > noStopThrough) {
        // The scan ends at the first point out of reach or once the stay is long
        // enough to be a stop, so a point is revisited only within three minutes.
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
          const continued = index === previousStopEnd ? (stopOfStep[index] ?? -1) : -1;
          const stop = continued === -1 ? stops.push(duration) - 1 : continued;
          if (continued !== -1) stops[stop] = (stops[stop] ?? 0) + duration;
          // `display[index]` is the anchor, or the place a continued stop is held at.
          const heldAt = display[index] ?? anchor.coordinate;
          const heldDistance = distances[index] ?? anchor.distanceMeters;
          for (let held = index + 1; held <= end; held += 1) {
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
      const next = points[index + 1];
      const seconds = (elapsed[index + 1] ?? 0) - startSeconds;
      if (
        next?.sourceSegmentIndex === anchor.sourceSegmentIndex &&
        seconds >= gapMinimumSeconds &&
        next.distanceMeters - anchor.distanceMeters <
          seconds * gapMaximumMetersPerSecond
      ) {
        stopOfStep[index + 1] = stops.push(seconds) - 1;
      }
      index += 1;
    }
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

  // Video time per step: distance over the pace factor of the stretch around it.
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
  let videoSeconds = 0;
  const seconds = points.map((_, step) => {
    if (totalWeight > 0) {
      videoSeconds += (walkingVideoSeconds * (weights[step] ?? 0)) / totalWeight;
    }
    const stop = stopOfStep[step] ?? -1;
    const stopSeconds = stops[stop] ?? 0;
    if (stop !== -1 && stopSeconds > 0) {
      // Spread over the stop's points by their real time, so the clock runs evenly.
      const stepSeconds = Math.max(0, (elapsed[step] ?? 0) - (elapsed[step - 1] ?? 0));
      videoSeconds +=
        ((stopVideoSeconds[stop] ?? 0) * stopScale * stepSeconds) / stopSeconds;
    }
    return videoSeconds;
  });
  return { seconds, display, distances };
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
 * follows the hiker's averaged path, and turns to the travel direction across about two
 * percent of the route ahead and behind, averaged over a second of video.
 */
export function planTrackVideo(
  route: TrackVideoRoute,
  camera: { readonly zoom: number; readonly pitch: number },
): TrackVideoPlan {
  const { points, elapsedSeconds, startMs, labels } = route;
  if (points.length === 0) throw new RangeError('The route has no points.');
  const timeline = videoTimeline(points, elapsedSeconds, route.recordedTime);
  // `travelVideoSeconds`, or less only for a route that never moves.
  const travelSeconds = timeline.seconds.at(-1) ?? 0;
  const ascent = cumulativeAscent(points, route.ascentMeters);
  const profile = elevationProfile(points);
  const totalMeters = points.at(-1)?.distanceMeters ?? 0;
  const travelFrames = travelVideoSeconds * videoFrameRate;
  const lookMeters = clamp(totalMeters * 0.02, 100, 1_000);
  const routeDistances = points.map((point) => point.distanceMeters);
  const zoom = clamp(camera.zoom, minimumZoom, maximumZoom);

  const moments = Array.from({ length: travelFrames + 1 }, (_, frame) => {
    const target = easedTravel(frame / travelFrames) * travelSeconds;
    // Between the points whose video time brackets the target. The last frame is the
    // real finish, even after a final stop.
    const after =
      frame === travelFrames
        ? points.length - 1
        : target <= 0
          ? 0
          : firstAtLeast(timeline.seconds, target);
    const before = Math.max(0, after - 1);
    const span = (timeline.seconds[after] ?? 0) - (timeline.seconds[before] ?? 0);
    const fraction =
      after === 0 || span <= 0 ? 1 : (target - (timeline.seconds[before] ?? 0)) / span;
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
      heading: screenBearing(
        coordinateAtDistance(points, routeDistances, distanceMeters - lookMeters),
        coordinateAtDistance(points, routeDistances, distanceMeters + lookMeters),
      ),
    };
  });

  // Averaging unit vectors keeps the mean correct across north (359° and 1° give 0°).
  let previousBearing = 0;
  const pitch = clamp(camera.pitch, 0, maximumPitchDegrees);
  const frames = moments.map((moment, index): TrackVideoFrame => {
    let east = 0;
    let north = 0;
    let weight = 0;
    let longitude = 0;
    let latitude = 0;
    for (
      let other = Math.max(0, index - videoFrameRate);
      other <= Math.min(moments.length - 1, index + videoFrameRate);
      other += 1
    ) {
      const nearby = moments[other];
      if (nearby === undefined) continue;
      const offset = Math.abs(other - index);
      if (offset <= centerSmoothingFrames) {
        const share = centerSmoothingFrames + 1 - offset;
        longitude += nearby.position[0] * share;
        latitude += nearby.position[1] * share;
        weight += share;
      }
      if (nearby.heading === null) continue;
      east += Math.sin((nearby.heading * Math.PI) / 180);
      north += Math.cos((nearby.heading * Math.PI) / 180);
    }
    if (east !== 0 || north !== 0) {
      previousBearing = (Math.atan2(east, north) * 180) / Math.PI;
    }
    const averaged: TrackCoordinate = [longitude / weight, latitude / weight];
    const offsetMeters = geodesicDistanceMeters(moment.position, averaged);
    const allowedMeters =
      maximumCenterOffsetPixels * metersPerPixel(moment.position[1], zoom);
    const keep = offsetMeters <= allowedMeters ? 1 : allowedMeters / offsetMeters;
    return {
      position: moment.position,
      center: [
        moment.position[0] + (averaged[0] - moment.position[0]) * keep,
        moment.position[1] + (averaged[1] - moment.position[1]) * keep,
      ],
      bearing: previousBearing,
      pitch,
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
      // Each frame lasts until the next; the last one holds the finish.
      durationMs: index === travelFrames ? finishHoldMs : 1_000 / videoFrameRate,
    };
  });

  return { zoom, frames };
}

/** Canvas and terrain of the map, for sight lines from its camera. */
export interface TrackVideoView {
  /** Canvas height in CSS pixels. */
  readonly heightPixels: number;
  readonly fieldOfViewDegrees: number;
  readonly terrainExaggeration: number;
}

/**
 * Ways to look at the hiker when relief hides them, in order of preference: from the
 * side (descents, where the hiker drops behind a slope's brow, read well side on), from
 * ahead, and finally from higher up.
 */
const occlusionAngles = [
  { bearingOffset: 90, topDownPitch: false },
  { bearingOffset: -90, topDownPitch: false },
  { bearingOffset: 180, topDownPitch: false },
  { bearingOffset: 0, topDownPitch: true },
] as const;
/** Pitch of the last resort angle: steep enough to look over most ridges. */
const topDownPitchDegrees = 20;
/** Every this many frames gets sight lines; frames between share their verdict. */
const occlusionStride = 6;
/** Samples along each sight line, denser near the hiker where slopes hide them. */
const sightLineSamples = 24;
const sightLineNearestMeters = 15;
/** Relief must rise this far above a sight line to hide the hiker's dot. */
const sightLineClearanceMeters = 3;
/**
 * The camera turns up to this long before relief hides the hiker and back up to this
 * long after, where its new angle sees the hiker; two smoothing passes spread each
 * turn over most of it.
 */
const occlusionLeadFrames = 45;
const occlusionSmoothingFrames = 20;

/** One sight line from the hiker to the camera, as MapLibre places the camera. */
export interface TrackVideoSightLine {
  readonly frameIndex: number;
  /** -1 for the planned view, otherwise an index into `occlusionAngles`. */
  readonly angle: number;
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
 * Sight lines from the hiker to the camera for every `occlusionStride`-th frame and the
 * last, for the planned view and each fallback angle. MapLibre places the camera
 * `height / 2 / tan(fov / 2)` pixels from the center (see `directedCameraFit`), behind
 * it by sin(pitch) of that and above the center's rendered terrain by cos(pitch).
 */
export function trackVideoSightLines(
  plan: TrackVideoPlan,
  view: TrackVideoView,
): TrackVideoSightLine[] {
  const cameraPixels =
    view.heightPixels / 2 / Math.tan((view.fieldOfViewDegrees * Math.PI) / 360);
  const lines: TrackVideoSightLine[] = [];
  for (const [frameIndex, frame] of plan.frames.entries()) {
    if (frameIndex % occlusionStride !== 0 && frameIndex !== plan.frames.length - 1) {
      continue;
    }
    const cameraMeters = cameraPixels * metersPerPixel(frame.center[1], plan.zoom);
    const views = [{ bearingOffset: 0, topDownPitch: false }, ...occlusionAngles];
    for (const [index, { bearingOffset, topDownPitch }] of views.entries()) {
      const pitchDegrees = topDownPitch
        ? Math.min(frame.pitch, topDownPitchDegrees)
        : frame.pitch;
      const pitch = (pitchDegrees * Math.PI) / 180;
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
        angle: index - 1,
        coordinates,
        shares,
        cameraHeightMeters: cameraMeters * Math.cos(pitch),
      });
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
 * Turns the camera where relief would hide the hiker. A hidden stretch runs from a
 * hidden frame to the last one before the planned view has been clear for two lead
 * times. The most preferred fallback that sees the hiker through the whole stretch
 * takes it; failing that, the one that sees the hiker longest from its first hidden
 * frame takes those frames, ties going to the more preferred, and the next pick
 * continues where it fails, so a stretch may change angle part way. A fallback also
 * takes up to `occlusionLeadFrames` before and after where it still sees the hiker,
 * and the turns are eased over about two seconds. Frames no view sees keep the planned
 * one. `elevations[i]` are the bare-earth heights at `lines[i].coordinates`, null where
 * unknown.
 */
export function avoidTerrainOcclusion(
  plan: TrackVideoPlan,
  lines: readonly TrackVideoSightLine[],
  elevations: readonly (readonly (number | null)[])[],
  view: Pick<TrackVideoView, 'terrainExaggeration'>,
): TrackVideoPlan {
  const frameCount = plan.frames.length;
  // Visible verdicts per view (-1 the planned one), spread to the frames between.
  const visible = new Map<number, boolean[]>();
  for (const [index, line] of lines.entries()) {
    const verdicts =
      visible.get(line.angle) ?? Array.from({ length: frameCount }, () => true);
    visible.set(line.angle, verdicts);
    const sees = !hidesHiker(line, elevations[index] ?? [], view.terrainExaggeration);
    const end = Math.min(frameCount, line.frameIndex + occlusionStride);
    for (let frame = line.frameIndex; frame < end; frame += 1) verdicts[frame] = sees;
  }
  const planned = visible.get(-1);
  if (planned === undefined || planned.every(Boolean)) return plan;

  // The view of each frame: -1 planned, otherwise an index into `occlusionAngles`.
  const chosen = plan.frames.map(() => -1);
  const runLength = (angle: number, start: number) => {
    const verdicts = visible.get(angle);
    let end = start;
    while (end < frameCount && verdicts?.[end] !== false) end += 1;
    return end - start;
  };
  let frame = 0;
  while (frame < frameCount) {
    if (planned[frame] !== false) {
      frame += 1;
      continue;
    }
    let lastHidden = frame;
    for (
      let ahead = frame + 1;
      ahead < frameCount && ahead - lastHidden <= 2 * occlusionLeadFrames;
      ahead += 1
    ) {
      if (planned[ahead] === false) lastHidden = ahead;
    }
    let best = -1;
    let bestLength = 0;
    for (let angle = 0; angle < occlusionAngles.length; angle += 1) {
      const length = runLength(angle, frame);
      if (frame + length > lastHidden) {
        best = angle;
        bestLength = length;
        break;
      }
      if (length > bestLength) {
        best = angle;
        bestLength = length;
      }
    }
    if (best === -1) {
      frame += 1;
      continue;
    }
    const end = Math.min(frame + bestLength, lastHidden + 1 + occlusionLeadFrames);
    const fallback = visible.get(best);
    let start = frame;
    while (
      start > 0 &&
      frame - start < occlusionLeadFrames &&
      chosen[start - 1] === -1 &&
      fallback?.[start - 1] !== false
    ) {
      start -= 1;
    }
    for (let assigned = start; assigned < end; assigned += 1) chosen[assigned] = best;
    frame = end;
  }

  const angleAt = (index: number) => {
    const angle = chosen[index] ?? -1;
    return angle === -1 ? null : occlusionAngles[angle];
  };
  const bearingOffsets = plan.frames.map(
    (_, index) => angleAt(index)?.bearingOffset ?? 0,
  );
  const pitches = plan.frames.map((planned, index) =>
    angleAt(index)?.topDownPitch === true
      ? Math.min(planned.pitch, topDownPitchDegrees)
      : planned.pitch,
  );
  const easedOffsets = smoothed(
    smoothed(bearingOffsets, occlusionSmoothingFrames),
    occlusionSmoothingFrames,
  );
  const easedPitches = smoothed(
    smoothed(pitches, occlusionSmoothingFrames),
    occlusionSmoothingFrames,
  );
  return {
    ...plan,
    frames: plan.frames.map((planned, index) => ({
      ...planned,
      bearing: planned.bearing + (easedOffsets[index] ?? 0),
      pitch: easedPitches[index] ?? planned.pitch,
    })),
  };
}
