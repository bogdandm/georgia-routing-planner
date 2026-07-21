import { HttpResponse, delay, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { SatelliteCatalogQuery } from '@/application/ports/SatelliteCatalogGateway';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import { EarthSearchSatelliteCatalogGateway } from '@/infrastructure/stac/EarthSearchSatelliteCatalogGateway';
import availabilityResponse from '@test/fixtures/satellite/availability-response.json';
import malformedResponse from '@test/fixtures/satellite/malformed-response.json';
import searchResponse from '@test/fixtures/satellite/search-response.json';
import { createTestServices } from '@test/helpers/createTestServices';
import { mswServer } from '@test/setup/mswServer';

const searchUrl = 'https://earth-search.example.test/v1/search';

function createQuery(
  productLevel: 'L1C' | 'L2A' = 'L2A',
  maximumItems = 100,
): SatelliteCatalogQuery {
  return {
    criteria: {
      viewport: {
        bounds: { west: 44.1, south: 42.1, east: 44.9, north: 42.9 },
        center: { longitude: 44.5, latitude: 42.5 },
      },
      startDate: '2025-07-02',
      endDate: '2025-07-17',
      productLevel,
      maxCloudCoverPercent: 25,
      inclusiveDayCount: 16,
    },
    maximumItems,
  };
}

function createGateway(maximumPages = 5, requestTimeoutMs = 2_000) {
  const services = createTestServices();
  const configured = services.mapProviderConfiguration;
  expect(configured.status).toBe('valid');
  if (configured.status !== 'valid') {
    throw new Error('Expected valid test provider configuration.');
  }
  const satellite: MapProviderConfiguration['satellite'] = {
    ...configured.value.satellite,
    searchUrl,
    maximumPages,
  };
  return {
    services,
    gateway: new EarthSearchSatelliteCatalogGateway(
      services.httpClient,
      satellite,
      requestTimeoutMs,
      services.sentinelQueryDiagnostics,
      services.logger,
      services.clock,
    ),
  };
}

function beginOperation(services: ReturnType<typeof createTestServices>, id: string) {
  services.sentinelQueryDiagnostics.beginOperation(id);
  return { operationId: id, signal: new AbortController().signal };
}

describe('EarthSearchSatelliteCatalogGateway', () => {
  it('posts bounded L2A criteria and maps validated raw RGB COG bands', async () => {
    const requestBodies: unknown[] = [];
    mswServer.use(
      http.post(searchUrl, async ({ request }) => {
        requestBodies.push(await request.json());
        return HttpResponse.json(searchResponse);
      }),
    );
    const { services, gateway } = createGateway();

    const result = await gateway.search(
      createQuery(),
      beginOperation(services, 'l2a-search'),
    );

    expect(requestBodies).toEqual([
      expect.objectContaining({
        collections: ['sentinel-2-l2a'],
        intersects: { type: 'Point', coordinates: [44.5, 42.5] },
        datetime: '2025-07-02T00:00:00.000Z/2025-07-17T23:59:59.999Z',
        query: { 'eo:cloud_cover': { lte: 25 } },
        limit: 100,
      }),
    ]);
    expect(result).toMatchObject({ totalMatched: 1 });
    expect(result.scenes[0]).toMatchObject({
      id: 'S2A_38TMN_20250731_0_L2A',
      productLevel: 'L2A',
      tileId: '38TMN',
      orbit: 'R135',
      visualAsset: {
        kind: 'sentinel-rgb-cogs',
        itemHref:
          'https://earth-search.example.test/v1/collections/sentinel-2-l2a/items/S2A_38TMN_20250731_0_L2A',
        projectionEpsg: 32638,
      },
    });
    expect(services.sentinelQueryDiagnostics.getSnapshot().steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'query-stac-catalog', status: 'success' }),
        expect.objectContaining({ id: 'fetch-result-pages', status: 'success' }),
        expect.objectContaining({ id: 'validate-stac-json', status: 'success' }),
        expect.objectContaining({ id: 'map-scene-metadata', status: 'success' }),
      ]),
    );
  });

  it('keeps L1C distinct and maps its public S3 object to an unsupported HTTPS JP2 asset', async () => {
    mswServer.use(http.post(searchUrl, () => HttpResponse.json(availabilityResponse)));
    const { services, gateway } = createGateway();

    const result = await gateway.search(
      createQuery('L1C'),
      beginOperation(services, 'l1c-search'),
    );

    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]).toMatchObject({
      productLevel: 'L1C',
      thumbnailHref: null,
      visualAsset: {
        kind: 'unsupported-jp2',
        href: 'https://sentinel-s2-l1c.s3.amazonaws.com/tiles/38/T/MN/2025/7/17/0/TCI.jp2',
      },
    });
    expect(result.scenes[1]).toMatchObject({
      tileId: null,
      orbit: null,
      productId: null,
      thumbnailHref: null,
    });
  });

  it('returns an intentional empty catalog result', async () => {
    mswServer.use(
      http.post(searchUrl, () =>
        HttpResponse.json({
          type: 'FeatureCollection',
          context: { matched: 0, returned: 0, limit: 100 },
          features: [],
          links: [],
        }),
      ),
    );
    const { services, gateway } = createGateway();

    await expect(
      gateway.search(createQuery(), beginOperation(services, 'empty-search')),
    ).resolves.toEqual({ scenes: [], totalMatched: 0 });
  });

  it('follows one validated same-origin POST pagination token', async () => {
    let requestCount = 0;
    const secondPage = structuredClone(searchResponse);
    const secondPageFeature = secondPage.features[0];
    if (secondPageFeature === undefined) {
      throw new Error('Expected a synthetic second-page feature.');
    }
    secondPageFeature.id = 'S2B_38TMN_20250716_0_L2A';
    secondPage.context = { limit: 100, matched: 2, returned: 1 };
    mswServer.use(
      http.post(searchUrl, async ({ request }) => {
        requestCount += 1;
        const body = (await request.json()) as Record<string, unknown>;
        if (requestCount === 1) {
          expect(body).toMatchObject({ limit: 100 });
          return HttpResponse.json({
            ...searchResponse,
            context: { limit: 100, matched: 2, returned: 1 },
            links: [
              {
                rel: 'next',
                href: searchUrl,
                method: 'POST',
                body: { next: 'opaque-page-2' },
              },
            ],
          });
        }
        expect(body).toMatchObject({
          collections: ['sentinel-2-l2a'],
          next: 'opaque-page-2',
        });
        return HttpResponse.json(secondPage);
      }),
    );
    const { services, gateway } = createGateway();

    const result = await gateway.search(
      createQuery('L2A', 1_000),
      beginOperation(services, 'paged-search'),
    );

    expect(requestCount).toBe(2);
    expect(result.totalMatched).toBe(2);
    expect(result.scenes.map((scene) => scene.id)).toEqual([
      'S2A_38TMN_20250731_0_L2A',
      'S2B_38TMN_20250716_0_L2A',
    ]);
  });

  it('does not follow Earth Search next metadata after every matched item was returned', async () => {
    let requestCount = 0;
    mswServer.use(
      http.post(searchUrl, async ({ request }) => {
        requestCount += 1;
        const originalBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          ...searchResponse,
          context: { limit: 100, matched: 1, returned: 1 },
          links: [
            {
              rel: 'next',
              href: searchUrl,
              method: 'POST',
              body: { ...originalBody, next: 'provider-cursor' },
            },
          ],
        });
      }),
    );
    const { services, gateway } = createGateway();

    const result = await gateway.search(
      createQuery(),
      beginOperation(services, 'complete-first-page'),
    );

    expect(requestCount).toBe(1);
    expect(result).toMatchObject({ totalMatched: 1 });
  });

  it.each([
    {
      name: 'malformed response',
      response: () => HttpResponse.json(malformedResponse),
      code: 'provider-invalid-response',
    },
    {
      name: 'rate limit',
      response: () => HttpResponse.json({ detail: 'slow down' }, { status: 429 }),
      code: 'provider-rate-limited',
    },
    {
      name: 'client HTTP failure',
      response: () => HttpResponse.json({ detail: 'bad query' }, { status: 400 }),
      code: 'provider-http',
    },
    {
      name: 'server HTTP failure',
      response: () => HttpResponse.json({ detail: 'unavailable' }, { status: 503 }),
      code: 'provider-http',
    },
    {
      name: 'offline network failure',
      response: () => HttpResponse.error(),
      code: 'provider-network',
    },
  ])('maps $name to a safe typed failure', async ({ response, code }) => {
    mswServer.use(http.post(searchUrl, response));
    const { services, gateway } = createGateway();

    await expect(
      gateway.search(createQuery(), beginOperation(services, `failed-${code}`)),
    ).rejects.toMatchObject({ code });
    expect(JSON.stringify(services.logger.getEvents())).not.toContain('slow down');
    expect(services.sentinelQueryDiagnostics.getSnapshot().status).toBe('error');
  });

  it('rejects the complete page when any item or asset is invalid', async () => {
    const partiallyInvalid = {
      ...structuredClone(searchResponse),
      features: [
        ...structuredClone(searchResponse.features),
        malformedResponse.features[0],
      ],
    };
    mswServer.use(http.post(searchUrl, () => HttpResponse.json(partiallyInvalid)));
    const { services, gateway } = createGateway();

    await expect(
      gateway.search(createQuery(), beginOperation(services, 'partial-invalid')),
    ).rejects.toMatchObject({ code: 'provider-invalid-response' });

    const insecureAsset = structuredClone(searchResponse);
    const insecureFeature = insecureAsset.features[0];
    if (insecureFeature === undefined) {
      throw new Error('Expected a synthetic insecure-asset feature.');
    }
    insecureFeature.assets.red.href =
      'http://sentinel-cogs.example.test/private.tif?token=fake-secret';
    mswServer.use(http.post(searchUrl, () => HttpResponse.json(insecureAsset)));
    services.sentinelQueryDiagnostics.beginOperation('insecure-asset');
    await expect(
      gateway.search(createQuery(), {
        operationId: 'insecure-asset',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'provider-invalid-response' });
    expect(JSON.stringify(services.logger.getEvents())).not.toContain('fake-secret');
  });

  it('enforces the configured page cap before following another token', async () => {
    mswServer.use(
      http.post(searchUrl, () =>
        HttpResponse.json({
          ...searchResponse,
          context: { limit: 100, matched: 2, returned: 1 },
          links: [
            {
              rel: 'next',
              href: searchUrl,
              method: 'POST',
              body: { next: 'page-2' },
            },
          ],
        }),
      ),
    );
    const { services, gateway } = createGateway(1);

    await expect(
      gateway.search(createQuery(), beginOperation(services, 'page-cap')),
    ).rejects.toMatchObject({ code: 'provider-pagination' });
  });

  it('maps a request deadline to a typed timeout without retaining response data', async () => {
    mswServer.use(
      http.post(searchUrl, async () => {
        await delay(100);
        return HttpResponse.json(searchResponse);
      }),
    );
    const { services, gateway } = createGateway(5, 5);

    await expect(
      gateway.search(createQuery(), beginOperation(services, 'timed-out')),
    ).rejects.toMatchObject({ code: 'provider-timeout' });
  });

  it('rejects untrusted pagination without contacting another origin', async () => {
    const untrustedHandler = vi.fn();
    mswServer.use(
      http.post(searchUrl, () =>
        HttpResponse.json({
          ...searchResponse,
          links: [
            {
              rel: 'next',
              href: 'https://attacker.example.test/collect',
              method: 'POST',
              body: { next: 'secret-token' },
            },
          ],
        }),
      ),
      http.post('https://attacker.example.test/collect', untrustedHandler),
    );
    const { services, gateway } = createGateway();

    await expect(
      gateway.search(createQuery(), beginOperation(services, 'untrusted-pagination')),
    ).rejects.toMatchObject({ code: 'provider-pagination' });
    expect(untrustedHandler).not.toHaveBeenCalled();
    expect(JSON.stringify(services.logger.getEvents())).not.toContain('secret-token');
  });

  it('maps a malformed pagination URL to a safe pagination error', async () => {
    mswServer.use(
      http.post(searchUrl, () =>
        HttpResponse.json({
          ...searchResponse,
          links: [
            {
              rel: 'next',
              href: 'not a valid URL',
              method: 'POST',
              body: { next: 'page-2' },
            },
          ],
        }),
      ),
    );
    const { services, gateway } = createGateway();

    await expect(
      gateway.search(createQuery(), beginOperation(services, 'malformed-pagination')),
    ).rejects.toMatchObject({ code: 'provider-pagination' });
  });

  it('classifies a pre-aborted request as cancellation', async () => {
    const { services, gateway } = createGateway();
    services.sentinelQueryDiagnostics.beginOperation('cancelled-catalog');
    const controller = new AbortController();
    controller.abort();

    await expect(
      gateway.search(createQuery(), {
        operationId: 'cancelled-catalog',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(services.sentinelQueryDiagnostics.getSnapshot().status).toBe('cancelled');
  });
});
