import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ElevationProvider } from '@/application/ports/ElevationProvider';
import { prepareImportedTrack } from '@/application/tracks/prepareImportedTrack';
import type { TrackCoordinate, TrackSegment } from '@/domain/tracks/gpx';

const signal = new AbortController().signal;
const earthRadiusMeters = 6_371_008.8;

function equatorCoordinate(distanceMeters: number): TrackCoordinate {
  return [(distanceMeters / earthRadiusMeters) * (180 / Math.PI), 0];
}

function flatDem(meters: number): ElevationProvider {
  return {
    sample: () => Promise.resolve({ status: 'available', meters }),
    sampleMany: (coordinates) =>
      Promise.resolve(
        coordinates.map(() => ({ status: 'available', meters }) as const),
      ),
  };
}

function unavailableDem(): ElevationProvider {
  return {
    sample: () => Promise.resolve({ status: 'unavailable' }),
    sampleMany: (coordinates) =>
      Promise.resolve(coordinates.map(() => ({ status: 'unavailable' }) as const)),
  };
}

function sequenceDem(values: readonly (number | null)[]): ElevationProvider {
  return {
    sample: () => Promise.resolve({ status: 'unavailable' }),
    sampleMany: (coordinates) =>
      Promise.resolve(
        coordinates.map((_, index) => {
          const meters = values[index] ?? null;
          return meters === null
            ? ({ status: 'unavailable' } as const)
            : ({ status: 'available', meters } as const);
        }),
      ),
  };
}

const sourceSegments: readonly TrackSegment[] = [
  {
    points: [
      { coordinate: equatorCoordinate(0), elevationMeters: 1_000 },
      { coordinate: equatorCoordinate(100), elevationMeters: 1_100 },
    ],
  },
];

