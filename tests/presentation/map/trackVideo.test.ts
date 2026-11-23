import { describe, expect, it } from 'vitest';

import {
  createTrackTimingRoute,
  type TrackTimingPoint,
} from '@/application/weather/TrackWeatherForecast';
import { storedTrackElevationProfile } from '@/domain/tracks/elevationProfile';
import type { TrackPoint } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import {
  avoidTerrainOcclusion,
  planTrackVideo,
  trackVideoDescents,
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
    descents: [],
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

  it('plays a paused recorder as a brief rest, then walks the gap', () => {
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
    const { frames } = planTrackVideo(timedRoute(coordinates, elapsed), camera);

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
    const { frames } = planTrackVideo(timedRoute(coordinates, elapsed), camera);

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

  it('holds a fixed sun instant while the clock runs on', () => {
    const fixed = Date.UTC(2026, 6, 1, 9, 0);
    const { frames } = planTrackVideo(
      {
        ...straightRoute([43.1, 42.7], [0.01, 0], 11, 1_237),
        fixedSunInstantMs: fixed,
      },
      camera,
    );

    for (const frame of frames) expect(frame.sunInstantMs).toBe(fixed);
    expect(frames.at(-1)?.overlay.time).not.toBe(frames[0]?.overlay.time);
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

  it('crosses the antimeridian the short way', () => {
    const route = straightRoute([179.99, 0], [0.004, 0], 6, 600);
    const { frames } = planTrackVideo(route, camera);

    expect(Math.max(...frameMoves({ zoom: 14, frames, descents: [] }))).toBeLessThan(
      10,
    );
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

  it('faces the general direction up a switchback trail instead of swinging with it', () => {
    // 300 m legs east and west, each 60 m further north: a serpentine climbing north.
    const coordinates = Array.from(
      { length: 61 },
      (_, index) =>
        [
          43.1 + (index % 2 === 0 ? 0 : 0.0037),
          42.7 + Math.floor(index / 2) * 0.00054,
        ] as const,
    );
    const route = timedRoute(
      coordinates,
      coordinates.map((_, index) => index * 300),
    );

    const { frames } = planTrackVideo(route, camera);

    for (const frame of frames.slice(60, 660)) {
      expect(Math.abs(bearingTurn(0, frame.bearing))).toBeLessThan(30);
    }
    const steps = frames
      .slice(1)
      .map((frame, index) =>
        Math.abs(bearingTurn(frames[index]?.bearing ?? 0, frame.bearing)),
      );
    // Never faster than 20° a second.
    expect(Math.max(...steps)).toBeLessThan(20 / 30);
  });

  it('turns around smoothly at the end of an out-and-back route', () => {
    // 4 km east, then back along the same line.
    const out = Array.from(
      { length: 41 },
      (_, index) => [43.1 + 0.00122 * index, 42.7] as const,
    );
    const coordinates = [...out, ...out.slice(0, -1).reverse()];
    const route = timedRoute(
      coordinates,
      coordinates.map((_, index) => index * 90),
    );

    const { frames } = planTrackVideo(route, camera);

    expect(bearingTurn(0, frames[60]?.bearing ?? 0)).toBeCloseTo(90);
    expect(Math.abs(bearingTurn(0, frames[660]?.bearing ?? 0))).toBeCloseTo(90);
    expect(bearingTurn(0, frames[660]?.bearing ?? 0)).toBeCloseTo(-90);
    const steps = frames
      .slice(1)
      .map((frame, index) =>
        Math.abs(bearingTurn(frames[index]?.bearing ?? 0, frame.bearing)),
      );
    // The half turn spreads over seconds instead of a jump.
    expect(Math.max(...steps)).toBeLessThan(2);
  });

  it('turns only on descents long enough, merging close ones', () => {
    const descents = (ranges: readonly (readonly [number, number])[]) =>
      planTrackVideo(
        {
          ...eastward,
          descents: ranges.map(([startMeters, endMeters]) => ({
            startMeters,
            endMeters,
          })),
        },
        camera,
      ).descents;

    // 8.2 km in 720 frames: about 11 m a frame.
    expect(descents([[100, 300]])).toEqual([]);
    const merged = descents([
      [2_000, 4_000],
      [4_200, 6_000],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.from).toBeLessThan(middle);
    expect(merged[0]?.to).toBeGreaterThan(middle + 100);
  });

  it("places profile descents at the route's distances when elevation starts late", () => {
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
    const [descent] = trackVideoDescents(profile, route.points);

    // The profile counts from where elevation starts; the route from its real start.
    expect(profileDescent?.startDistanceMeters).toBeLessThan(2_500);
    expect(descent?.startMeters).toBeGreaterThan(3_500);
    expect(descent?.endMeters).toBeCloseTo(routeMeters, -2);
    expect(trackVideoDescents(null, route.points)).toEqual([]);
  });
});

describe('avoidTerrainOcclusion', () => {
  const view = {
    heightPixels: 900,
    fieldOfViewDegrees: 36.87,
    terrainExaggeration: 1.15,
  };
  // 8.2 km east; the descent from 2 to 6 km is frames 190–520 or so.
  const plan = planTrackVideo(
    {
      ...straightRoute([43.1, 42.7], [0.01, 0], 11, 1_800),
      descents: [{ startMeters: 2_000, endMeters: 6_000 }],
    },
    { zoom: 14, pitch: 50 },
  );
  const lines = trackVideoSightLines(plan, view);
  const descent = plan.descents[0] ?? { from: 0, to: 0 };
  const inside = Math.round((descent.from + descent.to) / 2);

  /** Bare ground, with a wall right in front of the hiker on the listed views. */
  function terrain(hides: (bearingOffset: number, frame: number) => boolean) {
    return lines.map((line) =>
      line.coordinates.map((_, index) =>
        index === 3 && hides(line.bearingOffset, line.frameIndex) ? 10_000 : 0,
      ),
    );
  }
  const turnAt = (adjusted: TrackVideoPlan, index: number) =>
    bearingTurn(plan.frames[index]?.bearing ?? 0, adjusted.frames[index]?.bearing ?? 0);

  it('traces sight lines only on descents, from the hiker back to the camera', () => {
    expect(new Set(lines.map((line) => line.bearingOffset))).toEqual(
      new Set([0, 60, -60, 90, -90]),
    );
    for (const line of lines) {
      expect(line.frameIndex).toBeGreaterThan(descent.from - 6);
      expect(line.frameIndex).toBeLessThan(descent.to);
    }
    const planned = lines.find(
      (line) => line.frameIndex === inside - (inside % 6) && line.bearingOffset === 0,
    );
    const frame = plan.frames[inside - (inside % 6)];
    expect(planned?.coordinates[0]).toEqual(frame?.position);
    expect(planned?.coordinates[1]).toEqual(frame?.center);
    // Travelling east, the camera is to the west, about 1 km up.
    expect(planned?.coordinates.at(-1)?.[0]).toBeLessThan(frame?.position[0] ?? 0);
    expect(planned?.cameraHeightMeters).toBeGreaterThan(900);
    expect(trackVideoSightLines({ ...plan, descents: [] }, view)).toEqual([]);
  });

  it('keeps the planned view when the hiker drops out of it for up to 2 s', () => {
    const blips = terrain(
      (offset, frame) => offset === 0 && frame >= inside && frame < inside + 60 - 6,
    );
    expect(avoidTerrainOcclusion(plan, lines, blips, view)).toBe(plan);
    const unknown = lines.map((line) => line.coordinates.map(() => null));
    expect(avoidTerrainOcclusion(plan, lines, unknown, view)).toBe(plan);
  });

  it('turns 60° for the whole descent, easing in and out', () => {
    const adjusted = avoidTerrainOcclusion(
      plan,
      lines,
      terrain(
        (offset, frame) => offset === 0 && frame >= inside && frame < inside + 90,
      ),
      view,
    );

    expect(turnAt(adjusted, inside)).toBeCloseTo(60);
    // Two ±60-frame averages: fully turned from 120 frames into the descent.
    expect(turnAt(adjusted, descent.from + 120)).toBeCloseTo(60);
    expect(turnAt(adjusted, descent.to - 121)).toBeCloseTo(60);
    expect(turnAt(adjusted, 0)).toBeCloseTo(0);
    expect(turnAt(adjusted, 720)).toBeCloseTo(0);
    const steps = adjusted.frames
      .slice(1)
      .map((_, index) =>
        Math.abs(turnAt(adjusted, index + 1) - turnAt(adjusted, index)),
      );
    // At most 30° a second for the turn.
    expect(Math.max(...steps)).toBeLessThan(1);
  });

  it('takes the other side, then 90°, never looking back', () => {
    const hidden = (offsets: readonly number[]) =>
      terrain((offset, frame) => offsets.includes(offset) && frame >= inside);
    expect(
      turnAt(avoidTerrainOcclusion(plan, lines, hidden([0, 60]), view), inside),
    ).toBeCloseTo(-60);
    expect(
      turnAt(avoidTerrainOcclusion(plan, lines, hidden([0, 60, -60]), view), inside),
    ).toBeCloseTo(90);
    // Hidden from everywhere: the least hidden view, the planned one on a tie.
    expect(
      avoidTerrainOcclusion(plan, lines, hidden([0, 60, -60, 90, -90]), view),
    ).toBe(plan);
  });
});
