import { describe, expect, it } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  loadMapProviderConfiguration,
  parseMapProviderConfiguration,
  summarizeMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';

const baseUrl = 'https://example.test/georgia-routing-planner/';

describe('MapProviderConfiguration', () => {
  it('parses the production-shaped configuration and exposes a safe summary', () => {
    const configuration = parseMapProviderConfiguration(
      defaultMapProviderConfigurationInput,
      baseUrl,
    );

    expect(configuration.vector.sourceLayers.transportation).toBe('transportation');
    expect(configuration.schemaVersion).toBe(2);
    expect(configuration.detailVector).toEqual({
      id: 'osm-shortbread-v1',
      label: 'OSM Shortbread',
      tileJsonUrl: 'https://vector.openstreetmap.org/shortbread_v1/tilejson.json',
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
      sourceLayers: { land: 'land', buildings: 'buildings', streets: 'streets' },
    });
    expect(configuration.terrain).toMatchObject({
      encoding: 'terrarium',
      tileSize: 256,
      minZoom: 0,
      maxZoom: 15,
      filter: {
        spikeThresholdMeters: 500,
        negativeSpikeThresholdMeters: 300,
      },
      overlays: {
        contourMinZoom: 11,
        contourMaxZoom: 15,
        contourCacheSize: 32,
      },
    });
    expect(configuration.satellite).toMatchObject({
      id: 'earth-search-v1',
      collections: { L1C: 'sentinel-2-l1c', L2A: 'sentinel-2-l2a' },
      maximumPages: 10,
      renderer: { maxZoom: 14 },
    });
    expect(configuration.satelliteBasemap).toEqual({
      id: 'google-satellite',
      label: 'Google satellite imagery',
      tileUrls: [
        'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      ],
      tileSize: 256,
      attribution: '<a href="https://www.google.com/maps" target="_blank">© Google</a>',
    });
    expect(configuration.naprOrthophoto).toEqual({
      id: 'napr-orthophoto',
      label: 'NAPR orthophoto mosaic',
      sources: {
        national2016To2017: {
          tileUrls: [
            'https://nt0.napr.gov.ge/NGCache?x={x}&y={y}&z={z}&l=ORTHO_GEORGIA_4',
          ],
          tileSize: 256,
          minZoom: 0,
          maxZoom: 19,
          bounds: [
            39.854887835932935, 40.95043078335194, 46.811064678938735,
            43.68599206966364,
          ],
        },
        westernGeorgia2020: {
          tileUrls: [
            'https://mp.napr.gov.ge/ORTHO_2020_DASAVLETI/wmts/ORTHO_2020_DASAVLETI/GLOBAL_MERCATOR/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          minZoom: 0,
          maxZoom: 19,
          bounds: [
            41.397448792721505, 41.5288960450433, 43.455051840654676,
            42.815072774303644,
          ],
        },
        kutaisi2020: {
          tileUrls: [
            'https://mp.napr.gov.ge/ORTHO_2020_KUTAISI/wmts/ORTHO_2020_KUTAISI/GLOBAL_MERCATOR/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          minZoom: 0,
          maxZoom: 20,
          bounds: [
            42.598257144482105, 42.211097128103006, 42.74659092533837,
            42.29503776969293,
          ],
        },
        racha2025: {
          tileUrls: [
            'https://mp.napr.gov.ge/ORTHO_2025_BLK4/wmts/ORTHO_2025_BLK4/GLOBAL_MERCATOR/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          minZoom: 0,
          maxZoom: 19,
          bounds: [
            41.496791459122655, 41.9954418326647, 43.67097971829147, 43.16476392114931,
          ],
        },
      },
      attribution:
        'Imagery: <a href="https://maps.gov.ge/" target="_blank">National Agency of Public Registry (NAPR), orthophotos 2016–2017, 2020, and 2025</a>',
    });
    expect(summarizeMapProviderConfiguration(configuration)).toEqual({
      schemaVersion: 2,
      vectorId: 'openfreemap-openmaptiles',
      vectorOrigin: 'https://tiles.openfreemap.org',
      detailVectorId: 'osm-shortbread-v1',
      detailVectorOrigin: 'https://vector.openstreetmap.org',
      terrainId: 'aws-mapzen-terrarium',
      terrainOrigin: 'https://s3.amazonaws.com',
      satelliteId: 'earth-search-v1',
      satelliteOrigin: 'https://earth-search.aws.element84.com',
      satelliteRendererId: 'titiler-demo-stac-rgb',
      satelliteRendererOrigin: 'https://titiler.xyz',
      satelliteBasemapId: 'google-satellite',
      satelliteBasemapOrigins: [
        'https://mt0.google.com',
        'https://mt1.google.com',
        'https://mt2.google.com',
        'https://mt3.google.com',
      ],
      naprOrthophotoId: 'napr-orthophoto',
      naprOrthophotoOrigins: ['https://nt0.napr.gov.ge', 'https://mp.napr.gov.ge'],
    });
  });

  it('defaults the downward spike threshold for existing external configuration', () => {
    const input = structuredClone(
      defaultMapProviderConfigurationInput,
    ) as unknown as Record<string, unknown>;
    const terrain = input.terrain as Record<string, unknown>;
    const filter = terrain.filter as Record<string, unknown>;
    delete filter.negativeSpikeThresholdMeters;

    const configuration = parseMapProviderConfiguration(input, baseUrl);

    expect(configuration.terrain.filter.negativeSpikeThresholdMeters).toBe(300);
  });

  it('defaults the satellite basemap for existing external configuration', () => {
    const input = structuredClone(
      defaultMapProviderConfigurationInput,
    ) as unknown as Record<string, unknown>;
    delete input.satelliteBasemap;

    const configuration = parseMapProviderConfiguration(input, baseUrl);

    expect(configuration.satelliteBasemap.tileUrls).toHaveLength(4);
    expect(configuration.satelliteBasemap.id).toBe('google-satellite');
  });

  it('defaults NAPR orthophoto for existing schema-v2 external configuration', () => {
    const input = structuredClone(
      defaultMapProviderConfigurationInput,
    ) as unknown as Record<string, unknown>;
    delete input.naprOrthophoto;

    const configuration = parseMapProviderConfiguration(input, baseUrl);

    expect(configuration.naprOrthophoto.sources.kutaisi2020.maxZoom).toBe(20);
  });

  it('resolves fixture endpoints under a GitHub Pages-style base path', () => {
    const input = structuredClone(defaultMapProviderConfigurationInput) as unknown as {
      vector: {
        tileJsonUrl: string;
        glyphsUrl: string;
      };
      detailVector: { tileJsonUrl: string };
      terrain: { tileUrl: string };
      satellite: { searchUrl: string };
      satelliteBasemap: { tileUrls: string[] };
      naprOrthophoto: {
        sources: Record<string, { tileUrls: string[] }>;
      };
    };
    input.vector.tileJsonUrl = './fixtures/vector/tiles.json';
    input.vector.glyphsUrl = './fixtures/fonts/{fontstack}/{range}.pbf';
    input.detailVector.tileJsonUrl = './fixtures/detail-vector/tilejson.json';
    input.terrain.tileUrl = './fixtures/terrain/{z}/{x}/{y}.png';
    input.satellite.searchUrl = './fixtures/stac/search';
    input.satelliteBasemap.tileUrls = [
      './fixtures/satellite/{z}/{x}/{y}.jpg',
      './fixtures/satellite/{z}/{x}/{y}.jpg',
    ];
    for (const source of Object.values(input.naprOrthophoto.sources)) {
      source.tileUrls = ['./fixtures/napr/{z}/{x}/{y}.png'];
    }

    const configuration = parseMapProviderConfiguration(input, baseUrl);

    expect(configuration.vector.tileJsonUrl).toBe(
      'https://example.test/georgia-routing-planner/fixtures/vector/tiles.json',
    );
    expect(configuration.detailVector.tileJsonUrl).toBe(
      'https://example.test/georgia-routing-planner/fixtures/detail-vector/tilejson.json',
    );
    expect(configuration.terrain.tileUrl).toBe(
      'https://example.test/georgia-routing-planner/fixtures/terrain/{z}/{x}/{y}.png',
    );
    expect(configuration.satellite.searchUrl).toBe(
      'https://example.test/georgia-routing-planner/fixtures/stac/search',
    );
    expect(configuration.satelliteBasemap.tileUrls).toEqual([
      'https://example.test/georgia-routing-planner/fixtures/satellite/{z}/{x}/{y}.jpg',
      'https://example.test/georgia-routing-planner/fixtures/satellite/{z}/{x}/{y}.jpg',
    ]);
    expect(
      Object.values(configuration.naprOrthophoto.sources).map(
        (source) => source.tileUrls,
      ),
    ).toEqual([
      ['https://example.test/georgia-routing-planner/fixtures/napr/{z}/{x}/{y}.png'],
      ['https://example.test/georgia-routing-planner/fixtures/napr/{z}/{x}/{y}.png'],
      ['https://example.test/georgia-routing-planner/fixtures/napr/{z}/{x}/{y}.png'],
      ['https://example.test/georgia-routing-planner/fixtures/napr/{z}/{x}/{y}.png'],
    ]);
  });

  it.each([
    {
      name: 'missing source-layer mapping',
      mutate: (input: Record<string, unknown>) => {
        const vector = input.vector as Record<string, unknown>;
        const sourceLayers = vector.sourceLayers as Record<string, unknown>;
        delete sourceLayers.transportation;
      },
    },
    {
      name: 'missing detail source-layer mapping',
      mutate: (input: Record<string, unknown>) => {
        const detailVector = input.detailVector as Record<string, unknown>;
        const sourceLayers = detailVector.sourceLayers as Record<string, unknown>;
        delete sourceLayers.streets;
      },
    },
    {
      name: 'unsupported DEM encoding',
      mutate: (input: Record<string, unknown>) => {
        const terrain = input.terrain as Record<string, unknown>;
        terrain.encoding = 'raw';
      },
    },
    {
      name: 'invalid tile size',
      mutate: (input: Record<string, unknown>) => {
        const terrain = input.terrain as Record<string, unknown>;
        terrain.tileSize = 300;
      },
    },
    {
      name: 'reversed zoom range',
      mutate: (input: Record<string, unknown>) => {
        const terrain = input.terrain as Record<string, unknown>;
        terrain.minZoom = 15;
        terrain.maxZoom = 3;
      },
    },
    {
      name: 'contours beyond the terrain zoom range',
      mutate: (input: Record<string, unknown>) => {
        const terrain = input.terrain as Record<string, unknown>;
        terrain.overlays = {
          contourMinZoom: 11,
          contourMaxZoom: 16,
          contourCacheSize: 32,
        };
      },
    },
    {
      name: 'duplicate satellite collections',
      mutate: (input: Record<string, unknown>) => {
        const satellite = input.satellite as Record<string, unknown>;
        satellite.collections = { L1C: 'sentinel', L2A: 'sentinel' };
      },
    },
    {
      name: 'insecure endpoint',
      mutate: (input: Record<string, unknown>) => {
        const vector = input.vector as Record<string, unknown>;
        vector.tileJsonUrl = 'http://tiles.example.test/tiles.json';
      },
    },
    ...[
      'javascript:alert(1)',
      'data:text/plain,private',
      'mailto:user@example.com',
    ].map((endpoint) => ({
      name: `unsafe ${endpoint.split(':')[0] ?? 'unknown'} URI`,
      mutate: (input: Record<string, unknown>) => {
        const vector = input.vector as Record<string, unknown>;
        vector.tileJsonUrl = endpoint;
      },
    })),
    {
      name: 'protocol-relative endpoint',
      mutate: (input: Record<string, unknown>) => {
        const vector = input.vector as Record<string, unknown>;
        vector.tileJsonUrl = '//tiles.example.test/tiles.json';
      },
    },
    {
      name: 'insecure satellite endpoint',
      mutate: (input: Record<string, unknown>) => {
        const satellite = input.satellite as Record<string, unknown>;
        satellite.searchUrl = 'http://earth-search.example.test/search';
      },
    },
    {
      name: 'satellite basemap endpoint missing map tokens',
      mutate: (input: Record<string, unknown>) => {
        const satelliteBasemap = input.satelliteBasemap as Record<string, unknown>;
        satelliteBasemap.tileUrls = ['https://tiles.example.test/{z}/{x}/tile.jpg'];
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const input = structuredClone(
      defaultMapProviderConfigurationInput,
    ) as unknown as Record<string, unknown>;
    mutate(input);

    expect(() => parseMapProviderConfiguration(input, baseUrl)).toThrow();
  });

  it.each([
    'national2016To2017',
    'westernGeorgia2020',
    'kutaisi2020',
    'racha2025',
  ] as const)('rejects malformed reusable NAPR source %s', (sourceName) => {
    const invalidMutations = [
      (source: Record<string, unknown>) => {
        source.tileUrls = ['http://tiles.example.test/{z}/{x}/{y}.png'];
      },
      (source: Record<string, unknown>) => {
        source.tileUrls = ['https://tiles.example.test/{z}/{x}/tile.png'];
      },
      (source: Record<string, unknown>) => {
        source.tileSize = 300;
      },
      (source: Record<string, unknown>) => {
        source.minZoom = 19;
        source.maxZoom = 0;
      },
      (source: Record<string, unknown>) => {
        source.bounds = [44, 41, 43, 44];
      },
    ];
    for (const mutate of invalidMutations) {
      const input = structuredClone(
        defaultMapProviderConfigurationInput,
      ) as unknown as {
        naprOrthophoto: { sources: Record<string, Record<string, unknown>> };
      };
      const source = input.naprOrthophoto.sources[sourceName];
      if (source === undefined) throw new Error('Missing NAPR test source.');
      mutate(source);

      expect(() => parseMapProviderConfiguration(input, baseUrl)).toThrow();
    }
  });

  it('rejects unsafe NAPR attribution', () => {
    const input = structuredClone(defaultMapProviderConfigurationInput) as unknown as {
      naprOrthophoto: { attribution: string };
    };
    input.naprOrthophoto.attribution = '<a href="javascript:alert(1)">NAPR</a>';

    expect(() => parseMapProviderConfiguration(input, baseUrl)).toThrow();
  });

  it('returns an actionable error without echoing secrets or raw input', () => {
    const fakeSecret = 'token=super-private-test-value';
    const result = loadMapProviderConfiguration(
      JSON.stringify({ vector: { tileJsonUrl: `https://tiles.test/?${fakeSecret}` } }),
      baseUrl,
    );

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('VITE_MAP_PROVIDER_CONFIGURATION');
      expect(result.message).not.toContain(fakeSecret);
      expect(result.message).not.toContain('tiles.test');
    }
  });
  it('rejects schema-v1 configuration rather than silently upgrading it', () => {
    const input = structuredClone(
      defaultMapProviderConfigurationInput,
    ) as unknown as Record<string, unknown>;
    input.schemaVersion = 1;

    expect(() => parseMapProviderConfiguration(input, baseUrl)).toThrow();
  });
});
