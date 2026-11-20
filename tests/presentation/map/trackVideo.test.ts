import { describe, expect, it } from 'vitest';

import type { TrackTimingPoint } from '@/application/weather/TrackWeatherForecast';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import {
  planTrackVideo,
  trackVideoSunStepMs,
  type TrackVideoRoute,
} from '@/presentation/map/trackVideo';

const startMs = Date.UTC(2026, 6, 1, 5, 0);
const view = { widthPixels: 1_280, pitch: 50 };

/** A straight route from `from` by `step` per point, timed `secondsPerPoint` apart. */
function straightRoute(
  from: readonly [number, number],
  step: readonly [number, number],
  count: number,
  secondsPerPoint: number,
): TrackVideoRoute {
  const points: TrackTimingPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const coordinate: [number, number] = [
      from[0] + step[0] * index,
      from[1] + step[1] * index,
    ];
    const previous = points.at(-1);
    points.push({
      coordinate,
      distanceMeters:
        previous === undefined
          ? 0
          : previous.distanceMeters +
            geodesicDistanceMeters(previous.coordinate, coordinate),
      sourceSegmentIndex: 0,
    });
  }
  return {
    points,
    elapsedSeconds: points.map((_, index) => index * secondsPerPoint),
    startMs,
    formatTime: (instantMs) => new Date(instantMs).toISOString(),
  };
}

describe('planTrackVideo', () => {
  it('plays the hike from start to finish in video time and holds both ends', () => {
    const route = straightRoute([43.1, 42.7], [0.01, 0], 11, 1_800);
    const finishMs = startMs + 10 * 1_800 * 1_000;

    const { frames } = planTrackVideo(route, view);

    const first = frames[0];
    const last = frames.at(-1);
    expect(first?.position).toEqual([43.1, 42.7]);
    expect(first?.caption).toBe(new Date(startMs).toISOString());
    expect(last?.position).toEqual([43.2, 42.7]);
    expect(last?.caption).toBe(new Date(finishMs).toISOString());
    expect(first?.durationMs).toBeGreaterThan(1_000);
    expect(last?.durationMs).toBe(1_000);
    expect(frames.reduce((sum, frame) => sum + frame.durationMs, 0)).toBeCloseTo(
      22_000,
    );
    for (const frame of frames) {
      expect(frame.sunInstantMs % trackVideoSunStepMs).toBe(0);
      expect(frame.sunInstantMs).toBeGreaterThanOrEqual(startMs);
      expect(frame.sunInstantMs).toBeLessThanOrEqual(finishMs);
    }
    // Halfway through the video is halfway through the hike, in time and place.
    const middle = frames[(frames.length - 1) / 2];
    expect(middle?.sunInstantMs).toBe(startMs + 5 * 1_800 * 1_000);
    expect(middle?.position[0]).toBeCloseTo(43.15);
  });

  it('keeps the hiker in place through a recorded pause while time runs on', () => {
    const route = straightRoute([43.1, 42.7], [0.01, 0], 3, 600);
    // A two-hour break at the middle point: same place, later time.
    const middle = route.points[1];
    if (middle === undefined) throw new Error('The route has a middle point.');
    const paused: TrackVideoRoute = {
      ...route,
      points: [route.points[0], middle, middle, route.points[2]].filter(
        (point) => point !== undefined,
      ),
      elapsedSeconds: [0, 600, 600 + 7_200, 1_200 + 7_200],
    };

    const { frames } = planTrackVideo(paused, view);

    const breakFrames = frames.filter(
      (frame) =>
        frame.sunInstantMs >= startMs + 900 * 1_000 &&
        frame.sunInstantMs <= startMs + 7_500 * 1_000,
    );
    expect(breakFrames.length).toBeGreaterThan(frames.length / 2);
    for (const frame of breakFrames) expect(frame.position).toEqual(middle.coordinate);
  });

  it('turns the camera to the direction of travel', () => {
    const east = planTrackVideo(straightRoute([43.1, 42.7], [0.01, 0], 11, 600), view);
    const north = planTrackVideo(straightRoute([43.1, 42.7], [0, 0.01], 11, 600), view);

    expect(east.frames[300]?.bearing).toBeCloseTo(90);
    expect(north.frames[300]?.bearing).toBeCloseTo(0);
  });

  it('shows more ground around the hiker on a longer route', () => {
    const short = planTrackVideo(straightRoute([43.1, 42.7], [0.01, 0], 11, 600), view);
    const long = planTrackVideo(straightRoute([43.1, 42.7], [0.03, 0], 11, 600), view);

    expect(long.zoom).toBeLessThan(short.zoom);
    expect(long.pitch).toBe(50);
  });
});
