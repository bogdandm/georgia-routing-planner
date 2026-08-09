import { describe, expect, it } from 'vitest';

import {
  calculateElevationProfile,
  DEFAULT_ELEVATION_ANALYSIS_OPTIONS,
  elevationSegmentIndexForSample,
  gradeBandForGrade,
  filterDemElevationSamples,
  sampleElevationProfilePoints,
  GRADE_BANDS_ASCENDING,
  GRADE_BAND_THRESHOLDS_PCT,
  medianFilterElevationSamples,
  type ElevationProfile,
  type ElevationProfileInputPoint,
} from '@/domain/tracks/elevationProfile';

function demInputs(
  elevations: readonly number[],
  intervalMeters = 50,
  sourceSegmentIndex = 0,
) {
  return elevations.map((elevationMeters, index) => ({
    coordinate: [index * (intervalMeters / 111_195), 0] as const,
    elevationMeters,
    sourceSegmentIndex,
  }));
}

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

    expect(profile?.points.map((point) => point.elevationMeters)).toEqual([
      100, 102, 110,
    ]);
    expect(profile?.points.map((point) => point.rawElevationMeters)).toEqual([
      100, 102, 110,
    ]);
    expect(profile?.points.map((point) => point.sampleIndex)).toEqual([0, 1, 2]);
    expect(profile?.minimumMeters).toBe(100);
    expect(profile?.maximumMeters).toBe(110);
    expect(profile?.algorithmVersion).toBe(3);
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
        {
          coordinate: [0.001, 0],
          elevationMeters: 1_000,
          recordedAt: '2026-07-30T10:00:00.000Z',
          sourceSegmentIndex: 0,
        },
        { coordinate: [0.002, 0], elevationMeters: 110, sourceSegmentIndex: 0 },
      ],
    ]);

    expect(
      filtered[0]?.map((point) => [point.rawElevationMeters, point.elevationMeters]),
    ).toEqual([
      [100, 100],
      [1_000, 110],
      [110, 110],
    ]);
    expect(filtered[0]?.[1]?.recordedAt).toBe('2026-07-30T10:00:00.000Z');
  });

  describe('filterDemElevationSamples', () => {
    it('keeps a flat profile flat', () => {
      const filtered = filterDemElevationSamples([
        demInputs([100, 100, 100, 100, 100]),
      ]);

      expect(filtered[0]?.map((point) => point.elevationMeters)).toEqual([
        100, 100, 100, 100, 100,
      ]);
    });

    it('retains linear-climb endpoints and net rise', () => {
      const filtered = filterDemElevationSamples([demInputs([0, 25, 50, 75, 100])]);
      const elevations = filtered[0]?.map((point) => point.elevationMeters) ?? [];

      expect(elevations[0]).toBe(0);
      expect(elevations.at(-1)).toBe(100);
      expect((elevations.at(-1) ?? 0) - (elevations[0] ?? 0)).toBe(100);
      expect(elevations[2]).toBeCloseTo(50, 8);
    });

    it('removes a one-point spike before moving-average smoothing', () => {
      const filtered = filterDemElevationSamples([demInputs([0, 0, 100, 0, 0])]);

      expect(filtered[0]?.map((point) => point.elevationMeters)).toEqual([
        0, 0, 0, 0, 0,
      ]);
    });

    it('weights uneven point spacing by metres rather than sample count', () => {
      const positionsMeters = [0, 10, 20, 120, 220];
      const elevations = [0, 0, 100, 100, 100];
      const filtered = filterDemElevationSamples([
        positionsMeters.map((distanceMeters, index) => ({
          coordinate: [distanceMeters / 111_195, 0] as const,
          elevationMeters: elevations[index] ?? 0,
          sourceSegmentIndex: 0,
        })),
      ]);

      expect(filtered[0]?.[2]?.elevationMeters).toBeCloseTo(62.5, 1);
    });

    it('keeps duplicate coordinates finite', () => {
      const filtered = filterDemElevationSamples([
        [
          { coordinate: [0, 0], elevationMeters: 0, sourceSegmentIndex: 0 },
          { coordinate: [0.001, 0], elevationMeters: 10, sourceSegmentIndex: 0 },
          { coordinate: [0.001, 0], elevationMeters: 20, sourceSegmentIndex: 0 },
          { coordinate: [0.001, 0], elevationMeters: 30, sourceSegmentIndex: 0 },
          { coordinate: [0.002, 0], elevationMeters: 40, sourceSegmentIndex: 0 },
        ],
      ]);

      expect(
        filtered[0]?.every((point) => Number.isFinite(point.elevationMeters)),
      ).toBe(true);
    });

    it('never shares a smoothing window across source segments', () => {
      const filtered = filterDemElevationSamples([
        demInputs([0, 0, 0], 50, 0),
        demInputs([1_000, 1_000, 1_000], 50, 1),
      ]);

      expect(filtered[0]?.map((point) => point.elevationMeters)).toEqual([0, 0, 0]);
      expect(filtered[1]?.map((point) => point.elevationMeters)).toEqual([
        1_000, 1_000, 1_000,
      ]);
    });
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
    const profile = calculateElevationProfile([profileInputs([0, 5, 10, 15, 20, 25])], {
      ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS,
      trendWindowM: 0,
    });

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['flat']);
  });

  it('detects the symmetric macro descent', () => {
    const profile = calculateElevationProfile(
      [
        profileInputs([
          180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20,
          10, 0,
        ]),
      ],
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
          0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 90, 80, 70, 80, 90, 100, 110, 120,
        ]),
      ],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['climb']);
    expect(profile?.segments[0]).toMatchObject({
      ascentMeters: 150,
      descentMeters: 30,
    });
  });

  it('merges the symmetric short climb interruption into a descent', () => {
    const profile = calculateElevationProfile(
      [
        profileInputs([
          180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 90, 100, 110, 100, 90,
          80, 70, 60, 50, 40, 30, 20, 10, 0,
        ]),
      ],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['descent']);
    expect(profile?.segments[0]).toMatchObject({
      ascentMeters: 30,
      descentMeters: 210,
    });
  });

  it('absorbs an unqualified terminal reversal into the preceding climb', () => {
    const profile = calculateElevationProfile(
      [profileInputs([0, 25, 50, 75, 100, 125, 150, 140, 130, 120])],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['climb']);
    expect(profile?.segments[0]).toMatchObject({
      ascentMeters: 150,
      descentMeters: 30,
    });
  });

  it('absorbs an unqualified reversal between neighboring climbs', () => {
    const profile = calculateElevationProfile(
      [
        profileInputs([
          0, 20, 40, 60, 80, 100, 120, 112.5, 105, 97.5, 90, 110, 130, 150, 170, 190,
          210,
        ]),
      ],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['climb']);
    expect(profile?.segments[0]).toMatchObject({
      ascentMeters: 240,
      descentMeters: 30,
    });
  });

  it('keeps aggregate statistics on filtered rather than trend elevations', () => {
    const profile = calculateElevationProfile([profileInputs([0, 100, 0])], {
      ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS,
      trendWindowM: 400,
    });

    expect(profile?.segments[0]).toMatchObject({
      ascentMeters: 100,
      descentMeters: 100,
    });
    expect(profile?.points[1]?.trendElevationMeters).not.toBe(
      profile?.points[1]?.elevationMeters,
    );
  });

  it('calculates local grade from a physical 120 metre window', () => {
    const profile = calculateElevationProfile([profileInputs([0, 50, 100])], {
      ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS,
      trendWindowM: 0,
    });

    expect(profile?.points[1]?.localGradePct).toBeCloseTo(50, 3);
  });

  it('reports zero local and average grade for repeated profile coordinates', () => {
    const profile = calculateElevationProfile([profileInputs([100, 110], 0, 0)], {
      ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS,
      trendWindowM: 0,
    });

    expect(profile?.points.map((point) => point.localGradePct)).toEqual([0, 0]);
    expect(profile?.segments[0]?.averageGradePct).toBe(0);
  });

  it('merges short local-grade bands without losing route distance', () => {
    const profile = calculateElevationProfile(
      [profileInputs([0, 0, 10, 30, 31, 11, 10, 30, 50])],
      {
        ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS,
        trendWindowM: 0,
        localGradeWindowM: 200,
        minGradeSubsegmentDistanceM: 250,
      },
    );
    const segment = profile?.segments[0];
    expect(segment).toBeDefined();
    expect(
      segment?.gradeSubsegments.reduce(
        (total, gradeSegment) => total + gradeSegment.distanceMeters,
        0,
      ),
    ).toBeCloseTo(segment?.distanceMeters ?? 0, 6);
    expect(
      segment?.gradeSubsegments.every(
        (gradeSegment) => gradeSegment.distanceMeters >= 250,
      ),
    ).toBe(true);
  });

  it('smooths local grade over the trend before chart classification', () => {
    const elevations = Array.from({ length: 31 }, (_, index) =>
      index === 15 ? 100 : 0,
    );
    const profile = calculateElevationProfile([profileInputs(elevations, 0, 10)]);
    const maximumAbsoluteGrade = Math.max(
      ...(profile?.points.map((point) => Math.abs(point.localGradePct)) ?? []),
    );

    expect(maximumAbsoluteGrade).toBeLessThan(11);
  });

  it('keeps neighboring grade values stable without flattening a sustained steep slope', () => {
    const elevations = Array.from({ length: 61 }, (_, index) => {
      const noise = index % 6 === 0 ? 8 : index % 6 === 3 ? -8 : 0;
      return index * 4 + noise;
    });
    const profile = calculateElevationProfile([profileInputs(elevations, 0, 10)]);
    const interiorGrades =
      profile?.points.slice(20, 41).map((point) => point.localGradePct) ?? [];
    const neighboringChanges = interiorGrades
      .slice(1)
      .map((grade, index) => Math.abs(grade - (interiorGrades[index] ?? grade)));

    expect(interiorGrades.every((grade) => grade > 35 && grade < 45)).toBe(true);
    expect(Math.max(...neighboringChanges)).toBeLessThan(2);
  });

  it('retains a sustained negative local grade inside one macro climb', () => {
    const elevations: number[] = [];
    for (let index = 0; index <= 100; index += 1) elevations.push(index * 2);
    for (let index = 1; index <= 30; index += 1) {
      elevations.push(200 - (index * 25) / 30);
    }
    for (let index = 1; index <= 100; index += 1) elevations.push(175 + index * 2);
    const profile = calculateElevationProfile([profileInputs(elevations, 0, 10)]);

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['climb']);
    expect(
      profile?.points.slice(110, 122).some((point) => point.localGradePct < -3),
    ).toBe(true);
  });

  it('keeps a directional segment when distance or vertical movement is significant', () => {
    const longClimb = calculateElevationProfile(
      [profileInputs(Array.from({ length: 12 }, (_, index) => index * 5))],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );
    const tallClimb = calculateElevationProfile(
      [profileInputs([0, 20, 40, 60, 80, 100])],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );
    const shortLowClimb = calculateElevationProfile(
      [profileInputs([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    const longNearFlat = calculateElevationProfile(
      [profileInputs(Array.from({ length: 16 }, (_, index) => index * 0.2))],
      { ...DEFAULT_ELEVATION_ANALYSIS_OPTIONS, trendWindowM: 0 },
    );

    expect(longClimb?.segments.map((segment) => segment.type)).toEqual(['climb']);
    expect(tallClimb?.segments.map((segment) => segment.type)).toEqual(['climb']);
    expect(shortLowClimb?.segments.map((segment) => segment.type)).toEqual(['flat']);
    expect(longNearFlat?.segments.map((segment) => segment.type)).toEqual(['flat']);
  });
  it('uses exact grade-band thresholds', () => {
    expect(gradeBandForGrade(-20)).toBe('extreme-descent');
    expect(gradeBandForGrade(-10)).toBe('steep-descent');
    expect(gradeBandForGrade(-3)).toBe('flat');
    expect(gradeBandForGrade(3)).toBe('flat');
    expect(gradeBandForGrade(10)).toBe('hard-climb');
    expect(gradeBandForGrade(20)).toBe('steep-climb');
    expect(gradeBandForGrade(30)).toBe('extreme-climb');
    expect(GRADE_BANDS_ASCENDING).toHaveLength(GRADE_BAND_THRESHOLDS_PCT.length + 1);
  });

  it('builds whole-track grade coverage independently of flat macro segments', () => {
    const profile = calculateElevationProfile([
      profileInputs(Array.from({ length: 16 }, () => 100)),
    ]);

    expect(profile?.segments.map((segment) => segment.type)).toEqual(['flat']);
    expect(profile?.gradeSubsegments).toHaveLength(1);
    expect(profile?.gradeSubsegments[0]).toEqual(
      expect.objectContaining({
        startSampleIndex: 0,
        endSampleIndex: 15,
        band: 'flat',
      }),
    );
    expect(profile?.gradeSubsegments[0]?.distanceMeters).toBeCloseTo(1_500);
  });

  it('assigns a shared macro boundary to the following segment except at the route end', () => {
    const profile: ElevationProfile = {
      points: [],
      segments: [
        {
          startSampleIndex: 0,
          endSampleIndex: 10,
          startDistanceMeters: 0,
          endDistanceMeters: 100,
          type: 'climb',
          distanceMeters: 100,
          netElevationChangeMeters: 20,
          ascentMeters: 20,
          descentMeters: 0,
          averageGradePct: 20,
          gradeSubsegments: [],
        },
        {
          startSampleIndex: 10,
          endSampleIndex: 20,
          startDistanceMeters: 100,
          endDistanceMeters: 200,
          type: 'descent',
          distanceMeters: 100,
          netElevationChangeMeters: -20,
          ascentMeters: 0,
          descentMeters: 20,
          averageGradePct: -20,
          gradeSubsegments: [],
        },
      ],
      minimumMeters: 0,
      gradeSubsegments: [],
      maximumMeters: 20,
      algorithmVersion: 3,
    };

    expect(elevationSegmentIndexForSample(profile, 9)).toBe(0);
    expect(elevationSegmentIndexForSample(profile, 10)).toBe(1);
    expect(elevationSegmentIndexForSample(profile, 20)).toBe(1);
    expect(elevationSegmentIndexForSample(profile, -1)).toBeNull();
  });

  it('samples optional chart points while retaining profile boundaries', () => {
    const profile = calculateElevationProfile([
      profileInputs(
        Array.from({ length: 2_000 }, (_, index) => index),
        0,
        10,
      ),
    ]);
    expect(profile).not.toBeNull();
    if (profile === null) return;

    const sampled = sampleElevationProfilePoints(profile, 100);
    expect(sampled).toHaveLength(100);
    expect(sampled[0]).toBe(profile.points[0]);
    expect(sampled.at(-1)).toBe(profile.points.at(-1));
  });
});
