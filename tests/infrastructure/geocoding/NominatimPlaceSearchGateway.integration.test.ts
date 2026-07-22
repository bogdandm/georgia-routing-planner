import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { NominatimPlaceSearchGateway } from '@/infrastructure/geocoding/NominatimPlaceSearchGateway';
import { defaultGeocodingProviderConfiguration } from '@/bootstrap/configuration/GeocodingProviderConfiguration';
import { createTestServices } from '@test/helpers/createTestServices';
import { mswServer } from '@test/setup/mswServer';

describe('NominatimPlaceSearchGateway', () => {
  const bounds = { west: 44.1, south: 42.1, east: 44.9, north: 42.9 } as const;

  it('submits a bounded jsonv2 request and caches identical searches', async () => {
    const services = createTestServices();
    const request = vi.fn();
    mswServer.use(
      http.get(
        defaultGeocodingProviderConfiguration.searchUrl,
        ({ request: input }) => {
          request(new URL(input.url));
          return HttpResponse.json([
            {
              place_id: 42,
              lat: '41.7151',
              lon: '44.8271',
              display_name: 'Tbilisi, Georgia',
              category: 'place',
              type: 'city',
              osm_type: 'relation',
              boundingbox: ['41.6', '41.9', '44.6', '45.0'],
            },
          ]);
        },
      ),
    );
    const gateway = new NominatimPlaceSearchGateway(
      services.httpClient,
      defaultGeocodingProviderConfiguration,
      services.idGenerator,
    );

    await expect(
      gateway.search('Tbilisi', bounds, new AbortController().signal),
    ).resolves.toEqual([
      {
        id: '42',
        label: 'Tbilisi, Georgia',
        coordinate: { latitude: 41.7151, longitude: 44.8271 },
        category: 'place:city',
        kind: 'settlement',
        bounds: { west: 44.6, south: 41.6, east: 45, north: 41.9 },
      },
    ]);
    await gateway.search('tbilisi', bounds, new AbortController().signal);

    expect(request).toHaveBeenCalledOnce();
    const requestedUrl = request.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.searchParams.get('format')).toBe('jsonv2');
    expect(requestedUrl.searchParams.get('limit')).toBe('10');
    expect(requestedUrl.searchParams.get('viewbox')).toBe(
      '44.100000,42.900000,44.900000,42.100000',
    );
    expect(requestedUrl.searchParams.get('bounded')).toBe('1');
    expect(requestedUrl.searchParams.get('layer')).toBe('address,natural,manmade');
  });

  it('performs a cached English reverse lookup for a representative point', async () => {
    const services = createTestServices();
    const request = vi.fn<(url: URL, language: string | null) => void>();
    mswServer.use(
      http.get(
        defaultGeocodingProviderConfiguration.reverseUrl,
        ({ request: input }) => {
          request(new URL(input.url), input.headers.get('Accept-Language'));
          return HttpResponse.json({
            place_id: 84,
            lat: '43.0411',
            lon: '42.7192',
            display_name: 'Koruldi Lakes, Mestia Municipality, Georgia',
            category: 'natural',
            type: 'lake',
            osm_type: 'way',
            boundingbox: ['43.03', '43.05', '42.70', '42.73'],
          });
        },
      ),
    );
    const gateway = new NominatimPlaceSearchGateway(
      services.httpClient,
      defaultGeocodingProviderConfiguration,
      services.idGenerator,
      () => 2_000,
    );

    await expect(
      gateway.reverse(
        { longitude: 42.7192, latitude: 43.0411 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      label: 'Koruldi Lakes, Mestia Municipality, Georgia',
      kind: 'water',
    });
    await gateway.reverse(
      { longitude: 42.7192, latitude: 43.0411 },
      new AbortController().signal,
    );

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]).toBe('en');
    const requestedUrl = request.mock.calls[0]?.[0];
    expect(requestedUrl).toBeInstanceOf(URL);
    if (!(requestedUrl instanceof URL)) return;
    expect(requestedUrl.searchParams.get('lat')).toBe('43.041100');
    expect(requestedUrl.searchParams.get('lon')).toBe('42.719200');
  });

  it('loads and validates nearby named OSM features across POI categories', async () => {
    const services = createTestServices();
    const submittedQuery = vi.fn<(query: string | null) => void>();
    const nearbyUrl = defaultGeocodingProviderConfiguration.nearbyUrl;
    mswServer.use(
      http.post(nearbyUrl, async ({ request }) => {
        const body = new URLSearchParams(await request.text());
        submittedQuery(body.get('data'));
        return HttpResponse.json({
          elements: [
            {
              type: 'node',
              id: 5_873_637_780,
              lat: 42.711212,
              lon: 43.1638654,
              tags: {
                name: 'ყელიდა',
                'name:en': 'Kelida',
                natural: 'saddle',
                mountain_pass: 'yes',
              },
            },
            {
              type: 'way',
              id: 6_217_647_19,
              center: { lat: 42.711078, lon: 43.1533538 },
              tags: { name: 'Chutkharo Lakes', natural: 'water' },
            },
            {
              type: 'relation',
              id: 21_052_018,
              center: { lat: 42.8151579, lon: 42.8457099 },
              tags: { name: 'Lower Svaneti', place: 'region' },
            },
          ],
        });
      }),
    );
    const gateway = new NominatimPlaceSearchGateway(
      services.httpClient,
      defaultGeocodingProviderConfiguration,
      services.idGenerator,
      () => 2_000,
    );

    await expect(
      gateway.nearby(
        { longitude: 43.163426, latitude: 42.71163 },
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      {
        id: 'osm:node/5873637780',
        label: 'Kelida',
        coordinate: { latitude: 42.711212, longitude: 43.1638654 },
        category: 'mountain_pass:yes',
        kind: 'mountain',
        bounds: null,
      },
      {
        id: 'osm:way/621764719',
        label: 'Chutkharo Lakes',
        coordinate: { latitude: 42.711078, longitude: 43.1533538 },
        category: 'natural:water',
        kind: 'water',
        bounds: null,
      },
    ]);

    const query = submittedQuery.mock.calls[0]?.[0];
    expect(query).toContain('around:2000,42.711630,43.163426');
    expect(query).toContain('mountain_pass|natural|amenity|tourism');
  });

  it('rejects malformed provider data with a safe error', async () => {
    const services = createTestServices();
    mswServer.use(
      http.get(defaultGeocodingProviderConfiguration.searchUrl, () =>
        HttpResponse.json([{ place_id: 1, lat: 'private', lon: '44' }]),
      ),
    );
    const gateway = new NominatimPlaceSearchGateway(
      services.httpClient,
      defaultGeocodingProviderConfiguration,
      services.idGenerator,
    );
    await expect(
      gateway.search('fixture', bounds, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('normalizes geographic result categories for presentation filtering', async () => {
    const services = createTestServices();
    mswServer.use(
      http.get(defaultGeocodingProviderConfiguration.searchUrl, () =>
        HttpResponse.json([
          {
            place_id: 1,
            lat: '42.0',
            lon: '44.0',
            display_name: 'Village',
            category: 'place',
            type: 'village',
            osm_type: 'node',
            boundingbox: ['41.9', '42.1', '43.9', '44.1'],
          },
          {
            place_id: 2,
            lat: '42.1',
            lon: '44.1',
            display_name: 'Peak',
            category: 'natural',
            type: 'peak',
            osm_type: 'node',
            boundingbox: ['42.0', '42.2', '44.0', '44.2'],
          },
          {
            place_id: 3,
            lat: '42.2',
            lon: '44.2',
            display_name: 'River',
            category: 'waterway',
            type: 'river',
            osm_type: 'way',
            boundingbox: ['42.1', '42.3', '44.1', '44.3'],
          },
          {
            place_id: 4,
            lat: '42.3',
            lon: '44.3',
            display_name: 'Street',
            category: 'highway',
            type: 'residential',
            osm_type: 'way',
            boundingbox: ['42.2', '42.4', '44.2', '44.4'],
          },
          {
            place_id: 5,
            lat: '42.4',
            lon: '44.4',
            display_name: 'Square',
            category: 'place',
            type: 'square',
            osm_type: 'way',
            boundingbox: ['42.3', '42.5', '44.3', '44.5'],
          },
        ]),
      ),
    );
    const gateway = new NominatimPlaceSearchGateway(
      services.httpClient,
      defaultGeocodingProviderConfiguration,
      services.idGenerator,
    );

    const results = await gateway.search(
      'fixture',
      bounds,
      new AbortController().signal,
    );

    expect(results.map((result) => result.kind)).toEqual([
      'settlement',
      'mountain',
      'water',
      'other',
      'other',
    ]);
  });
});
