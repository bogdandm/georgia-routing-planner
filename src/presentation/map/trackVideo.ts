import type { TrackTimingPoint } from '@/application/weather/TrackWeatherForecast';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import { videoFrameRate, type VideoOverlay } from '@/presentation/map/mapCapture';

/** A timed route: `elapsedSeconds[i]` is when the hiker reaches `points[i]`. */
export interface TrackVideoRoute {
  readonly points: readonly TrackTimingPoint[];
  readonly elapsedSeconds: readonly number[];
  /**
   * Whether `elapsedSeconds` are recorded timestamps, whose breaks the video skips; an
   * estimate has none, and its slow steep stretches are walking.
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
   * of following every kink of the track, while the hiker stays near the middle.
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
/** Camera-center smoothing: a triangular average over this many frames each side. */
const centerSmoothingFrames = 15;
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

/**
 * Seconds of walking up to each point. Waits between recorded segments add none. On
 * recorded time, so do stays within `stopRadiusMeters` of one place for at least
 * `stopMinimumSeconds` (a break, GPS jitter included), and a paused recorder's gap adds
 * only the time to walk its distance, so the video skips them.
 */
function walkingSeconds(
  points: readonly TrackTimingPoint[],
  elapsed: readonly number[],
  recordedTime: boolean,
): number[] {
  const walking = points.map(() => 0);
  const within = (anchor: TrackTimingPoint, other: TrackTimingPoint | undefined) =>
    other?.sourceSegmentIndex === anchor.sourceSegmentIndex &&
    geodesicDistanceMeters(anchor.coordinate, other.coordinate) <= stopRadiusMeters;
  let index = 0;
  // A scan that reaches its segment's end too soon proves no later point of the segment
  // starts a stop either, since each has less time left; their scans are skipped.
  let noStopThrough = -1;
  while (index < points.length - 1) {
    const anchor = points[index];
    if (anchor === undefined) break;
    const base = walking[index] ?? 0;
    if (recordedTime && index > noStopThrough) {
      // The scan ends at the first point out of reach or once the stay is long enough
      // to be a stop, so a point is revisited only within three minutes of it.
      const startSeconds = elapsed[index] ?? 0;
      let end = index;
      while (
        (elapsed[end] ?? 0) - startSeconds < stopMinimumSeconds &&
        within(anchor, points[end + 1])
      ) {
        end += 1;
      }
      if ((elapsed[end] ?? 0) - startSeconds >= stopMinimumSeconds) {
        while (within(anchor, points[end + 1])) end += 1;
        for (let stopped = index + 1; stopped <= end; stopped += 1) {
          walking[stopped] = base;
        }
        index = end;
        continue;
      }
      if (points[end + 1]?.sourceSegmentIndex !== anchor.sourceSegmentIndex) {
        noStopThrough = end;
      }
    }
    const next = points[index + 1];
    const seconds = Math.max(0, (elapsed[index + 1] ?? 0) - (elapsed[index] ?? 0));
    const meters = (next?.distanceMeters ?? 0) - anchor.distanceMeters;
    const step =
      next?.sourceSegmentIndex !== anchor.sourceSegmentIndex
        ? 0
        : recordedTime &&
            seconds >= gapMinimumSeconds &&
            meters < seconds * gapMaximumMetersPerSecond
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
  const walking = walkingSeconds(points, elapsedSeconds, route.recordedTime);
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
    // share one walking time, so the target never lands inside a stop. The last frame
    // is the real finish, even after a final stop.
    const after =
      frame === travelFrames
        ? points.length - 1
        : target <= 0
          ? 0
          : firstAtLeast(walking, target);
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
    return {
      position: moment.position,
      center: [longitude / weight, latitude / weight],
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
      // Each frame lasts until the next; the start adds the hold before travel begins.
      durationMs:
        index === travelFrames
          ? trackVideoHoldMs
          : (index === 0 ? trackVideoHoldMs : 0) + 1_000 / videoFrameRate,
    };
  });

