import { describe, expect, it } from 'vitest';

import {
  createTrackTimingRoute,
  type TrackTimingPoint,
} from '@/application/weather/TrackWeatherForecast';
import { storedTrackElevationProfile } from '@/domain/tracks/elevationProfile';
import type { TrackPoint } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import {
  planTrackVideo,
  trackVideoFilename,
  trackVideoSegments,
  type TrackVideoFrame,
  type TrackVideoPlan,
  type TrackVideoRoute,
  type TrackVideoSegment,
  type TrackVideoTerrain,
} from '@/presentation/map/trackVideo';

const startMs = Date.UTC(2026, 6, 1, 5, 0);
const camera = { zoom: 14, pitch: 45 };
const labels = {
  time: (instantMs: number) => new Date(instantMs).toISOString(),
  distance: (meters: number) => `${String(Math.round(meters))} m`,
  ascent: (meters: number) => `+${String(Math.round(meters))}`,
};

/** Recorded points through `coordinates`, with cumulative distance along them. */
function timedRoute(
  coordinates: readonly (readonly [number, number])[],
  elapsedSeconds: readonly number[],
  options: {
    readonly elevations?: readonly number[];
    readonly segments?: readonly number[];
  } = {},
): TrackVideoRoute {
  const points: TrackTimingPoint[] = [];
  for (const [index, coordinate] of coordinates.entries()) {
    const previous = points.at(-1);
    const elevationMeters = options.elevations?.[index];
    const sourceSegmentIndex = options.segments?.[index] ?? 0;
    points.push({
      coordinate: [coordinate[0], coordinate[1]],
      // Like the app's timing route, no distance is added across segments.
      distanceMeters:
        previous === undefined
          ? 0
          : previous.distanceMeters +
            (previous.sourceSegmentIndex === sourceSegmentIndex
              ? geodesicDistanceMeters(previous.coordinate, [
                  coordinate[0],
                  coordinate[1],
                ])
              : 0),
      ...(elevationMeters === undefined ? {} : { elevationMeters }),
      sourceSegmentIndex,
    });
  }
  return {
    points,
    elapsedSeconds,
    recordedTime: true,
    startMs,
    ascentMeters: undefined,
    segments: [],
    terrain: null,
    fixedSunInstantMs: null,
    labels,
  };
}

/** `count` points from `from` by `step` each, `secondsPerPoint` apart. */
function straightRoute(
  from: readonly [number, number],
  step: readonly [number, number],
  count: number,
  secondsPerPoint: number,
): TrackVideoRoute {
  return timedRoute(
    Array.from({ length: count }, (_, index) => [
      from[0] + step[0] * index,
      from[1] + step[1] * index,
    ]),
    Array.from({ length: count }, (_, index) => index * secondsPerPoint),
  );
}

/** Metres the hiker moves from each frame to the next. */
function frameMoves(plan: TrackVideoPlan): number[] {
  return plan.frames
    .slice(1)
    .map((frame, index) =>
      geodesicDistanceMeters(plan.frames[index]?.position ?? [0, 0], frame.position),
    );
}

/** Signed turn from bearing `from` to bearing `to`, in −180–180°. */
function bearingTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** The camera turns at most this fast: 120° a second. */
const fastestTurnPerFrame = 4 + 1e-9;

/** How far the camera turns from each frame to the next, in degrees. */
function bearingSteps(plan: TrackVideoPlan): number[] {
  return plan.frames
    .slice(1)
    .map((frame, index) =>
      Math.abs(bearingTurn(plan.frames[index]?.bearing ?? 0, frame.bearing)),
    );
}

/** Route meters of a frame, read back from its overlay label. */
function frameMeters(frame: TrackVideoFrame): number {
  return Number.parseFloat(frame.overlay.distance);
}

/** `route` split into profile segments, each ending at a share of the route. */
function withSegments(
  route: TrackVideoRoute,
  ends: readonly (readonly [TrackVideoSegment['type'], number])[],
): TrackVideoRoute {
  const totalMeters = route.points.at(-1)?.distanceMeters ?? 0;
  return {
    ...route,
    segments: ends.map(([type, end], index) => ({
      type,
      startMeters: (ends[index - 1]?.[1] ?? 0) * totalMeters,
      endMeters: end * totalMeters,
    })),
  };
}

