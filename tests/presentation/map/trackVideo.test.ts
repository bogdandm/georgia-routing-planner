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
  elevations?: readonly number[],
): TrackVideoRoute {
  const points: TrackTimingPoint[] = [];
  for (const [index, coordinate] of coordinates.entries()) {
    const previous = points.at(-1);
    const elevationMeters = elevations?.[index];
    points.push({
      coordinate: [coordinate[0], coordinate[1]],
      distanceMeters:
        previous === undefined
          ? 0
          : previous.distanceMeters +
            geodesicDistanceMeters(previous.coordinate, [coordinate[0], coordinate[1]]),
      ...(elevationMeters === undefined ? {} : { elevationMeters }),
      sourceSegmentIndex: 0,
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

describe('planTrackVideo', () => {
  it('eases out of the start and into the finish, holding both ends', () => {
    const route = straightRoute([43.1, 42.7], [0.01, 0], 11, 1_800);

    const { frames } = planTrackVideo(route, camera);

    const first = frames[0];
    const last = frames.at(-1);
    expect(first?.position).toEqual([43.1, 42.7]);
    expect(first?.overlay.time).toBe(new Date(startMs).toISOString());
    expect(last?.position[0]).toBeCloseTo(43.2);
    expect(last?.overlay.time).toBe(new Date(startMs + 18_000_000).toISOString());
    expect(frames.reduce((sum, frame) => sum + frame.durationMs, 0)).toBeCloseTo(
      22_000,
    );
    const step = (index: number) =>
      (frames[index + 1]?.position[0] ?? 0) - (frames[index]?.position[0] ?? 0);
    // Barely moving at either end, at full speed in the middle.
    expect(step(0)).toBeLessThan(step(300) / 50);
    expect(step(frames.length - 2)).toBeLessThan(step(300) / 50);
    // Even speed through the middle: halfway in video is halfway along the route.
    expect(frames[300]?.position[0]).toBeCloseTo(43.15);
  });

  it('skips a stop where GPS jitters in place, while the clock jumps over it', () => {
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
    const walkInSeconds = walkIn.map((_, index) => index * 60);
    const stopStartSeconds = 10 * 60;
    const stopSeconds = stop.map((_, index) => stopStartSeconds + index * 120);
    const stopEndSeconds = stopSeconds.at(-1) ?? 0;
    const walkOutSeconds = walkOut.map((_, index) => stopEndSeconds + (index + 1) * 60);
    const route = timedRoute(
      [...walkIn, ...stop, ...walkOut],
      [...walkInSeconds, ...stopSeconds, ...walkOutSeconds],
    );

    const { frames } = planTrackVideo(route, camera);

    const inStop = frames.filter(
      (frame) =>
        frame.sunInstantMs > startMs + (stopStartSeconds + 120) * 1_000 &&
        frame.sunInstantMs < startMs + (stopEndSeconds - 120) * 1_000,
    );
    expect(inStop).toEqual([]);
    const jumps = frames
      .slice(1)
      .map((frame, index) => frame.sunInstantMs - (frames[index]?.sunInstantMs ?? 0));
    expect(Math.max(...jumps)).toBeGreaterThanOrEqual(55 * 60_000);
  });

  it('skips a paused recorder gap without stopping the hiker on it', () => {
    const coordinates = Array.from(
      { length: 21 },
      (_, index) => [43.1 + 0.002 * index, 42.7] as const,
    );
    // Two minutes between points, and an hour between the 10th and the 11th.
    const elapsed = coordinates.map(
      (_, index) => index * 120 + (index > 10 ? 3_600 : 0),
    );
    const route = timedRoute(coordinates, elapsed);

    const { frames } = planTrackVideo(route, camera);

    const gapStartMs = startMs + 1_200 * 1_000;
    const inGap = frames.filter(
      (frame) =>
        frame.sunInstantMs > gapStartMs + 10 * 60_000 &&
        frame.sunInstantMs < gapStartMs + 50 * 60_000,
    );
    // The 164 m gap takes as long as walking it, not an hour of the video.
    expect(inGap.length).toBeLessThan(frames.length / 20);
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

    // Even progress through time: halfway in video is halfway along the climb.
    expect(frames[300]?.sunInstantMs).toBe(startMs + 1_200_000);
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
    const route = straightRoute([43.1, 42.7], [0.01, 0], 11, 600);

    const view = (zoom: number, pitch: number) => {
      const plan = planTrackVideo(route, { zoom, pitch });
      return { zoom: plan.zoom, pitch: plan.frames[300]?.pitch };
    };
    expect(view(14.3, 35)).toEqual({ zoom: 14.3, pitch: 35 });
    expect(view(8, 80)).toEqual({ zoom: 12, pitch: 60 });
    expect(view(18, 0)).toEqual({ zoom: 16, pitch: 0 });
  });

  it('turns the camera to the direction of travel', () => {
    const east = planTrackVideo(
      straightRoute([43.1, 42.7], [0.01, 0], 11, 600),
      camera,
    );
    const north = planTrackVideo(
      straightRoute([43.1, 42.7], [0, 0.01], 11, 600),
      camera,
    );

    expect(east.frames[300]?.bearing).toBeCloseTo(90);
    expect(north.frames[300]?.bearing).toBeCloseTo(0);
  });

  it("counts distance and climb up to the track's stated ascent along the profile", () => {
    const flat = straightRoute([43.1, 42.7], [0.01, 0], 11, 600);
    const climbing: TrackVideoRoute = {
      ...timedRoute(
        flat.points.map((point) => point.coordinate),
        flat.elapsedSeconds,
        flat.points.map((_, index) => 1_000 + index * 10),
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
    const profile = frames[300]?.overlay.profile;
    expect(profile?.elevations).toHaveLength(120);
    expect(profile?.elevations[0]).toBeCloseTo(1_000);
    expect(profile?.elevations.at(-1)).toBeCloseTo(1_100);
    expect(profile?.progress).toBeCloseTo(0.5);
    expect(frames.at(-1)?.overlay.profile?.progress).toBeCloseTo(1);

    expect(planTrackVideo(flat, camera).frames[300]?.overlay).toMatchObject({
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
      const middle = frames.slice(100, 500).map(pick);
      return Math.max(...middle) - Math.min(...middle);
    };
    // The hiker swings the full 220 m of each zag; the camera much less.
    expect(sideways((frame) => frame.position[1])).toBeCloseTo(0.002);
    expect(sideways((frame) => frame.center[1])).toBeLessThan(0.0008);
    for (const frame of frames) {
      expect(geodesicDistanceMeters(frame.center, frame.position)).toBeLessThan(250);
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
   * Bare-earth heights for every sight line: a 400 m wall right behind the hiker during
   * frames 240–360, for the views in `blocked` (-1 the planned view, then the fallback
   * angles in order: right, left, ahead, top-down).
   */
  function terrain(blocked: readonly number[]) {
    return lines.map((line) =>
      line.coordinates.map((_, index) =>
        index === 3 &&
        blocked.includes(line.angle) &&
        line.frameIndex >= 240 &&
        line.frameIndex <= 360
          ? 400
          : 0,
      ),
    );
  }

  const bearingTurn = (adjusted: TrackVideoPlan, index: number) =>
    (adjusted.frames[index]?.bearing ?? 0) - (plan.frames[index]?.bearing ?? 0);

  it('places the camera behind the hiker and the line rising toward it', () => {
    const planned = lines.find((line) => line.frameIndex === 300 && line.angle === -1);
    const fromSide = lines.find((line) => line.frameIndex === 300 && line.angle === 0);
    const hiker = plan.frames[300]?.position ?? [0, 0];

    expect(planned?.coordinates[0]).toEqual(hiker);
    // Travelling east, the camera is to the west; turned right, it looks from the north.
    expect(planned?.coordinates.at(-1)?.[0]).toBeLessThan(hiker[0]);
    expect(fromSide?.coordinates.at(-1)?.[1]).toBeGreaterThan(hiker[1]);
    const rises = planned?.rises ?? [];
    expect(
      rises.every((rise, index) => index === 0 || rise > (rises[index - 1] ?? 0)),
    ).toBe(true);
  });

  it('turns the camera to the side around hidden stretches, easing in and out', () => {
    const adjusted = avoidTerrainOcclusion(plan, lines, terrain([-1]), view);

    expect(bearingTurn(adjusted, 300)).toBeCloseTo(90);
    expect(bearingTurn(adjusted, 240)).toBeCloseTo(90);
    expect(bearingTurn(adjusted, 100)).toBeCloseTo(0);
    expect(bearingTurn(adjusted, 500)).toBeCloseTo(0);
    const steps = adjusted.frames
      .slice(1)
      .map((_, index) =>
        Math.abs(bearingTurn(adjusted, index + 1) - bearingTurn(adjusted, index)),
      );
    expect(Math.max(...steps)).toBeLessThan(5);
    expect(adjusted.frames[300]?.pitch).toBe(50);
  });

  it('takes the other side, then a higher camera, when nearer angles are blocked too', () => {
    const left = avoidTerrainOcclusion(plan, lines, terrain([-1, 0]), view);
    expect(bearingTurn(left, 300)).toBeCloseTo(-90);

    const higher = avoidTerrainOcclusion(plan, lines, terrain([-1, 0, 1, 2]), view);
    expect(bearingTurn(higher, 300)).toBeCloseTo(0);
    expect(higher.frames[300]?.pitch).toBeCloseTo(20);
    expect(higher.frames[100]?.pitch).toBeCloseTo(50);
  });

  it('keeps the plan where nothing is hidden or no angle helps', () => {
    expect(avoidTerrainOcclusion(plan, lines, terrain([]), view)).toBe(plan);
    const stuck = avoidTerrainOcclusion(plan, lines, terrain([-1, 0, 1, 2, 3]), view);
    expect(bearingTurn(stuck, 300)).toBeCloseTo(0);
    expect(stuck.frames[300]?.pitch).toBeCloseTo(50);
  });
});
