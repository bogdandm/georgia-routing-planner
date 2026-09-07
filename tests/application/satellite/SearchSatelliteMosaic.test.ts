import type { Polygon } from 'geojson';
import { describe, expect, it, vi } from 'vitest';

import { SearchSatelliteMosaic } from '@/application/satellite/SearchSatelliteMosaic';
import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
import type { SatelliteSearchCriteriaInput } from '@/domain/satellite/SatelliteSearchCriteria';
import type {
  SatelliteAcquisitionGroup,
  SatelliteSearchResult,
} from '@/domain/satellite/SatelliteSearchResult';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { createTestServices } from '@test/helpers/createTestServices';

const viewport = {
  bounds: { west: 0, south: 0, east: 2, north: 2 },
  center: { longitude: 1, latitude: 1 },
} as const;
const emptyResult: SatelliteSearchResult = {
  groups: [],
  sceneCount: 0,
  acquisitionDateCount: 0,
  totalMatched: 0,
};

function rectangle(west: number, south: number, east: number, north: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

function scene(id: string, acquiredAt: string, footprint: Polygon): SatelliteScene {
  return {
    id,
    collection: 'sentinel-2-l2a',
    platform: 'sentinel-2a',
    productLevel: 'L2A',
    acquiredAt,
    cloudCoverPercent: 0,
    footprint,
    tileId: null,
    orbit: null,
    productId: null,
    thumbnailHref: null,
    visualAsset: { kind: 'unavailable' },
    attribution: 'Copernicus Sentinel data',
  };
}

function resultFor(
  date: string,
  scenes: readonly SatelliteScene[],
): SatelliteSearchResult {
  const groups: readonly SatelliteAcquisitionGroup[] = [
    {
      date,
      scenes: scenes.map((value) => ({
        scene: value,
        coverage: {
          viewportCoveragePercent: 0,
          interestPointRelation: 'outside',
          distanceToSceneEdgeKm: 0,
          hasEdgeWarning: false,
        },
      })),
    },
  ];
  return {
    groups,
    sceneCount: scenes.length,
    acquisitionDateCount: 1,
    totalMatched: scenes.length,
  };
}

function createUseCase() {
  const services = createTestServices();
  const searchScenes = services.searchSatelliteScenes;
  if (searchScenes === null) throw new Error('Expected configured satellite search.');
  return { searchScenes, useCase: new SearchSatelliteMosaic(searchScenes) };
}

describe('SearchSatelliteMosaic', () => {
  it('queries the selected partial month then complete preceding months without clouds', async () => {
    const { searchScenes, useCase } = createUseCase();
    const full = scene('full', '2026-06-20T10:00:00.000Z', rectangle(0, 0, 2, 2));
    const executeViewport = vi
      .spyOn(searchScenes, 'executeViewport')
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(resultFor('2026-06-20', [full]));

    const result = await useCase.execute(
      { viewport, selectedDate: '2026-07-17', productLevel: 'L2A' },
      new AbortController().signal,
    );

    expect(executeViewport.mock.calls.map(([input]) => input)).toEqual([
      {
        viewport,
        startDate: '2026-07-01',
        endDate: '2026-07-17',
        productLevel: 'L2A',
        maxCloudCoverPercent: null,
      },
      {
        viewport,
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        productLevel: 'L2A',
        maxCloudCoverPercent: null,
      },
    ] satisfies SatelliteSearchCriteriaInput[]);
    expect(result).toMatchObject({
      scenes: [full],
      coveragePercent: 100,
      oldestAcquisitionDate: '2026-06-20',
      archiveExhausted: false,
    });
  });

  it('stops without another request after a complete selected-month group', async () => {
    const { searchScenes, useCase } = createUseCase();
    const full = scene('full', '2026-07-15T10:00:00.000Z', rectangle(0, 0, 2, 2));
    const executeViewport = vi
      .spyOn(searchScenes, 'executeViewport')
      .mockResolvedValue(resultFor('2026-07-15', [full]));

    await useCase.execute(
      { viewport, selectedDate: '2026-07-17', productLevel: 'L2A' },
      new AbortController().signal,
    );

    expect(executeViewport).toHaveBeenCalledOnce();
  });

  it('continues after an empty selected date and reports a completely traversed archive', async () => {
    const { searchScenes, useCase } = createUseCase();
    const executeViewport = vi
      .spyOn(searchScenes, 'executeViewport')
      .mockResolvedValue(emptyResult);

    const result = await useCase.execute(
      { viewport, selectedDate: '2015-07-02', productLevel: 'L2A' },
      new AbortController().signal,
    );

    expect(
      executeViewport.mock.calls.map(([input]) => [input.startDate, input.endDate]),
    ).toEqual([
      ['2015-07-01', '2015-07-02'],
      ['2015-06-23', '2015-06-30'],
    ]);
    expect(result).toEqual({
      scenes: [],
      coveragePercent: 0,
      oldestAcquisitionDate: null,
      archiveExhausted: true,
    });
  });

  it('reports archive exhaustion when the final archive month completes coverage', async () => {
    const { searchScenes, useCase } = createUseCase();
    const full = scene(
      'archive-full',
      '2015-06-24T10:00:00.000Z',
      rectangle(0, 0, 2, 2),
    );
    vi.spyOn(searchScenes, 'executeViewport').mockResolvedValue(
      resultFor('2015-06-24', [full]),
    );

    const result = await useCase.execute(
      { viewport, selectedDate: '2015-06-30', productLevel: 'L2A' },
      new AbortController().signal,
    );

    expect(result.archiveExhausted).toBe(true);
  });

  it('preserves cancellation before catalog work begins', async () => {
    const { searchScenes, useCase } = createUseCase();
    const executeViewport = vi.spyOn(searchScenes, 'executeViewport');
    const controller = new AbortController();
    controller.abort();

    await expect(
      useCase.execute(
        { viewport, selectedDate: '2026-07-17', productLevel: 'L2A' },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(executeViewport).not.toHaveBeenCalled();
  });

  it.each([
    'provider-timeout',
    'provider-pagination',
    'result-limit-exceeded',
  ] as const)('preserves the safe %s search error', async (code) => {
    const { searchScenes, useCase } = createUseCase();
    vi.spyOn(searchScenes, 'executeViewport').mockRejectedValue(
      new SatelliteSearchError(code, 'Safe catalog failure.'),
    );

    await expect(
      useCase.execute(
        { viewport, selectedDate: '2026-07-17', productLevel: 'L2A' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code, message: 'Safe catalog failure.' });
  });

  it('maps malformed provider geometry to the existing safe search error', async () => {
    const { searchScenes, useCase } = createUseCase();
    const invalid = scene('invalid', '2026-07-15T10:00:00.000Z', {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    });
    vi.spyOn(searchScenes, 'executeViewport').mockResolvedValue(
      resultFor('2026-07-15', [invalid]),
    );

    await expect(
      useCase.execute(
        { viewport, selectedDate: '2026-07-17', productLevel: 'L2A' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-scene-geometry' });
  });
});