/** 4 km east, then back along the same line. */
const outAndBackLeg = Array.from(
  { length: 41 },
  (_, index) => [43.1 + 0.00122 * index, 42.7] as const,
);
const outAndBack = timedRoute(
  [...outAndBackLeg, ...outAndBackLeg.slice(0, -1).reverse()],
  Array.from({ length: 81 }, (_, index) => index * 90),
);

// A close, steep 3D view over a tall canvas, as MapLibre renders it.
const closeCamera = { zoom: 16, pitch: 60 };
const metersPerDegree = 40_075_016.686 / 360;

/** Terrain rising and falling only eastward: `elevation` of meters east of 43.1°. */
function slopeTerrain(elevation: (eastMeters: number) => number): TrackVideoTerrain {
  return {
    sampler: {
      elevationAt: (latitude, longitude) =>
        elevation(
          (longitude - 43.1) * metersPerDegree * Math.cos((latitude * Math.PI) / 180),
        ),
    },
    heightPixels: 900,
    fieldOfViewDegrees: 36.87,
    exaggeration: 1.15,
  };
}

/**
 * The longest run of frames whose hiker relief hides from the camera, by an independent
 * sight line: MapLibre's camera `height / 2 / tan(fov / 2)` pixels from the center,
 * behind it by sin(pitch) and above its rendered terrain by cos(pitch), and the hiker's
 * dot 2 m tall, hidden by ground 3 m over the line, sampled every 10 m.
 */