describe('prepareImportedTrack', () => {
  it('keeps contradictory source and DEM elevations in independent projections', async () => {
    const prepared = await prepareImportedTrack(sourceSegments, flatDem(400), signal);

    expect(prepared.sourceSegments).toBe(sourceSegments);
    expect(prepared.sourceSegments[0]?.points).toEqual(sourceSegments[0]?.points);
    expect(prepared.sourceMetrics.ascentMeters).toBeCloseTo(100, 6);
    expect(prepared.sourceMetrics.elevationSource).toBe('gpx');
    expect(
      prepared.sourceProfile?.points.map((point) => point.elevationMeters),
    ).toEqual([1_000, 1_100]);
    expect(prepared.calculatedSegments?.[0]?.points.length).toBeGreaterThan(10);
    expect(
      prepared.calculatedSegments?.[0]?.points.every(
        (point) => point.elevationMeters === 400,
      ),
    ).toBe(true);
    expect(prepared.calculatedMetrics?.ascentMeters).toBe(0);
    expect(prepared.calculatedMetrics?.descentMeters).toBe(0);
    expect(prepared.calculatedMetrics?.elevationAlgorithmVersion).toBe(4);
  });

  it('interpolates missing DEM samples only from neighboring DEM values', async () => {
    const source: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0), elevationMeters: 1_000 },
          { coordinate: equatorCoordinate(20), elevationMeters: 2_000 },
        ],
      },
    ];
    const prepared = await prepareImportedTrack(
      source,
      sequenceDem([100, null, 200]),
      signal,
    );

    expect(
      prepared.sourceSegments[0]?.points.map((point) => point.elevationMeters),
    ).toEqual([1_000, 2_000]);
    const calculatedElevations =
      prepared.calculatedSegments?.[0]?.points.map((point) => point.elevationMeters) ??
      [];
    expect(calculatedElevations[0]).toBe(100);
    expect(calculatedElevations[1]).toBeCloseTo(150, 6);
    expect(calculatedElevations[2]).toBe(200);
  });

  it('extends the nearest DEM values across unavailable track ends', async () => {
    const source: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0) },
          { coordinate: equatorCoordinate(20) },
        ],
      },
    ];
    const prepared = await prepareImportedTrack(
      source,
      sequenceDem([null, 100, null]),
      signal,
    );

    expect(
      prepared.calculatedSegments?.[0]?.points.map((point) => point.elevationMeters),
    ).toEqual([100, 100, 100]);
  });

  it('returns no calculated projection when DEM is unavailable but source elevation is usable', async () => {
    const prepared = await prepareImportedTrack(
      sourceSegments,
      unavailableDem(),
      signal,
    );

    expect(prepared.sourceProfile).not.toBeNull();
    expect(prepared.calculatedSegments).toBeNull();
    expect(prepared.calculatedProfile).toBeNull();
    expect(prepared.calculatedMetrics).toBeNull();
  });

  it('returns the source projection without sampling when no provider is configured', async () => {
    const prepared = await prepareImportedTrack(sourceSegments, null, signal);

    expect(prepared.sourceSegments).toBe(sourceSegments);
    expect(prepared.sourceMetrics.elevationAlgorithmVersion).toBe(3);
    expect(prepared.calculatedSegments).toBeNull();
  });

  it('provides a calculated profile when source elevation is absent', async () => {
    const source: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0) },
          { coordinate: equatorCoordinate(100) },
        ],
      },
    ];
    const prepared = await prepareImportedTrack(source, flatDem(700), signal);

    expect(prepared.sourceProfile).toBeNull();
    expect(prepared.sourceMetrics.ascentMeters).toBeUndefined();
    expect(prepared.sourceMetrics.descentMeters).toBeUndefined();
    expect(prepared.calculatedProfile).not.toBeNull();
    expect(prepared.calculatedMetrics?.elevationAlgorithmVersion).toBe(4);
  });

  it('throws elevation-unavailable only when neither projection has a usable run', async () => {
    const source: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0) },
          { coordinate: equatorCoordinate(20) },
        ],
      },
    ];

    await expect(
      prepareImportedTrack(source, unavailableDem(), signal),
    ).rejects.toMatchObject({ code: 'elevation-unavailable' });
    await expect(prepareImportedTrack(source, null, signal)).rejects.toMatchObject({
      code: 'elevation-unavailable',
    });
  });

  it('rejects calculated projections above the persisted point limit', async () => {
    const source: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0) },
          { coordinate: equatorCoordinate(1_000_020) },
        ],
      },
    ];

    await expect(
      prepareImportedTrack(source, flatDem(200), signal),
    ).rejects.toMatchObject({ code: 'point-limit-exceeded' });
  });

  it('keeps calculated totals within one percent on clean major terrain', async () => {
    const source: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0) },
          { coordinate: equatorCoordinate(1_000) },
        ],
      },
    ];
    const provider: ElevationProvider = {
      sample: () => Promise.resolve({ status: 'unavailable' }),
      sampleMany: (coordinates) =>
        Promise.resolve(
          coordinates.map(({ longitude }) => {
            const distanceMeters = longitude * (Math.PI / 180) * earthRadiusMeters;
            const meters =
              distanceMeters <= 400
                ? distanceMeters * 2.5
                : distanceMeters <= 600
                  ? 1_000
                  : 1_000 - (distanceMeters - 600) * 2;
            return { status: 'available' as const, meters };
          }),
        ),
    };
    const prepared = await prepareImportedTrack(source, provider, signal);

    const ascentMeters = prepared.calculatedMetrics?.ascentMeters ?? 0;
    const descentMeters = prepared.calculatedMetrics?.descentMeters ?? 0;
    expect(Math.abs(ascentMeters - 1_000) / 1_000).toBeLessThanOrEqual(0.01);
    expect(Math.abs(descentMeters - 800) / 800).toBeLessThanOrEqual(0.01);
  });

  it('keeps captured Svaneti Terrarium totals within the measured terrain range', async () => {
    const samplesJson = await readFile(
      join(
        process.cwd(),
        'tests',
        'fixtures',
        'elevation',
        'svaneti-loop-4-terrarium.json',
      ),
      'utf8',
    );
    const samples = JSON.parse(samplesJson) as readonly (number | null)[];
    const syntheticSource: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0) },
          { coordinate: equatorCoordinate((samples.length - 1) * 10) },
        ],
      },
    ];

    const prepared = await prepareImportedTrack(
      syntheticSource,
      sequenceDem(samples),
      signal,
    );

    expect(
      prepared.calculatedSegments?.reduce(
        (count, segment) => count + segment.points.length,
        0,
      ),
    ).toBe(samples.length);
    expect(prepared.calculatedMetrics?.ascentMeters).toBeGreaterThanOrEqual(1_800);
    expect(prepared.calculatedMetrics?.ascentMeters).toBeLessThanOrEqual(2_200);
    expect(prepared.calculatedMetrics?.descentMeters).toBeGreaterThanOrEqual(3_000);
    expect(prepared.calculatedMetrics?.descentMeters).toBeLessThanOrEqual(3_400);
    expect(prepared.calculatedMetrics?.elevationAlgorithmVersion).toBe(4);
    expect(prepared.sourceMetrics.ascentMeters).toBeUndefined();
    expect(prepared.sourceMetrics.descentMeters).toBeUndefined();
  }, 30_000);

  it('publishes progress from arriving DEM samples without source fallback', async () => {
    const progress: (readonly (number | null)[])[] = [];

    const provider: ElevationProvider = {
      sample: () => Promise.resolve({ status: 'available', meters: 200 }),
      sampleMany: (coordinates, _signal, onProgress) => {
        onProgress?.({
          completedTiles: 0,
          totalTiles: 2,
          indices: [],
          samples: [],
        });
        onProgress?.({
          completedTiles: 1,
          totalTiles: 2,
          indices: [1],
          samples: [{ status: 'available', meters: 250 }],
        });
        onProgress?.({
          completedTiles: 2,
          totalTiles: 2,
          indices: [0, 2],
          samples: [
            { status: 'available', meters: 200 },
            { status: 'available', meters: 300 },
          ],
        });
        return Promise.resolve(
          coordinates.map((_, index) => ({
            status: 'available' as const,
            meters: [200, 250, 300][index] ?? 300,
          })),
        );
      },
    };

    await prepareImportedTrack(
      [
        {
          points: [
            { coordinate: equatorCoordinate(0), elevationMeters: 1_000 },
            { coordinate: equatorCoordinate(20), elevationMeters: 2_000 },
          ],
        },
      ],
      provider,
      signal,
      {
        onProgress: (event) => {
          progress.push(event.points.map((point) => point.elevationMeters));
        },
      },
    );

    expect(progress).toEqual([
      [null, null, null],
      [null, 250, null],
      [200, 250, 300],
    ]);
  });

  it('bounds long-track progress while accepting updates outside the preview', async () => {
    let publishedPointCount = 0;
    let publishedElevationCount = 0;
    const provider: ElevationProvider = {
      sample: () => Promise.resolve({ status: 'available', meters: 200 }),
      sampleMany: (coordinates, _signal, onProgress) => {
        onProgress?.({
          completedTiles: 1,
          totalTiles: 1,
          indices: [6, coordinates.length - 1],
          samples: [
            { status: 'available', meters: 100 },
            { status: 'available', meters: 200 },
          ],
        });
        return Promise.resolve(
          coordinates.map(() => ({ status: 'available' as const, meters: 200 })),
        );
      },
    };

    await prepareImportedTrack(
      [
        {
          points: [
            { coordinate: equatorCoordinate(0) },
            { coordinate: equatorCoordinate(13_000) },
          ],
        },
      ],
      provider,
      signal,
      {
        onProgress: (progress) => {
          publishedPointCount = progress.points.length;
          publishedElevationCount = progress.points.filter(
            (point) => point.elevationMeters !== null,
          ).length;
        },
      },
    );

    expect(publishedPointCount).toBe(1_200);
    expect(publishedElevationCount).toBe(1);
  });

  it('keeps interpolated timestamps only in the calculated projection', async () => {
    const source: readonly TrackSegment[] = [
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
    ];
    const prepared = await prepareImportedTrack(source, flatDem(300), signal);

    expect(prepared.sourceSegments[0]?.points).toEqual(source[0]?.points);
    expect(prepared.calculatedSegments?.[0]?.points[1]?.recordedAt).toBe(
      '2026-07-30T10:00:30.000Z',
    );
  });

  it('resamples past a repeated interior coordinate without duplicating stations', async () => {
    const source: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0) },
          { coordinate: equatorCoordinate(0) },
          { coordinate: equatorCoordinate(20) },
        ],
      },
    ];

    const prepared = await prepareImportedTrack(source, flatDem(300), signal);

    expect(prepared.calculatedSegments?.[0]?.points).toHaveLength(3);
    expect(prepared.calculatedSegments?.[0]?.points[0]?.coordinate).toEqual(
      equatorCoordinate(0),
    );
    expect(prepared.calculatedSegments?.[0]?.points[2]?.coordinate).toEqual(
      equatorCoordinate(20),
    );
  });

  it('omits interpolated timestamps when a source timestamp is invalid', async () => {
    const source: readonly TrackSegment[] = [
      {
        points: [
          { coordinate: equatorCoordinate(0), recordedAt: 'invalid' },
          {
            coordinate: equatorCoordinate(20),
            recordedAt: '2026-07-30T10:01:00.000Z',
          },
        ],
      },
    ];

    const prepared = await prepareImportedTrack(source, flatDem(300), signal);

    expect(prepared.sourceSegments[0]?.points).toEqual(source[0]?.points);
    expect(prepared.calculatedSegments?.[0]?.points[1]).not.toHaveProperty(
      'recordedAt',
    );
  });

  it('rejects repeated-coordinate geometry before sampling', async () => {
    let sampled = false;
    const provider: ElevationProvider = {
      sample: () => Promise.resolve({ status: 'available', meters: 100 }),
      sampleMany: () => {
        sampled = true;
        return Promise.resolve([]);
      },
    };

    await expect(
      prepareImportedTrack(
        [
          {
            points: [
              { coordinate: [44, 42], elevationMeters: 100 },
              { coordinate: [44, 42], elevationMeters: 110 },
            ],
          },
        ],
        provider,
        signal,
      ),
    ).rejects.toMatchObject({ code: 'zero-length-track' });
    expect(sampled).toBe(false);
  });
});
