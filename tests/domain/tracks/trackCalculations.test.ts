import { describe, expect, it } from 'vitest';

import type { TrackPoint, TrackSegment } from '@/domain/tracks/gpx';
import {
  calculateTrackMetrics,
  findDominantSummit,
  generateEnglishTrackName,
  isLoop,
  pointNearestFraction,
} from '@/domain/tracks/trackCalculations';

function point(
  longitude: number,
  latitude: number,
  elevationMeters?: number,
  recordedAt?: string,
): TrackPoint {
  const result: {
    coordinate: readonly [number, number];
    elevationMeters?: number;
    recordedAt?: string;
  } = { coordinate: [longitude, latitude] };
  if (elevationMeters !== undefined) result.elevationMeters = elevationMeters;
  if (recordedAt !== undefined) result.recordedAt = recordedAt;
  return result;
}

describe('track calculations', () => {
  it('aggregates independent segments without bridging their gap', () => {
    const segments: readonly TrackSegment[] = [
      { points: [point(0, 0, 10), point(0.01, 0, 20)] },
      { points: [point(10, 10, 100), point(10.01, 10, 80)] },
    ];
    const result = calculateTrackMetrics(segments);

    expect(result.distanceMeters).toBeGreaterThan(2_000);
    expect(result.distanceMeters).toBeLessThan(2_300);
    expect(result.ascentMeters).toBe(10);
    expect(result.descentMeters).toBe(20);
    expect(result.minimumElevationMeters).toBe(10);
    expect(result.maximumElevationMeters).toBe(100);
  });

  it('retains recorded duration only for complete ordered timestamps', () => {
    const complete = calculateTrackMetrics([
      {
        points: [
          point(0, 0, undefined, '2026-01-01T00:00:00Z'),
          point(0.01, 0, undefined, '2026-01-01T00:02:00Z'),
        ],
      },
    ]);
    const partial = calculateTrackMetrics([
      { points: [point(0, 0, undefined, '2026-01-01T00:00:00Z'), point(0.01, 0)] },
    ]);
    const reversed = calculateTrackMetrics([
      {
        points: [
          point(0, 0, undefined, '2026-01-01T00:02:00Z'),
          point(0.01, 0, undefined, '2026-01-01T00:00:00Z'),
        ],
      },
    ]);
    expect(complete.elapsedSeconds).toBe(120);
    expect(partial.elapsedSeconds).toBeUndefined();
    expect(reversed.elapsedSeconds).toBeUndefined();
  });

  it('rejects missing geometry for metrics and representative points', () => {
    expect(() => calculateTrackMetrics([])).toThrow(
      'Track metrics require at least one non-empty segment.',
    );
    expect(() => pointNearestFraction([], 0.5)).toThrow(
      'Representative point requires geometry.',
    );
  });

  it('produces antimeridian-aware bounds', () => {
    const result = calculateTrackMetrics([
      { points: [point(179, 10), point(-179, 12)] },
    ]);
    expect(result.bounds).toEqual({
      west: 179,
      south: 10,
      east: -179,
      north: 12,
      crossesAntimeridian: true,
    });
    expect(result.center[0]).toBe(180);
  });

  it('finds only a clearly dominant interior summit', () => {
    const summitTrack = [
      point(0, 0, 1_000),
      point(0.01, 0, 1_050),
      point(0.02, 0, 1_220),
      point(0.03, 0, 1_040),
      point(0.04, 0, 1_000),
    ];
    expect(findDominantSummit(summitTrack)?.elevationMeters).toBe(1_220);
    expect(
      findDominantSummit(
        summitTrack.map((item) => ({ ...item, elevationMeters: 1_000 })),
      ),
    ).toBeNull();
    expect(
      findDominantSummit([
        point(0, 0, 1_000),
        point(0.01, 0, 1_180),
        point(0.02, 0, 1_170),
        point(0.03, 0, 1_000),
      ]),
    ).toBeNull();
  });

  it('uses cumulative distance for representative points and loop detection', () => {
    const points = [point(0, 0), point(0.001, 0), point(0.01, 0), point(0, 0)];
    expect(pointNearestFraction(points, 0.5).coordinate).toEqual([0.01, 0]);
    expect(
      isLoop([{ points }], calculateTrackMetrics([{ points }]).distanceMeters),
    ).toBe(true);
  });

  it('generates deterministic English names without implying continuity for multiple segments', () => {
    const candidate = (label: string) => ({
      label,
      kind: 'place',
      matchedCoordinate: [0, 0] as const,
      lookedUpAt: '2026-01-01T00:00:00.000Z',
    });
    expect(
      generateEnglishTrackName({
        loop: false,
        multipleSegments: false,
        startPoi: candidate('Mestia'),
        middlePoi: candidate('Koruldi Lakes'),
        endPoi: candidate('Ushguli'),
      }),
    ).toBe('Koruldi Lakes: Mestia → Ushguli');
    expect(
      generateEnglishTrackName({
        loop: false,
        multipleSegments: true,
        fallbackPoi: candidate('Svaneti'),
      }),
    ).toBe('Svaneti');
    expect(
      generateEnglishTrackName({
        loop: false,
        multipleSegments: false,
        startPoi: candidate('Mestia'),
        middlePoi: candidate('mestia'),
        endPoi: candidate('Ushguli'),
      }),
    ).toBe('Mestia → Ushguli');
    expect(
      generateEnglishTrackName({
        loop: true,
        multipleSegments: false,
        middlePoi: candidate('  Koruldi Lakes  '),
      }),
    ).toBe('Koruldi Lakes');
    expect(
      generateEnglishTrackName({ loop: false, multipleSegments: false }),
    ).toBeNull();
  });
});
