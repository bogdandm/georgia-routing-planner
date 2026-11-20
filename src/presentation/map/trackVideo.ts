import {
  locationAtElapsed,
  type TrackTimingPoint,
} from '@/application/weather/TrackWeatherForecast';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { videoFrameRate } from '@/presentation/map/mapCapture';

/** A timed route: `elapsedSeconds[i]` is when the hiker reaches `points[i]`. */
export interface TrackVideoRoute {
  readonly points: readonly TrackTimingPoint[];
  readonly elapsedSeconds: readonly number[];
  /** When the hike starts; the finish is `startMs` plus the last elapsed second. */
  readonly startMs: number;
  /** Clock text drawn on each frame, in the route's time zone. */
  readonly formatTime: (instantMs: number) => string;
}

export interface TrackVideoFrame {
  /** The hiker at this moment: the marker and the camera center. */
  readonly position: TrackCoordinate;
  readonly bearing: number;
  /** Sun-shadow minute of this moment, rounded to `trackVideoSunStepMs`. */
  readonly sunInstantMs: number;
  readonly caption: string;
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

/** The whole hike plays in this time; the start and finish are each held for a second. */
const trackVideoTravelSeconds = 20;
const trackVideoHoldMs = 1_000;
/**
 * Shadows barely move in five minutes, and every distinct minute costs a fresh render of
 * each visible shadow tile, so the sun advances in these steps.
 */
export const trackVideoSunStepMs = 5 * 60_000;
/** Ground width across the canvas: about a quarter of the route, within these bounds. */
const minimumSpanMeters = 1_200;
const maximumSpanMeters = 6_000;
const earthCircumferenceMeters = 40_075_016.686;
const mapTileSizePixels = 512;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Route position `distanceMeters` along it, clamped to its ends. */
function coordinateAtDistance(
  points: readonly TrackTimingPoint[],
  distanceMeters: number,
): TrackCoordinate {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((points[middle]?.distanceMeters ?? Infinity) < distanceMeters) low = middle + 1;
    else high = middle;
  }
  const after = points[low];
  const before = points[Math.max(0, low - 1)];
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
 * Frames of a time-lapse of the hike: the video's time runs linearly through the hike's
 * time, so the hiker slows on climbs and waits through recorded pauses while the sun
 * keeps moving. The camera stays centered on the hiker, turned to the travel direction
 * across about two percent of the route ahead and behind, averaged over a second of
 * video so turns are smooth. `widthPixels` is the canvas width in CSS pixels.
 */
export function planTrackVideo(
  route: TrackVideoRoute,
  view: { readonly widthPixels: number; readonly pitch: number },
): TrackVideoPlan {
  const { points, elapsedSeconds, startMs } = route;
  const first = points[0];
  if (first === undefined) throw new RangeError('The route has no points.');
  const totalSeconds = elapsedSeconds.at(-1) ?? 0;
  const totalMeters = points.at(-1)?.distanceMeters ?? 0;
  const travelFrames = trackVideoTravelSeconds * videoFrameRate;
  const lookMeters = clamp(totalMeters * 0.02, 100, 1_000);

  const moments = Array.from({ length: travelFrames + 1 }, (_, index) => {
    const seconds = (totalSeconds * index) / travelFrames;
    const location = locationAtElapsed(points, elapsedSeconds, seconds);
    return {
      seconds,
      position: location.coordinate,
      heading: screenBearing(
        coordinateAtDistance(points, location.distanceMeters - lookMeters),
        coordinateAtDistance(points, location.distanceMeters + lookMeters),
      ),
    };
  });

  // Averaging unit vectors keeps the mean correct across north (359° and 1° give 0°).
  const window = videoFrameRate;
  let previousBearing = 0;
  const frames = moments.map(({ seconds, position }, index): TrackVideoFrame => {
    let east = 0;
    let north = 0;
    for (
      let other = Math.max(0, index - window);
      other <= Math.min(moments.length - 1, index + window);
      other += 1
    ) {
      const heading = moments[other]?.heading ?? null;
      if (heading === null) continue;
      east += Math.sin((heading * Math.PI) / 180);
      north += Math.cos((heading * Math.PI) / 180);
    }
    if (east !== 0 || north !== 0)
      previousBearing = (Math.atan2(east, north) * 180) / Math.PI;
    const instantMs = startMs + seconds * 1_000;
    return {
      position,
      bearing: previousBearing,
      sunInstantMs: Math.round(instantMs / trackVideoSunStepMs) * trackVideoSunStepMs,
      caption: route.formatTime(instantMs),
      // Each frame lasts until the next; the start adds the hold before travel begins.
      durationMs:
        index === travelFrames
          ? trackVideoHoldMs
          : (index === 0 ? trackVideoHoldMs : 0) + 1_000 / videoFrameRate,
    };
  });

  const middle = points[Math.floor(points.length / 2)] ?? first;
  const spanMeters = clamp(totalMeters / 4, minimumSpanMeters, maximumSpanMeters);
  const metersAcrossAtZoomZero =
    (earthCircumferenceMeters *
      Math.cos((middle.coordinate[1] * Math.PI) / 180) *
      view.widthPixels) /
    mapTileSizePixels;
  return {
    zoom: clamp(Math.log2(metersAcrossAtZoomZero / spanMeters), 10, 16),
    pitch: view.pitch,
    frames,
  };
}