  return { zoom: clamp(camera.zoom, minimumZoom, maximumZoom), frames };
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
 * The camera turns this long before relief hides the hiker and turns back this long
 * after; two smoothing passes spread each turn over most of it.
 */
const occlusionLeadFrames = 45;
const occlusionSmoothingFrames = 20;

/** One sight line: ground points from the hiker toward the camera. */
export interface TrackVideoSightLine {
  readonly frameIndex: number;
  /** -1 for the planned view, otherwise an index into `occlusionAngles`. */
  readonly angle: number;
  /** The hiker first, then the ground under the line, nearest first. */
  readonly coordinates: readonly TrackCoordinate[];
  /** Rendered height of the line above the hiker at each ground point, in meters. */
  readonly rises: readonly number[];
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
 * Sight lines from the camera to the hiker for every `occlusionStride`-th frame and the
 * last, for the planned view and each fallback angle. The camera sits
 * `height / 2 / tan(fov / 2)` pixels from the center as MapLibre renders it (see
 * `directedCameraFit`), so the line climbs that distance times cos(pitch) over
 * sin(pitch) of it horizontally, in exaggerated meters.
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
    const metersPerPixel =
      (earthCircumferenceMeters * Math.cos((frame.position[1] * Math.PI) / 180)) /
      (mapTileSizePixels * 2 ** plan.zoom);
    const views = [
      { bearingOffset: 0, topDownPitch: false },
      ...occlusionAngles,
    ].entries();
    for (const [index, { bearingOffset, topDownPitch }] of views) {
      const pitch =
        ((topDownPitch ? Math.min(frame.pitch, topDownPitchDegrees) : frame.pitch) *
          Math.PI) /
        180;
      const cameraMeters = cameraPixels * metersPerPixel;
      const reach = cameraMeters * Math.sin(pitch);
      const height = cameraMeters * Math.cos(pitch);
      const coordinates: TrackCoordinate[] = [frame.position];
      const rises: number[] = [];
      for (let sample = 1; sample <= sightLineSamples; sample += 1) {
        const share = (sample / sightLineSamples) ** 2;
        const meters = Math.max(sightLineNearestMeters, share * reach);
        coordinates.push(
          offsetCoordinate(frame.position, frame.bearing + bearingOffset + 180, meters),
        );
        rises.push(reach <= 0 ? height : (meters / reach) * height);
      }
      lines.push({ frameIndex, angle: index - 1, coordinates, rises });
    }
  }
  return lines;
}

/** Whether relief, at `elevations` (meters, the hiker first), rises over the line. */
function hidesHiker(
  line: TrackVideoSightLine,
  elevations: readonly (number | null)[],
  exaggeration: number,
): boolean {
  const hiker = elevations[0];
  if (hiker === null || hiker === undefined) return false;
  return line.rises.some((rise, index) => {
    const ground = elevations[index + 1];
    return (
      ground !== null &&
      ground !== undefined &&
      (ground - hiker) * exaggeration > rise + sightLineClearanceMeters
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
 * Turns the camera where relief would hide the hiker. Each stretch of hidden frames,
 * widened by `occlusionLeadFrames`, takes the first fallback angle that sees the hiker
 * on most of it; the turn and any pitch change are eased in and out over about two
 * seconds. Stretches no angle helps keep the planned view. `elevations[i]` are the
 * bare-earth heights at `lines[i].coordinates`, null where unknown.
 */
export function avoidTerrainOcclusion(
  plan: TrackVideoPlan,
  lines: readonly TrackVideoSightLine[],
  elevations: readonly (readonly (number | null)[])[],
  view: Pick<TrackVideoView, 'terrainExaggeration'>,
): TrackVideoPlan {
  const frameCount = plan.frames.length;
  // Hidden verdicts per angle (-1 the planned view), spread to the frames between.
  const hidden = new Map<number, boolean[]>();
  for (const [index, line] of lines.entries()) {
    const verdicts =
      hidden.get(line.angle) ?? Array.from({ length: frameCount }, () => false);
    hidden.set(line.angle, verdicts);
    const isHidden = hidesHiker(
      line,
      elevations[index] ?? [],
      view.terrainExaggeration,
    );
    const end = Math.min(frameCount, line.frameIndex + occlusionStride);
    for (let frame = line.frameIndex; frame < end; frame += 1)
      verdicts[frame] = isHidden;
  }
  const plannedHidden = hidden.get(-1);
  if (!plannedHidden?.includes(true)) return plan;

  const bearingOffsets = plan.frames.map(() => 0);
  const pitches = plan.frames.map((frame) => frame.pitch);
  let frame = 0;
  while (frame < frameCount) {
    if (plannedHidden[frame] !== true) {
      frame += 1;
      continue;
    }
    let end = frame;
    // Stretches closer than a turn there and back merge into one.
    while (
      end + 1 < frameCount &&
      plannedHidden.slice(end + 1, end + 1 + 2 * occlusionLeadFrames).includes(true)
    ) {
      end += 1;
    }
    let best: (typeof occlusionAngles)[number] | null = null;
    let bestVisible = 0;
    for (const [index, angle] of occlusionAngles.entries()) {
      const verdicts = hidden.get(index);
      let visible = 0;
      for (let inside = frame; inside <= end; inside += 1) {
        if (verdicts?.[inside] === false) visible += 1;
      }
      if (visible > bestVisible) {
        best = angle;
        bestVisible = visible;
      }
    }
    if (best !== null && bestVisible * 2 > end - frame + 1) {
      for (
        let turned = Math.max(0, frame - occlusionLeadFrames);
        turned <= Math.min(frameCount - 1, end + occlusionLeadFrames);
        turned += 1
      ) {
        bearingOffsets[turned] = best.bearingOffset;
        if (best.topDownPitch) {
          pitches[turned] = Math.min(
            plan.frames[turned]?.pitch ?? 0,
            topDownPitchDegrees,
          );
        }
      }
    }
    frame = end + 1;
  }

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
