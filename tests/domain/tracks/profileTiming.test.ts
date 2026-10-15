import { describe, expect, it } from 'vitest';

import {
  recordedElapsedSeconds,
  smoothedSpeedMetersPerSecond,
} from '@/domain/tracks/profileTiming';

const start = Date.parse('2026-05-01T08:00:00Z');

function at(seconds: number): { readonly recordedAt: string } {
  return { recordedAt: new Date(start + seconds * 1_000).toISOString() };
}

describe('recordedElapsedSeconds', () => {
  it('measures from the first fix and never moves backward on clock jumps', () => {
    expect(recordedElapsedSeconds([at(0), at(60), at(30), at(120)])).toEqual([
      0, 60, 60, 120,
    ]);
  });

  it('is unavailable when a point lacks time or time never advances', () => {
    expect(recordedElapsedSeconds([at(0), {}, at(120)])).toBeNull();
    expect(recordedElapsedSeconds([at(0), { recordedAt: 'not a time' }])).toBeNull();
    expect(recordedElapsedSeconds([at(30), at(30)])).toBeNull();
  });
});

describe('smoothedSpeedMetersPerSecond', () => {
  it('flattens alternating per-fix speeds to the walking pace', () => {
    // Fixes every 5 s alternate 2 m and 8 m steps: raw 0.4 and 1.6 m/s, mean 1 m/s.
    const elapsed: number[] = [];
    const points: { distanceMeters: number }[] = [];
    let distanceMeters = 0;
    for (let index = 0; index <= 720; index += 1) {
      elapsed.push(index * 5);
      points.push({ distanceMeters });
      distanceMeters += index % 2 === 0 ? 2 : 8;
    }

    const speeds = smoothedSpeedMetersPerSecond(points, elapsed);

    for (const speed of speeds.slice(1, -1)) {
      expect(speed).toBeCloseTo(1, 1);
    }
  });

  it('weights a sparsely sampled pause by its duration', () => {
    // 30 min at 1 m/s, a 30 min pause recorded by only three fixes, 30 min at 2 m/s.
    const elapsed: number[] = [];
    const points: { distanceMeters: number }[] = [];
    for (let seconds = 0; seconds <= 1_800; seconds += 10) {
      elapsed.push(seconds);
      points.push({ distanceMeters: seconds });
    }
    elapsed.push(2_700, 3_600);
    points.push({ distanceMeters: 1_800 }, { distanceMeters: 1_800 });
    for (let seconds = 3_610; seconds <= 5_400; seconds += 10) {
      elapsed.push(seconds);
      points.push({ distanceMeters: 1_800 + (seconds - 3_600) * 2 });
    }

    const speeds = smoothedSpeedMetersPerSecond(points, elapsed);
    const speedAt = (seconds: number): number =>
      speeds[elapsed.indexOf(seconds)] ?? Number.NaN;

    expect(speedAt(900)).toBeCloseTo(1, 3);
    expect(speedAt(2_700)).toBeCloseTo(0, 3);
    expect(speedAt(4_500)).toBeCloseTo(2, 3);
    expect(speedAt(5_400)).toBeCloseTo(2, 3);
  });

  it('rejects elapsed times that do not match the points', () => {
    expect(() =>
      smoothedSpeedMetersPerSecond([{ distanceMeters: 0 }], [0, 10]),
    ).toThrow(RangeError);
  });
});
