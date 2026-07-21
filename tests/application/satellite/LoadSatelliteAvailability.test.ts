import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';

import type {
  SatelliteCatalogGateway,
  SatelliteCatalogQuery,
  SatelliteCatalogRequestContext,
  SatelliteCatalogResult,
} from '@/application/ports/SatelliteCatalogGateway';
import { LoadSatelliteAvailability } from '@/application/satellite/LoadSatelliteAvailability';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { createTestServices } from '@test/helpers/createTestServices';

const footprint: Polygon = {
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

function scene(
  id: string,
  acquiredAt: string,
  cloudCoverPercent: number,
): SatelliteScene {
  return {
    id,
    collection: 'sentinel-2-l2a',
    platform: 'sentinel-2a',
    productLevel: 'L2A',
    acquiredAt,
    cloudCoverPercent,
    footprint,
    tileId: null,
    orbit: null,
    productId: null,
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

function createUseCase(result: SatelliteCatalogResult): LoadSatelliteAvailability {
  const services = createTestServices();
  return new LoadSatelliteAvailability(
    new FakeGateway(result),
    services.sentinelQueryDiagnostics,
    services.logger,
    services.idGenerator,
    services.clock,
  );
}

describe('LoadSatelliteAvailability', () => {
  it('returns deterministic dates with the lowest cloud value per date', async () => {
    const first = scene('one', '2025-07-17T08:00:00.000Z', 23);
    const useCase = createUseCase({
      scenes: [
        first,
        scene('two', '2025-07-17T10:00:00.000Z', 4),
        scene('older', '2025-07-02T08:00:00.000Z', 18),
        first,
      ],
      totalMatched: 4,
    });

    const result = await useCase.execute(
      {
        viewport: {
          bounds: { west: 44.1, south: 42.1, east: 44.9, north: 42.9 },
          center: { longitude: 44.5, latitude: 42.5 },
        },
        month: '2025-07',
        productLevel: 'L2A',
        maxCloudCoverPercent: 25,
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      month: '2025-07',
      totalMatched: 4,
      dates: [
        { date: '2025-07-02', sceneCount: 1, cloudSummaryPercent: 18 },
        { date: '2025-07-17', sceneCount: 2, cloudSummaryPercent: 4 },
      ],
    });
  });

  it('rejects malformed calendar months before contacting result mapping', async () => {
    const useCase = createUseCase({ scenes: [], totalMatched: 0 });

    await expect(
      useCase.execute(
        {
          viewport: {
            bounds: { west: 44, south: 42, east: 45, north: 43 },
            center: { longitude: 44.5, latitude: 42.5 },
          },
          month: '2025-13',
          productLevel: 'L2A',
          maxCloudCoverPercent: 25,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-date' });
  });

  it('classifies cancellation separately from provider failures', async () => {
    const useCase = createUseCase({ scenes: [], totalMatched: 0 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      useCase.execute(
        {
          viewport: {
            bounds: { west: 44, south: 42, east: 45, north: 43 },
            center: { longitude: 44.5, latitude: 42.5 },
          },
          month: '2025-07',
          productLevel: 'L2A',
          maxCloudCoverPercent: 25,
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
