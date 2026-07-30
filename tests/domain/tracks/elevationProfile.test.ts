import { describe, expect, it } from 'vitest';

import {
  calculateElevationProfile,
  DEFAULT_ELEVATION_ANALYSIS_OPTIONS,
  gradeBandForGrade,
  medianFilterElevationSamples,
  type ElevationProfileInputPoint,
} from '@/domain/tracks/elevationProfile';

function profileInputs(
  elevations: readonly number[],
  sourceSegmentIndex = 0,
  intervalMeters = 100,
): readonly ElevationProfileInputPoint[] {
  return elevations.map((elevationMeters, index) => ({
    coordinate: [index * (intervalMeters / 111_195), 0] as const,
    rawElevationMeters: elevationMeters,
    elevationMeters,
    sourceSegmentIndex,
  }));
}

describe('calculateElevationProfile', () => {
  it('preserves filtered elevations, raw elevations, and cumulative distances', () => {
    const profile = calculateElevationProfile([profileInputs([100, 102, 110])]);

    expect(profile?.points.map((point) => point.elevationMeters)).toEqual([100, 102, 110]);
    expect(profile?.points.map((point) => point.rawElevationMeters)).toEqual([100, 102, 110]);
    expect(profile?.points.map((point) => point.sampleIndex)).toEqual([0, 1, 2]);
    expect(profile?.minimumMeters).toBe(100);
    expect(profile?.maximumMeters).toBe(110);
    expect(profile?.algorithmVersion).toBe(2);
  });

  it('does not invent elevation changes across source segment gaps', () => {
    const profile = calculateElevationProfile([
      profileInputs([100, 120], 0),
      profileInputs([500, 510], 1),
    ]);

    expect(profile?.points[1]?.distanceMeters).toBe(profile?.points[2]?.distanceMeters);
    expect(profile?.segments).toHaveLength(2);
  });

  it('returns null when no completed run has two samples', () => {
    expect(calculateElevationProfile([profileInputs([100]).slice(0, 1)])).toBeNull();
  });

  it('filters each interior sample once while preserving its pre-filter value', () => {
    const filtered = medianFilterElevationSamples([
      [
        { coordinate: [0, 0], elevationMeters: 100, sourceSegmentIndex: 0 },
        { coordinate: [0.001, 0], elevationMeters: 1_000, sourceSegmentIndex: 0 },
        { coordinate: [0.002, 0], elevationMeters: 110, sourceSegmentIndex: 0 },
      ],
    ]);

    expect(filtered[0]?.map((point) => [point.rawElevationMeters, point.elevationMeters])).toEqual([
      [100, 100],
      [1_000, 110],
      [110, 110],
    ]);
  });

  it('keeps a short negative local grade inside one macro climb', () => {
    const profile = calculateElevationProfile(
      [
        profileInputs([
          0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 90, 80, 110, 120, 130, 140, 150,
          160, 170, 180,
        ]),
      ],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['climb']);
    expect(profile?.segments[0]?.descentMeters).toBe(20);
    expect(profile?.points.some((point) => point.localGradePct < 0)).toBe(true);
  });

  it('splits a confirmed reversal at the recorded high rather than confirmation point', () => {
    const profile = calculateElevationProfile(
      [
        profileInputs([
          0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 88, 76, 65, 75, 85, 95, 105, 115,
        ]),
      ],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments[0]).toMatchObject({
      type: 'climb',
      endSampleIndex: 10,
    });
    expect(profile?.segments[1]?.startSampleIndex).toBe(10);
  });

  it('leaves a run flat until a direction confirms', () => {
    const profile = calculateElevationProfile(
      [profileInputs([0, 5, 10, 15, 20, 25])],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['flat']);
  });

  it('detects the symmetric macro descent', () => {
    const profile = calculateElevationProfile(
      [profileInputs([180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0])],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['descent']);
    expect(profile?.segments[0]?.ascentMeters).toBe(0);
    expect(profile?.segments[0]?.descentMeters).toBe(180);
  });

  it('merges a qualifying short directional interruption', () => {
    const profile = calculateElevationProfile(
      [
        profileInputs([
          0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 90, 80, 70, 80, 90, 100, 110,
          120,
        ]),
      ],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['climb']);
    expect(profile?.segments[0]).toMatchObject({ ascentMeters: 150, descentMeters: 30 });
  });

  it('keeps aggregate statistics on filtered rather than trend elevations', () => {
    const profile = calculateElevationProfile(
      [profileInputs([0, 100, 0])],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 400 },
    );

    expect(profile?.segments[0]).toMatchObject({ ascentMeters: 100, descentMeters: 100 });
    expect(profile?.points[1]?.trendElevationMeters).not.toBe(profile?.points[1]?.elevationMeters);
  });

  it('calculates local grade from a physical 120 metre window', () => {
    const profile = calculateElevationProfile(
      [profileInputs([0, 50, 100])],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.points[1]?.localGradePct).toBeCloseTo(50, 3);
  });
  it('uses exact grade-band thresholds', () => {
    expect(gradeBandForGrade(-10)).toBe('steep-descent');
    expect(gradeBandForGrade(-3)).toBe('flat');
    expect(gradeBandForGrade(3)).toBe('flat');
    expect(gradeBandForGrade(10)).toBe('hard-climb');
    expect(gradeBandForGrade(20)).toBe('steep-climb');
    expect(gradeBandForGrade(30)).toBe('extreme-climb');
  });
});
