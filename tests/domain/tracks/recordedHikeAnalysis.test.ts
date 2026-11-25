import { describe, expect, it } from 'vitest';

import {
  builtInHikingTimePresets,
  estimateHikingTime,
} from '@/domain/tracks/hikingTime';
import {
  analyzeRecordedHike,
  compareGradeBands,
  type RecordedHikePoint,
} from '@/domain/tracks/recordedHikeAnalysis';

const METERS_PER_DEGREE_LATITUDE = 111_195;
const START_MILLISECONDS = Date.UTC(2026, 5, 1, 7);
const SAMPLE_SECONDS = 5;
const WALKING_METERS_PER_SECOND = 1.2;

/** Walking (`walk`) or standing (`stop`) for a number of seconds, sampled every 5 s. */
type Leg =
  | { readonly kind: 'walk'; readonly seconds: number; readonly gradePercent?: number }
  | { readonly kind: 'stop'; readonly seconds: number };

function recordedHike(
  legs: readonly Leg[],
  sourceSegmentIndex = 0,
): RecordedHikePoint[] {
  const points: RecordedHikePoint[] = [];
  let seconds = 0;
  let distance = 0;
  let elevation = 1_000;
  const push = () => {
    points.push({
      coordinate: [44, 42 + distance / METERS_PER_DEGREE_LATITUDE],
      recordedAt: new Date(START_MILLISECONDS + seconds * 1_000).toISOString(),
      elevationMeters: elevation,
      distanceMeters: distance,
      sourceSegmentIndex,
    });
  };
  push();
  for (const leg of legs) {
    for (let step = 0; step < leg.seconds / SAMPLE_SECONDS; step += 1) {
      seconds += SAMPLE_SECONDS;
      if (leg.kind === 'walk') {
        const meters = WALKING_METERS_PER_SECOND * SAMPLE_SECONDS;
        distance += meters;
        elevation += (meters * (leg.gradePercent ?? 0)) / 100;
      }
      push();
    }
  }
  return points;
}

describe('analyzeRecordedHike', () => {
  it('counts a ten-minute stop in the middle as a break', () => {
    const analysis = analyzeRecordedHike(
      recordedHike([
        { kind: 'walk', seconds: 1_800 },
        { kind: 'stop', seconds: 600 },
        { kind: 'walk', seconds: 1_800 },
      ]),
    );

    expect(analysis).not.toBeNull();
    expect(analysis?.totalSeconds).toBe(4_200);
    expect(analysis?.breakSeconds).toBeGreaterThan(540);
    expect(analysis?.breakSeconds).toBeLessThanOrEqual(600);
    expect(analysis?.movingSeconds).toBeGreaterThanOrEqual(3_600);
    expect(analysis?.movingSeconds).toBeLessThan(3_660);
    expect(analysis?.lunchSeconds).toBe(0);
    expect(analysis?.idleSeconds).toBe(0);
    const stepTotal = analysis?.movingStepSeconds.reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(stepTotal).toBe(analysis?.movingSeconds);
  });

  it('counts a half-hour stop in the middle as lunch', () => {
    const analysis = analyzeRecordedHike(
      recordedHike([
        { kind: 'walk', seconds: 3_600 },
        { kind: 'stop', seconds: 1_800 },
        { kind: 'walk', seconds: 3_600 },
      ]),
    );

    expect(analysis?.lunchSeconds).toBeGreaterThan(1_740);
    expect(analysis?.lunchSeconds).toBeLessThanOrEqual(1_800);
    expect(analysis?.breakSeconds).toBe(0);
    expect(analysis?.movingSeconds).toBeLessThan(7_260);
  });

  it('reports standing before the first and after the last movement as idle', () => {
    const analysis = analyzeRecordedHike(
      recordedHike([
        { kind: 'stop', seconds: 300 },
        { kind: 'walk', seconds: 3_600 },
        { kind: 'stop', seconds: 120 },
      ]),
    );

    expect(analysis?.idleSeconds).toBeGreaterThan(360);
    expect(analysis?.idleSeconds).toBeLessThanOrEqual(420);
    expect(analysis?.breakSeconds).toBe(0);
    expect(analysis?.lunchSeconds).toBe(0);
    expect((analysis?.movingSeconds ?? 0) + (analysis?.idleSeconds ?? 0)).toBe(4_020);
  });

  it('needs advancing timestamps', () => {
    const points = recordedHike([{ kind: 'walk', seconds: 600 }]).map(
      ({ recordedAt: _recordedAt, ...point }) => point,
    );

    expect(analyzeRecordedHike(points)).toBeNull();
  });
});

describe('compareGradeBands', () => {
  it('splits distance and moving time by grade band and leaves out short bands', () => {
    const flat = recordedHike([{ kind: 'walk', seconds: 900 }], 0);
    const climbStart = flat.at(-1)?.distanceMeters ?? 0;
    const climb = recordedHike(
      [{ kind: 'walk', seconds: 900, gradePercent: 15 }],
      1,
    ).map((point) => ({ ...point, distanceMeters: point.distanceMeters + climbStart }));
    const descentStart = climb.at(-1)?.distanceMeters ?? 0;
    const shortDescent = recordedHike(
      [{ kind: 'walk', seconds: 60, gradePercent: -15 }],
      2,
    ).map((point) => ({
      ...point,
      distanceMeters: point.distanceMeters + descentStart,
    }));
    const points = [...flat, ...climb, ...shortDescent];
    const recordedSteps = points.map((_, index) => (index === 0 ? 0 : SAMPLE_SECONDS));
    const dayHike = builtInHikingTimePresets.find((preset) => preset.id === 'day-hike');
    if (dayHike === undefined) throw new Error('The day-hike preset is missing.');
    const estimate = estimateHikingTime(points, dayHike.parameters, {
      paceFactor: 1,
      stopFactor: 1,
    });

    const bands = compareGradeBands(
      points,
      recordedSteps,
      estimate.movingElapsedSeconds,
    );

    expect(bands.map((band) => band.band)).toEqual(['flat', 'hard-climb']);
    expect(bands.reduce((sum, band) => sum + band.distanceMeters, 0)).toBeCloseTo(
      2_160,
    );
    expect(bands[0]?.recordedMovingSeconds).toBe(900);
    expect(bands[1]?.recordedMovingSeconds).toBe(900);
    const estimatedInBands = bands.reduce(
      (sum, band) => sum + band.estimatedMovingSeconds,
      0,
    );
    expect(estimatedInBands).toBeLessThan(estimate.movingSeconds);
    expect(bands[1]?.estimatedMovingSeconds).toBeGreaterThan(
      bands[0]?.estimatedMovingSeconds ?? Number.POSITIVE_INFINITY,
    );
  });
});