function hiddenRun(plan: TrackVideoPlan, terrain: TrackVideoTerrain): number {
  const height = (coordinate: readonly [number, number]) =>
    (terrain.sampler.elevationAt(coordinate[1], coordinate[0], 0) ?? 0) *
    terrain.exaggeration;
  let run = 0;
  let longest = 0;
  for (const frame of plan.frames) {
    const cosine = Math.cos((frame.center[1] * Math.PI) / 180);
    const cameraMeters =
      (terrain.heightPixels /
        2 /
        Math.tan((terrain.fieldOfViewDegrees * Math.PI) / 360)) *
      ((metersPerDegree * 360 * cosine) / (512 * 2 ** plan.zoom));
    const pitch = (frame.pitch * Math.PI) / 180;
    const back = ((frame.bearing + 180) * Math.PI) / 180;
    const behind = cameraMeters * Math.sin(pitch);
    const camera = [
      frame.center[0] + (Math.sin(back) * behind) / (metersPerDegree * cosine),
      frame.center[1] + (Math.cos(back) * behind) / metersPerDegree,
    ] as const;
    const cameraHeight = height(frame.center) + cameraMeters * Math.cos(pitch);
    const hikerHeight = height(frame.position) + 2;
    const length = geodesicDistanceMeters(frame.position, [camera[0], camera[1]]);
    let hidden = false;
    for (let meters = 10; meters < length && !hidden; meters += 10) {
      const share = meters / length;
      const ground = height([
        frame.position[0] + (camera[0] - frame.position[0]) * share,
        frame.position[1] + (camera[1] - frame.position[1]) * share,
      ]);
      hidden = ground > hikerHeight + share * (cameraHeight - hikerHeight) + 3;
    }
    run = hidden ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

describe('trackVideoFilename', () => {
  it("names the video by the track, the hike's date, and its local start time", () => {
    // 04:05 UTC is 08:05 in Tbilisi.
    const startMs = Date.parse('2026-07-11T04:05:00Z');

    expect(
      trackVideoFilename('Сахизаре сверху', '2026-07-11', startMs, 'Asia/Tbilisi'),
    ).toBe('Сахизаре сверху-2026-07-11-08-05.mp4');
    expect(
      trackVideoFilename('Kazbegi: Gergeti / Sameba', '2026-07-11', startMs, 'UTC'),
    ).toBe('Kazbegi- Gergeti - Sameba-2026-07-11-04-05.mp4');
    expect(trackVideoFilename('  ', '2026-07-11', startMs, 'UTC')).toBe(
      'track-2026-07-11-04-05.mp4',
    );
  });
});

describe('planTrackVideo', () => {
  // 8.2 km east, 24 s of travel: 720 travel frames and the finish.
  const eastward = straightRoute([43.1, 42.7], [0.01, 0], 11, 1_800);
  const middle = 360;

  it('lasts 25 s: starts moving, eases in and out, and holds only the finish', () => {
    const plan = planTrackVideo(eastward, camera, null);
    const { frames } = plan;

    expect(frames).toHaveLength(721);
    expect(frames[0]?.position).toEqual([43.1, 42.7]);
    expect(frames[0]?.overlay.time).toBe(new Date(startMs).toISOString());
    expect(frames[0]?.durationMs).toBeCloseTo(1_000 / 30);
    expect(frames.at(-1)?.position[0]).toBeCloseTo(43.2);
    expect(frames.at(-1)?.overlay.time).toBe(
      new Date(startMs + 18_000_000).toISOString(),
    );
    expect(frames.at(-1)?.durationMs).toBe(1_000);
    expect(frames.reduce((sum, frame) => sum + frame.durationMs, 0)).toBeCloseTo(
      25_000,
    );
    const moves = frameMoves(plan);
    // Barely moving at either end, at full speed in the middle, moving within a second.
    expect(moves[0]).toBeLessThan((moves[middle] ?? 0) / 50);
    expect(moves.at(-1)).toBeLessThan((moves[middle] ?? 0) / 50);
    expect(moves[30]).toBeGreaterThan((moves[middle] ?? 0) / 3);
    expect(frames[middle]?.position[0]).toBeCloseTo(43.15);
  });

  it('lasts 25 s for a long route too', () => {
    const long = planTrackVideo(
      straightRoute([43.1, 42.7], [0.05, 0], 11, 1_800),
      camera,
      null,
    );

    expect(long.frames).toHaveLength(721);
  });

  it('nudges the map speed by the pace without matching it', () => {
    // Same spacing, but the first half walked four times as fast as the second.
    const coordinates = Array.from(
      { length: 41 },
      (_, index) => [43.1 + 0.0025 * index, 42.7] as const,
    );
    const elapsed = coordinates.map((_, index) =>
      index <= 20 ? index * 30 : 600 + (index - 20) * 120,
    );
    const moves = frameMoves(
      planTrackVideo(timedRoute(coordinates, elapsed), camera, null),
    );
    const quarter = Math.round(moves.length / 4);

    const ratio = (moves[quarter] ?? 0) / (moves[moves.length - quarter] ?? 1);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.9);
  });

  it('shows a stop where GPS jitters in place as a brief rest, the clock running on', () => {
    const walkIn = Array.from(
      { length: 10 },
      (_, index) => [43.1 + 0.002 * index, 42.7] as const,
    );
    const stopCenter = [43.1 + 0.002 * 10, 42.7] as const;
    const stop = Array.from(
      { length: 31 },
      (_, index) =>
        [
          stopCenter[0] + (index % 2) * 0.0001,
          stopCenter[1] + (index % 3) * 0.00005,
        ] as const,
    );
    const walkOut = Array.from(
      { length: 10 },
      (_, index) => [stopCenter[0] + 0.002 * (index + 1), 42.7] as const,
    );
    const stopStartSeconds = 10 * 60;
    const stopSeconds = stop.map((_, index) => stopStartSeconds + index * 120);
    const stopEndSeconds = stopSeconds.at(-1) ?? 0;
    const route = timedRoute(
      [...walkIn, ...stop, ...walkOut],
      [
        ...walkIn.map((_, index) => index * 60),
        ...stopSeconds,
        ...walkOut.map((_, index) => stopEndSeconds + (index + 1) * 60),
      ],
    );

    const { frames } = planTrackVideo(route, camera, null);

    const resting = frames.filter(
      (frame) =>
        frame.sunInstantMs > startMs + (stopStartSeconds + 120) * 1_000 &&
        frame.sunInstantMs < startMs + (stopEndSeconds - 120) * 1_000,
    );
    // The hour plays in about 0.6 s, the hiker held where the stop began.
    expect(resting.length).toBeGreaterThan(10);
    expect(resting.length).toBeLessThanOrEqual(19);
    for (const frame of resting) expect(frame.position).toEqual(stopCenter);
    const clockSteps = frames
      .slice(1)
      .map((frame, index) => frame.sunInstantMs - (frames[index]?.sunInstantMs ?? 0));
    expect(Math.max(...clockSteps)).toBeLessThan(10 * 60_000);
  });

  it('plays a paused recorder as a brief rest, then walks the gap', () => {
    const coordinates = Array.from(
      { length: 21 },
      (_, index) => [43.1 + 0.002 * index, 42.7] as const,
    );
    // Two minutes between points, and an hour between the 10th and the 11th.
    const elapsed = coordinates.map(
      (_, index) => index * 120 + (index > 10 ? 3_600 : 0),
    );
    const plan = planTrackVideo(timedRoute(coordinates, elapsed), camera, null);

    const gapStartMs = startMs + 1_200 * 1_000;
    const restingAt = coordinates[10];
    const crossing = plan.frames.filter(
      (frame) =>
        frame.sunInstantMs > gapStartMs + 5 * 60_000 &&
        frame.sunInstantMs < gapStartMs + 55 * 60_000,
    );
    // The hour plays as the usual short rest, held where the recorder paused.
    expect(crossing.length).toBeGreaterThan(10);
    expect(crossing.length).toBeLessThanOrEqual(19);
    for (const frame of crossing) expect(frame.position).toEqual(restingAt);
    // Then the 164 m are walked over several frames, not jumped.
    expect(Math.max(...frameMoves(plan))).toBeLessThan(40);
  });

  it('rests on a paused recorder shorter than a GPS stop', () => {
    const coordinates = Array.from(
      { length: 21 },
      (_, index) => [43.1 + 0.002 * (index > 10 ? index - 1 : index), 42.7] as const,
    );
    // Two minutes between points; the 10th and 11th are the same place: a 2-minute pause.
    const elapsed = coordinates.map((_, index) => index * 120);
    const { frames } = planTrackVideo(timedRoute(coordinates, elapsed), camera, null);

    const resting = frames.filter(
      (frame) => frame.position[0] === coordinates[10]?.[0],
    );
    // 0.2 s of rest while the clock runs over the pause.
    expect(resting.length).toBeGreaterThanOrEqual(5);
    const restClock =
      (resting.at(-1)?.sunInstantMs ?? 0) - (resting[0]?.sunInstantMs ?? 0);
    expect(restClock).toBeGreaterThanOrEqual(60_000);
  });

  it('finds a three-minute stay that begins between stop-scan anchors', () => {
    // One point a second: walking 30 m a second, arriving at t = 11, staying exactly
    // three minutes, then walking on.
    const coordinates: (readonly [number, number])[] = [];
    const elapsed: number[] = [];
    for (let second = 0; second <= 260; second += 1) {
      const walked = Math.min(second, 11) + Math.max(0, second - 191);
      coordinates.push([43.1 + 0.00037 * walked, 42.7]);
      elapsed.push(second);
    }
    const { frames } = planTrackVideo(timedRoute(coordinates, elapsed), camera, null);

    const stayAt = coordinates[11]?.[0];
    const resting = frames.filter((frame) => frame.position[0] === stayAt);
    const restClock =
      (resting.at(-1)?.sunInstantMs ?? 0) - (resting[0]?.sunInstantMs ?? 0);
    // Without the stop the stay's three minutes pass within a frame or two.
    expect(resting.length).toBeGreaterThanOrEqual(5);
    expect(restClock).toBeGreaterThanOrEqual(120_000);
  });

  it('ends on the real finish after a final stop', () => {
    const walk = Array.from(
      { length: 10 },
      (_, index) => [43.1 + 0.002 * index, 42.7] as const,
    );
    const finish = [43.1 + 0.002 * 9, 42.7] as const;
    const route = timedRoute(
      [...walk, finish, finish, finish],
      [...walk.map((_, index) => index * 60), 1_200, 1_800, 2_400],
    );

    const last = planTrackVideo(route, camera, null).frames.at(-1);

    expect(last?.overlay.time).toBe(new Date(startMs + 2_400_000).toISOString());
  });

  it('keeps slow estimated stretches, which are walking, not stops', () => {
    // Ten metres every two minutes, as a DIN estimate gives a steep climb.
    const route: TrackVideoRoute = {
      ...straightRoute([43.1, 42.7], [0.000122, 0], 21, 120),
      recordedTime: false,
    };

    const { frames } = planTrackVideo(route, camera, null);

    expect(frames[middle]?.sunInstantMs).toBe(startMs + 1_200_000);
  });

  it('rounds the sun to the minute of each moment', () => {
    const { frames } = planTrackVideo(
      straightRoute([43.1, 42.7], [0.01, 0], 11, 1_237),
      camera,
      null,
    );

    for (const frame of frames) {
      expect(frame.sunInstantMs % 60_000).toBe(0);
      expect(
        Math.abs(frame.sunInstantMs - Date.parse(frame.overlay.time)),
      ).toBeLessThanOrEqual(30_000);
    }
  });

  it('holds a fixed sun instant while the clock runs on', () => {
    const fixed = Date.UTC(2026, 6, 1, 9, 0);
    const { frames } = planTrackVideo(
      {
        ...straightRoute([43.1, 42.7], [0.01, 0], 11, 1_237),
        fixedSunInstantMs: fixed,
      },
      camera,
      null,
    );

    for (const frame of frames) expect(frame.sunInstantMs).toBe(fixed);
    expect(frames.at(-1)?.overlay.time).not.toBe(frames[0]?.overlay.time);
  });

  it("keeps the user's zoom and pitch within readable bounds", () => {
    const view = (zoom: number, pitch: number) => {
      const plan = planTrackVideo(eastward, { zoom, pitch }, null);
      return { zoom: plan.zoom, pitch: plan.frames[middle]?.pitch };
    };
    expect(view(14.3, 35)).toEqual({ zoom: 14.3, pitch: 35 });
    expect(view(8, 80)).toEqual({ zoom: 12, pitch: 60 });
    expect(view(18, 0)).toEqual({ zoom: 16, pitch: 0 });
  });

  it('turns the camera to the direction of travel', () => {
    const north = planTrackVideo(
      straightRoute([43.1, 42.7], [0, 0.01], 11, 600),
      camera,
      null,
    );

    expect(planTrackVideo(eastward, camera, null).frames[middle]?.bearing).toBeCloseTo(
      90,
    );
    expect(north.frames[middle]?.bearing).toBeCloseTo(0);
  });

  it('crosses the antimeridian the short way', () => {
    const route = straightRoute([179.99, 0], [0.004, 0], 6, 600);
    const { frames } = planTrackVideo(route, camera, null);

    expect(Math.max(...frameMoves({ zoom: 14, frames }))).toBeLessThan(10);
    expect(frames[middle]?.bearing).toBeCloseTo(90);
    for (const frame of frames) {
      expect(Math.abs(frame.center[0])).toBeLessThanOrEqual(180);
      expect(geodesicDistanceMeters(frame.center, frame.position)).toBeLessThan(430);
    }
    expect(frames.at(-1)?.position[0]).toBeCloseTo(-180 + 0.01);
  });

  it("counts distance and climb up to the track's stated ascent along the profile", () => {
    const climbing: TrackVideoRoute = {
      ...timedRoute(
        eastward.points.map((point) => point.coordinate),
        eastward.elapsedSeconds,
        { elevations: eastward.points.map((_, index) => 1_000 + index * 10) },
      ),
      ascentMeters: 150,
    };
    const totalMeters = climbing.points.at(-1)?.distanceMeters ?? 0;

    const { frames } = planTrackVideo(climbing, camera, null);

    expect(frames[0]?.overlay).toMatchObject({ distance: '0 m', ascent: '+0' });
    expect(frames.at(-1)?.overlay).toMatchObject({
      distance: `${String(Math.round(totalMeters))} m`,
      ascent: '+150',
    });
    const profile = frames[middle]?.overlay.profile;
    expect(profile?.elevations).toHaveLength(120);
    expect(profile?.elevations[0]).toBeCloseTo(1_000);
    expect(profile?.elevations.at(-1)).toBeCloseTo(1_100);
    expect(profile?.progress).toBeCloseTo(0.5);
    expect(frames.at(-1)?.overlay.profile?.progress).toBeCloseTo(1);

    expect(
      planTrackVideo(eastward, camera, null).frames[middle]?.overlay,
    ).toMatchObject({
      ascent: null,
      profile: null,
    });
  });

  it('glides the camera over a zigzag while the hiker stays on the track and in frame', () => {
    const zigzag = timedRoute(
      Array.from({ length: 41 }, (_, index) => [
        43.1 + 0.0025 * index,
        42.7 + (index % 2) * 0.002,
      ]),
      Array.from({ length: 41 }, (_, index) => index * 150),
    );

    const { frames } = planTrackVideo(zigzag, camera, null);

    const sideways = (pick: (frame: (typeof frames)[number]) => number) => {
      const stretch = frames.slice(100, 400).map(pick);
      return Math.max(...stretch) - Math.min(...stretch);
    };
    // The hiker swings the full 220 m of each zag; the camera much less.
    expect(sideways((frame) => frame.position[1])).toBeCloseTo(0.002);
    expect(sideways((frame) => frame.center[1])).toBeLessThan(0.0008);
  });

  it('keeps the hiker near the center where the route jumps between segments', () => {
    // Two segments 5 km apart: the hiker jumps, the camera must not trail far behind.
    const coordinates = [
      ...Array.from(
        { length: 11 },
        (_, index) => [43.1 + 0.002 * index, 42.7] as const,
      ),
      ...Array.from(
        { length: 11 },
        (_, index) => [43.2 + 0.002 * index, 42.7] as const,
      ),
    ];
    const route = timedRoute(
      coordinates,
      coordinates.map((_, index) => index * 120),
      { segments: coordinates.map((_, index) => (index < 11 ? 0 : 1)) },
    );

    const { frames } = planTrackVideo(route, camera, null);

    // 120 px at zoom 14 there: about 420 m.
    for (const frame of frames) {
      expect(geodesicDistanceMeters(frame.center, frame.position)).toBeLessThan(430);
    }
  });

  it('faces along a new recorded segment, not across the jump to it', () => {
    // Two eastward segments, the second 5.5 km north, its profile segment starting at
    // the jump.
    const coordinates = [
      ...Array.from(
        { length: 11 },
        (_, index) => [43.1 + 0.002 * index, 42.7] as const,
      ),
      ...Array.from(
        { length: 11 },
        (_, index) => [43.1 + 0.002 * index, 42.75] as const,
      ),
    ];
    const route = timedRoute(
      coordinates,
      coordinates.map((_, index) => index * 120),
      { segments: coordinates.map((_, index) => (index < 11 ? 0 : 1)) },
    );
    const jumpMeters = route.points[11]?.distanceMeters ?? 0;
    const totalMeters = route.points.at(-1)?.distanceMeters ?? 0;

    const { frames } = planTrackVideo(
      {
        ...route,
        segments: [
          { type: 'climb', startMeters: 0, endMeters: jumpMeters },
          { type: 'descent', startMeters: jumpMeters, endMeters: totalMeters },
        ],
      },
      camera,
      null,
    );

    for (const frame of frames) expect(frame.bearing).toBeCloseTo(90, 0);
  });

  it('faces up a switchback climb instead of swinging with it', () => {
    // 300 m legs east and west, each 60 m further north: a serpentine climbing north.
    const coordinates = Array.from(
      { length: 61 },
      (_, index) =>
        [
          43.1 + (index % 2 === 0 ? 0 : 0.0037),
          42.7 + Math.floor(index / 2) * 0.00054,
        ] as const,
    );
    const route = withSegments(
      timedRoute(
        coordinates,
        coordinates.map((_, index) => index * 300),
      ),
      [['climb', 1]],
    );

    const plan = planTrackVideo(route, camera, null);

    for (const frame of plan.frames.slice(60, 660)) {
      expect(Math.abs(bearingTurn(0, frame.bearing))).toBeLessThanOrEqual(25);
    }
    expect(Math.max(...bearingSteps(plan))).toBeLessThanOrEqual(2.5);
  });

  it('turns around smoothly at the end of an out-and-back route', () => {
    const plan = planTrackVideo(outAndBack, camera, null);

    expect(bearingTurn(0, plan.frames[60]?.bearing ?? 0)).toBeCloseTo(90);
    expect(bearingTurn(0, plan.frames[660]?.bearing ?? 0)).toBeCloseTo(-90);
    expect(Math.max(...bearingSteps(plan))).toBeLessThanOrEqual(fastestTurnPerFrame);
  });

  it('never swings a descent round past 150° of its starting view', () => {
    // Climbing to a summit plateau, then back down the same line: walking down, relief
    // behind the hiker hides them and the camera turns aside.
    const route = withSegments(outAndBack, [
      ['climb', 0.5],
      ['descent', 1],
    ]);
    const terrain = slopeTerrain((east) =>
      east >= 3_000
        ? 1_000
        : east >= 2_000
          ? 1_000 - 0.6 * (3_000 - east)
          : 400 - 0.2 * (2_000 - east),
    );

    const plan = planTrackVideo(route, closeCamera, terrain);
    const control = planTrackVideo(route, closeCamera, null);

    const descentFrames = plan.frames
      .map((frame, index) => ({ frame, index }))
      .filter(({ frame }) => frameMeters(frame) >= 4_000);
    const start = descentFrames[0]?.frame.bearing ?? 0;
    for (const { frame, index } of descentFrames) {
      expect(Math.abs(frame.bearing - start)).toBeLessThanOrEqual(150);
      expect(
        Math.abs(frame.bearing - (control.frames[index]?.bearing ?? 0)),
      ).toBeLessThanOrEqual(120);
    }
    expect(hiddenRun(plan, terrain)).toBeLessThanOrEqual(10);
    expect(Math.max(...bearingSteps(plan))).toBeLessThanOrEqual(fastestTurnPerFrame);
  });

  it('is more than halfway through a turn when the hiker reaches the next segment', () => {
    // 3 km north climbing, then 3 km east descending.
    const coordinates = [
      ...Array.from(
        { length: 31 },
        (_, index) => [43.1, 42.7 + 0.0009 * index] as const,
      ),
      ...Array.from(
        { length: 30 },
        (_, index) => [43.1 + 0.001223 * (index + 1), 42.727] as const,
      ),
    ];
    const route = withSegments(
      timedRoute(
        coordinates,
        coordinates.map((_, index) => index * 60),
      ),
      [
        ['climb', 0.5],
        ['descent', 1],
      ],
    );

    const plan = planTrackVideo(route, camera, null);

    const cornerMeters = route.points[30]?.distanceMeters ?? 0;
    const corner = plan.frames.find((frame) => frameMeters(frame) >= cornerMeters);
    expect(corner?.bearing).toBeGreaterThanOrEqual(45);
    expect(plan.frames.at(-1)?.bearing).toBeCloseTo(90);
    expect(Math.max(...bearingSteps(plan))).toBeLessThanOrEqual(fastestTurnPerFrame);
  });

  it('turns to see a descent from the side where it drops away along the view', () => {
    // 2 km east on a plateau, then 3 km east down an even 24° slope: nothing hides the
    // hiker, but seen down its fall line the descent is foreshortened.
    const route = withSegments(straightRoute([43.1, 42.7], [0.000612, 0], 101, 60), [
      ['flat', 0.4],
      ['descent', 1],
    ]);
    const slope = 0.45;
    const terrain = slopeTerrain((east) =>
      east <= 2_000 ? 1_000 : 1_000 - slope * (east - 2_000),
    );
    const view = { zoom: 15, pitch: 50 };

    const plan = planTrackVideo(route, view, terrain);
    const control = planTrackVideo(route, view, null);

    expect(hiddenRun(control, terrain)).toBe(0);
    // How squarely the slope faces the camera, relative to level ground.
    const pitch = (view.pitch * Math.PI) / 180;
    const rise = slope * terrain.exaggeration;
    const facing = (bearing: number) =>
      (-rise * Math.sin((bearing * Math.PI) / 180) * Math.sin(pitch) +
        Math.cos(pitch)) /
      Math.hypot(rise, 1) /
      Math.cos(pitch);
    const middle = plan.frames.findIndex((frame) => frameMeters(frame) >= 3_500);
    expect(facing(control.frames[middle]?.bearing ?? 0)).toBeLessThan(0.5);
    // Nearly as squarely as level ground: the aim targets 0.85 at its chosen frames.
    expect(facing(plan.frames[middle]?.bearing ?? 0)).toBeGreaterThanOrEqual(0.8);
    for (const [index, frame] of plan.frames.entries()) {
      if (frameMeters(frame) < 1_000) {
        expect(frame.bearing).toBeCloseTo(control.frames[index]?.bearing ?? 0);
      }
    }
    expect(Math.max(...bearingSteps(plan))).toBeLessThanOrEqual(fastestTurnPerFrame);
  });

  it('turns aside where a descent drops behind relief, keeping the hiker in view', () => {
    // 2 km east on a plateau, then 3 km east down a slope that steepens over its edge.
    const route = withSegments(straightRoute([43.1, 42.7], [0.000612, 0], 101, 60), [
      ['flat', 0.4],
      ['descent', 1],
    ]);
    const terrain = slopeTerrain((east) =>
      east <= 2_000
        ? 1_000
        : east <= 3_000
          ? 1_000 - 0.6 * (east - 2_000)
          : 400 - 0.2 * (east - 3_000),
    );

    const plan = planTrackVideo(route, closeCamera, terrain);
    const control = planTrackVideo(route, closeCamera, null);

    expect(hiddenRun(control, terrain)).toBeGreaterThan(10);
    expect(hiddenRun(plan, terrain)).toBeLessThanOrEqual(10);
    for (const [index, frame] of plan.frames.entries()) {
      const turn = Math.abs(frame.bearing - (control.frames[index]?.bearing ?? 0));
      // Flat ground far from the edge hides nothing: the camera faces the course.
      if (frameMeters(frame) < 1_000) expect(turn).toBeCloseTo(0);
      expect(turn).toBeLessThanOrEqual(120);
    }
    expect(Math.max(...bearingSteps(plan))).toBeLessThanOrEqual(fastestTurnPerFrame);
  });

  it("places profile segments at the route's distances when elevation starts late", () => {
    // 2 km without elevation, then 2 km climbing 300 m and 2 km back down, 50 m apart.
    const track: TrackPoint[] = Array.from({ length: 121 }, (_, index) => {
      const coordinate: [number, number] = [43.1 + 0.00061 * index, 42.7];
      if (index < 40) return { coordinate };
      const elevationMeters = index <= 80 ? (index - 40) * 7.5 : (120 - index) * 7.5;
      return { coordinate, elevationMeters };
    });
    const profile = storedTrackElevationProfile([track], undefined);
    if (profile === null) throw new Error('Expected an elevation profile.');
    const routeMeters = geodesicDistanceMeters(
      track[0]?.coordinate ?? [0, 0],
      track[120]?.coordinate ?? [0, 0],
    );
    const route = createTrackTimingRoute(profile, [track], routeMeters);

    const profileDescent = profile.segments.find(
      (segment) => segment.type === 'descent',
    );
    const segments = trackVideoSegments(profile, route.points);

    expect(segments.map((segment) => segment.type)).toEqual(
      profile.segments.map((segment) => segment.type),
    );
    const descent = segments.find((segment) => segment.type === 'descent');
    // The profile counts from where elevation starts; the route from its real start.
    expect(profileDescent?.startDistanceMeters).toBeLessThan(2_500);
    expect(descent?.startMeters).toBeGreaterThan(3_500);
    expect(descent?.endMeters).toBeCloseTo(routeMeters, -2);
    expect(trackVideoSegments(null, route.points)).toEqual([]);
  });
});
