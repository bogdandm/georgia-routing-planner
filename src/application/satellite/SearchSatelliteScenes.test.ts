import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';

import type {
  SatelliteCatalogGateway,
  SatelliteCatalogQuery,
  SatelliteCatalogRequestContext,
  SatelliteCatalogResult,
} from '@/application/ports/SatelliteCatalogGateway';
import { SearchSatelliteScenes } from '@/application/satellite/SearchSatelliteScenes';
import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
import { validateSatelliteSearchCriteria } from '@/application/satellite/validateSatelliteSearchCriteria';
import type { SatelliteSearchCriteriaInput } from '@/domain/satellite/SatelliteSearchCriteria';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { createTestServices } from '../../../test/helpers/createTestServices';

const viewport = {
  bounds: { west: 44.1, south: 42.1, east: 44.9, north: 42.9 },
  center: { longitude: 44.5, latitude: 42.5 },
} as const;

const criteria: SatelliteSearchCriteriaInput = {
  viewport,
  startDate: '2025-07-02',
  endDate: '2025-07-17',
  productLevel: 'L2A',
  maxCloudCoverPercent: 25,
};

function footprint(): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [44, 42],
        [45, 42],
        [45, 43],
        [44, 43],
        [44, 42],
      ],
    ],
  };
}

function scene(
  id: string,
  acquiredAt: string,
  productLevel: 'L1C' | 'L2A' = 'L2A',
): SatelliteScene {
  return {
    id,
    collection: productLevel === 'L2A' ? 'sentinel-2-l2a' : 'sentinel-2-l1c',
    platform: 'sentinel-2a',
    productLevel,
    acquiredAt,
    cloudCoverPercent: 12,
    footprint: footprint(),
    tileId: '38TMN',
    orbit: 'R135',
    productId: `${id}.SAFE`,
    thumbnailHref: null,
    visualAsset: { kind: 'unavailable' },
    attribution: 'Copernicus Sentinel data',
  };
}

class FakeGateway implements SatelliteCatalogGateway {
  public constructor(private readonly result: SatelliteCatalogResult) {}

  public search(
    _query: SatelliteCatalogQuery,
    context: SatelliteCatalogRequestContext,
  ): Promise<SatelliteCatalogResult> {
    context.signal.throwIfAborted();
    return Promise.resolve(this.result);
  }
}

function createUseCase(result: SatelliteCatalogResult) {
  const services = createTestServices();
  return {
    services,
    useCase: new SearchSatelliteScenes(
      new FakeGateway(result),
      services.sentinelQueryDiagnostics,
      services.logger,
      services.idGenerator,
      services.clock,
    ),
  };
}

describe('validateSatelliteSearchCriteria', () => {
  it('keeps inclusive UTC date endpoints and product choice', () => {
    const validated = validateSatelliteSearchCriteria({
      ...criteria,
      startDate: '2025-07-17',
      endDate: '2025-07-17',
      productLevel: 'L1C',
    });

    expect(validated).toMatchObject({
      startDate: '2025-07-17',
      endDate: '2025-07-17',
      inclusiveDayCount: 1,
      productLevel: 'L1C',
    });
  });

  it.each([
    [{ ...criteria, startDate: '2025-07-18' }, 'date-range-reversed'],
    [
      { ...criteria, startDate: '2025-01-01', endDate: '2025-03-04' },
      'date-range-too-large',
    ],
    [{ ...criteria, startDate: '2025-02-30' }, 'invalid-date'],
    [{ ...criteria, maxCloudCoverPercent: 101 }, 'invalid-cloud-cover'],
  ] as const)('rejects invalid bounded criteria with code %s', (input, code) => {
    expect(() => validateSatelliteSearchCriteria(input)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('rejects antimeridian and non-finite viewport snapshots', () => {
    expect(() =>
      validateSatelliteSearchCriteria({
        ...criteria,
        viewport: {
          bounds: { west: 170, south: -10, east: -170, north: 10 },
          center: { longitude: 180, latitude: 0 },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-viewport' }));
    expect(() =>
      validateSatelliteSearchCriteria({
        ...criteria,
        viewport: {
          ...viewport,
          bounds: { ...viewport.bounds, west: Number.NaN },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-viewport' }));
  });
});

describe('SearchSatelliteScenes', () => {
  it('deduplicates and groups scenes in stable newest-first order', async () => {
    const older = scene('scene-b', '2025-07-16T09:00:00.000Z');
    const firstNewer = scene('scene-a', '2025-07-17T08:00:00.000Z');
    const secondNewer = scene('scene-c', '2025-07-17T08:00:00.000Z');
    const { services, useCase } = createUseCase({
      scenes: [older, secondNewer, firstNewer, firstNewer],
      totalMatched: 4,
    });

    const result = await useCase.execute(criteria, new AbortController().signal);

    expect(result).toMatchObject({
      sceneCount: 3,
      acquisitionDateCount: 2,
      totalMatched: 4,
    });
    expect(result.groups.map((group) => group.date)).toEqual([
      '2025-07-17',
      '2025-07-16',
    ]);
    expect(result.groups[0]?.scenes.map((match) => match.scene.id)).toEqual([
      'scene-a',
      'scene-c',
    ]);
    expect(services.sentinelQueryDiagnostics.getSnapshot().status).toBe('success');
    expect(JSON.stringify(services.logger.getEvents())).not.toContain('44.1');
  });

  it('rejects a provider result that silently mixes product levels', async () => {
    const { useCase } = createUseCase({
      scenes: [scene('wrong-level', '2025-07-17T08:00:00.000Z', 'L1C')],
      totalMatched: 1,
    });

    await expect(
      useCase.execute(criteria, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'provider-capability' });
  });

  it('turns invalid scene geometry into a safe typed application error', async () => {
    const invalidScene = scene('invalid', '2025-07-17T08:00:00.000Z');
    invalidScene.footprint.coordinates[0] = [
      [44, 42],
      [45, 42],
      [44, 42],
    ];
    const { useCase } = createUseCase({ scenes: [invalidScene], totalMatched: 1 });

    const operation = useCase.execute(criteria, new AbortController().signal);

    await expect(operation).rejects.toBeInstanceOf(SatelliteSearchError);
    await expect(operation).rejects.toMatchObject({
      code: 'invalid-scene-geometry',
    });
  });

  it('requires refinement instead of silently truncating excessive matches', async () => {
    const { useCase } = createUseCase({ scenes: [], totalMatched: 101 });

    await expect(
      useCase.execute(criteria, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'result-limit-exceeded' });
  });

  it('classifies cancellation separately and leaves no exact viewport in diagnostics', async () => {
    const { services, useCase } = createUseCase({ scenes: [], totalMatched: 0 });
    const controller = new AbortController();
    controller.abort();

    await expect(useCase.execute(criteria, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(services.sentinelQueryDiagnostics.getSnapshot().status).toBe('cancelled');
    expect(JSON.stringify(services.logger.getEvents())).not.toContain('44.1');
  });
});
