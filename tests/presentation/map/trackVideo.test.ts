import { describe, expect, it } from 'vitest';

import type { TrackTimingPoint } from '@/application/weather/TrackWeatherForecast';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import {
  avoidTerrainOcclusion,
  planTrackVideo,
  trackVideoSightLines,
  type TrackVideoPlan,
  type TrackVideoRoute,
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

describe('planTrackVideo', () => {
  // 8.2 km east, 24 s of travel: 720 travel frames and the finish.
  const eastward = straightRoute([43.1, 42.7], [0.01, 0], 11, 1_800);
  const middle = 360;

  it('lasts 25 s: starts moving, eases in and out, and holds only the finish', () => {
    const plan = planTrackVideo(eastward, camera);
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
    const moves = frameMoves(planTrackVideo(timedRoute(coordinates, elapsed), camera));
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

    const { frames } = planTrackVideo(route, camera);

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

  it('plays a paused recorder gap briefly while the hiker crosses it', () => {
    const coordinates = Array.from(
      { length: 21 },
      (_, index) => [43.1 + 0.002 * index, 42.7] as const,
    );
    // Two minutes between points, and an hour between the 10th and the 11th.
    const elapsed = coordinates.map(
      (_, index) => index * 120 + (index > 10 ? 3_600 : 0),
    );
    const plan = planTrackVideo(timedRoute(coordinates, elapsed), camera);

    const gapStartMs = startMs + 1_200 * 1_000;
    const crossing = plan.frames
      .map((frame, index) => ({ frame, index }))
      .filter(
        ({ frame }) =>
          frame.sunInstantMs > gapStartMs + 5 * 60_000 &&
          frame.sunInstantMs < gapStartMs + 55 * 60_000,
      );
    // Its 164 m take their twentieth of the walk plus a short rest, under 2 s.
    expect(crossing.length).toBeLessThan(60);
    const moves = frameMoves(plan);
    for (const { index } of crossing) expect(moves[index]).toBeGreaterThan(0);
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

    const last = planTrackVideo(route, camera).frames.at(-1);

    expect(last?.overlay.time).toBe(new Date(startMs + 2_400_000).toISOString());
  });

  it('keeps slow estimated stretches, which are walking, not stops', () => {
    // Ten metres every two minutes, as a DIN estimate gives a steep climb.
    const route: TrackVideoRoute = {
      ...straightRoute([43.1, 42.7], [0.000122, 0], 21, 120),
      recordedTime: false,
    };

    const { frames } = planTrackVideo(route, camera);

    expect(frames[middle]?.sunInstantMs).toBe(startMs + 1_200_000);
  });

  it('rounds the sun to the minute of each moment', () => {
    const { frames } = planTrackVideo(
      straightRoute([43.1, 42.7], [0.01, 0], 11, 1_237),
      camera,
    );

    for (const frame of frames) {
      expect(frame.sunInstantMs % 60_000).toBe(0);
      expect(
        Math.abs(frame.sunInstantMs - Date.parse(frame.overlay.time)),
      ).toBeLessThanOrEqual(30_000);
    }
  });

  it("keeps the user's zoom and pitch within readable bounds", () => {
    const view = (zoom: number, pitch: number) => {
      const plan = planTrackVideo(eastward, { zoom, pitch });
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
    );

    expect(planTrackVideo(eastward, camera).frames[middle]?.bearing).toBeCloseTo(90);
    expect(north.frames[middle]?.bearing).toBeCloseTo(0);
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

    const { frames } = planTrackVideo(climbing, camera);

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

    expect(planTrackVideo(eastward, camera).frames[middle]?.overlay).toMatchObject({
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

    const { frames } = planTrackVideo(zigzag, camera);

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

    const { frames } = planTrackVideo(route, camera);

    // 120 px at zoom 14 there: about 420 m.
    for (const frame of frames) {
      expect(geodesicDistanceMeters(frame.center, frame.position)).toBeLessThan(430);
    }
  });
});

describe('avoidTerrainOcclusion', () => {
  const view = {
    heightPixels: 900,
    fieldOfViewDegrees: 36.87,
    terrainExaggeration: 1.15,
  };
  const plan = planTrackVideo(straightRoute([43.1, 42.7], [0.01, 0], 11, 1_800), {
    zoom: 14,
    pitch: 50,
  });
  const lines = trackVideoSightLines(plan, view);

  /**
   * Bare-earth heights for every sight line: flat ground, except a 400 m wall right in
   * front of the hiker for each listed view (-1 the planned one, then the fallback
   * angles in order: right, left, ahead, top-down) between frames `from` and `to`.
   */
  function terrain(
    walls: readonly {
      readonly angle: number;
      readonly from: number;
      readonly to: number;
    }[],
  ) {
    return lines.map((line) =>
      line.coordinates.map((_, index) =>
        index === 3 &&
        walls.some(
          (wall) =>
            wall.angle === line.angle &&
            line.frameIndex >= wall.from &&
            line.frameIndex <= wall.to,
        )
          ? 400
          : 0,
      ),
    );
  }
  const hidden = (angles: readonly number[], from = 200, to = 280) =>
    terrain(angles.map((angle) => ({ angle, from, to })));

  const bearingTurn = (adjusted: TrackVideoPlan, index: number) =>
    (adjusted.frames[index]?.bearing ?? 0) - (plan.frames[index]?.bearing ?? 0);

  it('traces the line from the hiker to the camera behind the averaged center', () => {
    const planned = lines.find((line) => line.frameIndex === 240 && line.angle === -1);
    const fromSide = lines.find((line) => line.frameIndex === 240 && line.angle === 0);
    const frame = plan.frames[240];

    expect(planned?.coordinates[0]).toEqual(frame?.position);
    expect(planned?.coordinates[1]).toEqual(frame?.center);
    // Travelling east, the camera is to the west; turned right, it looks from the north.
    expect(planned?.coordinates.at(-1)?.[0]).toBeLessThan(frame?.position[0] ?? 0);
    expect(fromSide?.coordinates.at(-1)?.[1]).toBeGreaterThan(frame?.position[1] ?? 0);
    const shares = planned?.shares ?? [];
    expect(shares.every((share, index) => share > (shares[index - 1] ?? 0))).toBe(true);
    // 450 px from the center at zoom 14 and 50° pitch: about 1 km up.
    expect(planned?.cameraHeightMeters).toBeGreaterThan(900);
  });

  it('turns the camera to the side around hidden stretches, easing in and out', () => {
    const adjusted = avoidTerrainOcclusion(plan, lines, hidden([-1]), view);

    expect(bearingTurn(adjusted, 200)).toBeCloseTo(90);
    expect(bearingTurn(adjusted, 280)).toBeCloseTo(90);
    expect(bearingTurn(adjusted, 100)).toBeCloseTo(0);
    expect(bearingTurn(adjusted, 420)).toBeCloseTo(0);
    const steps = adjusted.frames
      .slice(1)
      .map((_, index) =>
        Math.abs(bearingTurn(adjusted, index + 1) - bearingTurn(adjusted, index)),
      );
    expect(Math.max(...steps)).toBeLessThan(5);
    expect(adjusted.frames[240]?.pitch).toBe(50);
  });

  it('takes the other side, then a higher camera, when nearer angles are blocked too', () => {
    const left = avoidTerrainOcclusion(plan, lines, hidden([-1, 0]), view);
    expect(bearingTurn(left, 240)).toBeCloseTo(-90);

    const higher = avoidTerrainOcclusion(plan, lines, hidden([-1, 0, 1, 2]), view);
    expect(bearingTurn(higher, 240)).toBeCloseTo(0);
    expect(higher.frames[240]?.pitch).toBeCloseTo(20);
    expect(higher.frames[100]?.pitch).toBeCloseTo(50);
  });

  it('changes angle part way when the first one is blocked later in the stretch', () => {
    const walls = terrain([
      { angle: -1, from: 120, to: 360 },
      // No view sees the hiker through the whole stretch: the right side only in its
      // first half, the left side only in its second, ahead and above never late.
      { angle: 0, from: 240, to: 480 },
      { angle: 1, from: 60, to: 180 },
      { angle: 2, from: 180, to: 480 },
      { angle: 3, from: 180, to: 480 },
    ]);

    const adjusted = avoidTerrainOcclusion(plan, lines, walls, view);

    expect(bearingTurn(adjusted, 150)).toBeCloseTo(90);
    expect(bearingTurn(adjusted, 320)).toBeCloseTo(-90);
  });

  it('keeps the plan where nothing is hidden or no angle helps', () => {
    expect(avoidTerrainOcclusion(plan, lines, hidden([]), view)).toBe(plan);
    const stuck = avoidTerrainOcclusion(plan, lines, hidden([-1, 0, 1, 2, 3]), view);
    expect(bearingTurn(stuck, 240)).toBeCloseTo(0);
    expect(stuck.frames[240]?.pitch).toBeCloseTo(50);
  });
});
