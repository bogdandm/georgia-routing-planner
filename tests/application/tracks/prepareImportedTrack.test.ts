import { describe, expect, it } from 'vitest';

import type { ElevationProvider } from '@/application/ports/ElevationProvider';
import { calculateElevationProfile } from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate, TrackSegment } from '@/domain/tracks/gpx';
import { prepareImportedTrack } from '@/application/tracks/prepareImportedTrack';

const signal = new AbortController().signal;

const sourceSegments = [
  {
    points: [
      { coordinate: [44, 42] as const, elevationMeters: 1_000 },
      { coordinate: [44.01, 42.01] as const, elevationMeters: 1_200 },
    ],
  },
];

const earthRadiusMeters = 6_371_008.8;

function equatorCoordinate(distanceMeters: number): TrackCoordinate {
  return [(distanceMeters / earthRadiusMeters) * (180 / Math.PI), 0];
}

function flatDem(meters: number): ElevationProvider {
  return {
    sample: () => Promise.resolve({ status: 'available', meters }),
    sampleMany: (coordinates) =>
      Promise.resolve(
        coordinates.map(() => ({ status: 'available' as const, meters })),
      ),
  };
}

describe('prepareImportedTrack', () => {
  it('resamples a long source leg, filters once, and persists prepared elevations', async () => {
    const provider: ElevationProvider = {
      sample: () => Promise.resolve({ status: 'available', meters: 1_100 }),
      sampleMany: (coordinates) =>
        Promise.resolve(
          coordinates.map((_, index) => ({
            status: 'available' as const,
            meters: 1_000 + Math.min(index, coordinates.length - index) * 2,
          })),
        ),
    };

    const prepared = await prepareImportedTrack(sourceSegments, provider, signal);

    expect(prepared.segments[0]?.points.length).toBeGreaterThan(90);
    expect(
      prepared.segments[0]?.points.every(
        (point) => point.elevationMeters !== undefined,
      ),
    ).toBe(true);
    expect(prepared.metrics.elevationSource).toBe('dem-assisted');
    expect(prepared.profile.points).toHaveLength(
      prepared.segments[0]?.points.length ?? 0,
    );
  });

  it('uses complete source heights without an elevation provider', async () => {
    const prepared = await prepareImportedTrack(sourceSegments, null, signal);

    expect(prepared.segments[0]?.points.length).toBeGreaterThan(90);
    expect(prepared.metrics.elevationSource).toBe('dem-assisted');
  });

  it('interpolates short source legs and valid timestamps', async () => {
    const prepared = await prepareImportedTrack(
      [
        {
          points: [
            {
              coordinate: equatorCoordinate(0),
              elevationMeters: 100,
              recordedAt: '2026-07-30T10:00:00.000Z',
            },
            {
              coordinate: equatorCoordinate(20),
              elevationMeters: 120,
              recordedAt: '2026-07-30T10:01:00.000Z',
            },
          ],
        },
      ],
      null,
      signal,
    );

    expect(prepared.segments[0]?.points[1]).toMatchObject({
      elevationMeters: 110,
      recordedAt: '2026-07-30T10:00:30.000Z',
    });
  });

  it('omits interpolated timestamps when either source timestamp is invalid', async () => {
    const prepared = await prepareImportedTrack(
      [
        {
          points: [
            {
              coordinate: equatorCoordinate(0),
              elevationMeters: 100,
              recordedAt: 'not-a-date',
            },
            {
              coordinate: equatorCoordinate(20),
              elevationMeters: 120,
              recordedAt: '2026-07-30T10:01:00.000Z',
            },
          ],
        },
      ],
      null,
      signal,
    );

    expect(prepared.segments[0]?.points[1]).not.toHaveProperty('recordedAt');
  });

  it('falls back to the neighboring trend when source and DEM spikes disagree', async () => {
    const prepared = await prepareImportedTrack(
      [
        {
          points: [
            { coordinate: equatorCoordinate(0), elevationMeters: 100 },
            { coordinate: equatorCoordinate(10), elevationMeters: 200 },
            { coordinate: equatorCoordinate(20), elevationMeters: 100 },
          ],
        },
      ],
      flatDem(160),
      signal,
    );

    expect(prepared.profile.points[1]?.rawElevationMeters).toBe(100);
  });

  it('explains a repeated-coordinate track as broken geometry', async () => {
    const repeatedCoordinateSegment: TrackSegment = {
      points: [
        { coordinate: [-74.006, 40.7128], elevationMeters: 10 },
        { coordinate: [-74.006, 40.7128], elevationMeters: 10 },
        { coordinate: [-74.006, 40.7128], elevationMeters: 10 },
      ],
    };

    await expect(
      prepareImportedTrack([repeatedCoordinateSegment], null, signal),
    ).rejects.toMatchObject({
      code: 'zero-length-track',
      message:
        'This track is broken: all track points are in one location, so its route length is zero. Choose another file.',
    });
  });

  it('rejects a source segment with no usable elevation data', async () => {
    await expect(
      prepareImportedTrack(
        [
          {
            points: [
              { coordinate: [44, 42] as const },
              { coordinate: [44.01, 42] as const },
            ],
          },
        ],
        null,
        signal,
      ),
    ).rejects.toMatchObject({
      code: 'elevation-unavailable',
    });
  });

  it('rejects source spikes at exactly 30 metres but not below the threshold', async () => {
    const exactSpike = await prepareImportedTrack(
      [
        {
          points: [
            { coordinate: equatorCoordinate(0), elevationMeters: 100 },
            { coordinate: equatorCoordinate(10), elevationMeters: 130 },
            { coordinate: equatorCoordinate(20), elevationMeters: 100 },
          ],
        },
      ],
      flatDem(100),
      signal,
    );
    const belowThreshold = await prepareImportedTrack(
      [
        {
          points: [
            { coordinate: equatorCoordinate(0), elevationMeters: 100 },
            { coordinate: equatorCoordinate(10), elevationMeters: 129 },
            { coordinate: equatorCoordinate(20), elevationMeters: 100 },
          ],
        },
      ],
      flatDem(100),
      signal,
    );

    expect(exactSpike.profile.points[1]?.rawElevationMeters).toBe(100);
    expect(belowThreshold.profile.points[1]?.rawElevationMeters).toBe(129);
  });

  it('interpolates internal DEM gaps and fills unavailable ends', async () => {
    const samples = [
      { status: 'unavailable' as const },
      { status: 'available' as const, meters: 100 },
      { status: 'unavailable' as const },
      { status: 'available' as const, meters: 160 },
      { status: 'unavailable' as const },
      { status: 'unavailable' as const },
    ];
    const provider: ElevationProvider = {
      sample: () => Promise.resolve({ status: 'unavailable' }),
      sampleMany: (coordinates) =>
        Promise.resolve(
          coordinates.map(
            (_, index) => samples[index] ?? { status: 'unavailable' as const },
          ),
        ),
    };
    const prepared = await prepareImportedTrack(
      [
        {
          points: [
            { coordinate: equatorCoordinate(0) },
            { coordinate: equatorCoordinate(50) },
          ],
        },
      ],
      provider,
      signal,
    );

    expect(
      prepared.profile.points.map((point) => Math.round(point.rawElevationMeters)),
    ).toEqual([100, 100, 130, 160, 160, 160]);
  });

  it('accepts 100,000 stations and rejects 100,001 before sampling', async () => {
    const segment = (distanceMeters: number): TrackSegment => ({
      points: [
        { coordinate: equatorCoordinate(0), elevationMeters: 100 },
        { coordinate: equatorCoordinate(distanceMeters), elevationMeters: 200 },
      ],
    });

    const accepted = await prepareImportedTrack([segment(999_990)], null, signal);
    expect(accepted.profile.points).toHaveLength(100_000);
    await expect(
      prepareImportedTrack([segment(1_000_000)], null, signal),
    ).rejects.toMatchObject({ code: 'point-limit-exceeded' });
  });

  it('reopens persisted prepared points with identical analysis', async () => {
    const prepared = await prepareImportedTrack(sourceSegments, flatDem(1_100), signal);
    const reopenedInputs = prepared.segments.map((segment, sourceSegmentIndex) =>
      segment.points.map((point) => ({
        coordinate: point.coordinate,
        ...(point.recordedAt === undefined ? {} : { recordedAt: point.recordedAt }),
        rawElevationMeters: point.elevationMeters ?? 0,
        elevationMeters: point.elevationMeters ?? 0,
        sourceSegmentIndex,
      })),
    );
    const reopened = calculateElevationProfile(reopenedInputs);

    expect(reopened?.points.map((point) => point.elevationMeters)).toEqual(
      prepared.profile.points.map((point) => point.elevationMeters),
    );
    expect(reopened?.segments).toEqual(prepared.profile.segments);
  });

  it('preserves the real endpoint data when the final coordinate repeats', async () => {
    const prepared = await prepareImportedTrack(
      [
        {
          points: [
            {
              coordinate: equatorCoordinate(0),
              elevationMeters: 100,
              recordedAt: '2026-07-30T10:00:00.000Z',
            },
            {
              coordinate: equatorCoordinate(10),
              elevationMeters: 110,
              recordedAt: '2026-07-30T10:01:00.000Z',
            },
            {
              coordinate: equatorCoordinate(10),
              elevationMeters: 120,
              recordedAt: '2026-07-30T10:02:00.000Z',
            },
          ],
        },
      ],
      null,
      signal,
    );

    expect(prepared.segments[0]?.points.at(-1)).toMatchObject({
      elevationMeters: 120,
      recordedAt: '2026-07-30T10:02:00.000Z',
    });
    expect(prepared.metrics.recordedEndAt).toBe('2026-07-30T10:02:00.000Z');
  });
});
