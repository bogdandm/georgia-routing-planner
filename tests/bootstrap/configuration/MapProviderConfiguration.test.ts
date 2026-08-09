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
    expect(configuration.naprOrthophoto2025).toEqual({
      id: 'napr-orthophoto-2025',
      label: 'NAPR Orthophoto 2025',
      tileUrls: [
        'https://mp.napr.gov.ge/ORTHO_2025_BLK4/wmts/ORTHO_2025_BLK4/GLOBAL_MERCATOR/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      minZoom: 0,
      maxZoom: 19,
      bounds: [
        41.496791459122655, 41.9954418326647, 43.67097971829147, 43.16476392114931,
      ],
      attribution:
        'Imagery: <a href="https://maps.gov.ge/" target="_blank">National Agency of Public Registry (NAPR), Orthophoto 2025</a>',
    });
    expect(summarizeMapProviderConfiguration(configuration)).toEqual({
      schemaVersion: 1,
      vectorId: 'openfreemap-openmaptiles',
      vectorOrigin: 'https://tiles.openfreemap.org',
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
      naprOrthophoto2025Id: 'napr-orthophoto-2025',
      naprOrthophoto2025Origins: ['https://mp.napr.gov.ge'],
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

  it('defaults NAPR orthophoto for existing schema-v1 external configuration', () => {
    const input = structuredClone(
      defaultMapProviderConfigurationInput,
    ) as unknown as Record<string, unknown>;
    delete input.naprOrthophoto2025;

    const configuration = parseMapProviderConfiguration(input, baseUrl);

    expect(configuration.naprOrthophoto2025.id).toBe('napr-orthophoto-2025');
  });

  it('resolves fixture endpoints under a GitHub Pages-style base path', () => {
    const input = structuredClone(defaultMapProviderConfigurationInput) as unknown as {
      vector: {
        tileJsonUrl: string;
        glyphsUrl: string;
      };
      terrain: { tileUrl: string };
      satellite: { searchUrl: string };
      satelliteBasemap: { tileUrls: string[] };
      naprOrthophoto2025: { tileUrls: string[] };
    };
    input.vector.tileJsonUrl = './fixtures/vector/tiles.json';
    input.vector.glyphsUrl = './fixtures/fonts/{fontstack}/{range}.pbf';
    input.terrain.tileUrl = './fixtures/terrain/{z}/{x}/{y}.png';
    input.satellite.searchUrl = './fixtures/stac/search';
    input.satelliteBasemap.tileUrls = [
      './fixtures/satellite/{z}/{x}/{y}.jpg',
      './fixtures/satellite/{z}/{x}/{y}.jpg',
    ];
    input.naprOrthophoto2025.tileUrls = ['./fixtures/napr/{z}/{x}/{y}.png'];

    const configuration = parseMapProviderConfiguration(input, baseUrl);

    expect(configuration.vector.tileJsonUrl).toBe(
      'https://example.test/georgia-routing-planner/fixtures/vector/tiles.json',
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
    expect(configuration.naprOrthophoto2025.tileUrls).toEqual([
      'https://example.test/georgia-routing-planner/fixtures/napr/{z}/{x}/{y}.png',
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
    {
      name: 'non-HTTPS tile endpoint',
      mutate: (orthophoto: Record<string, unknown>) => {
        orthophoto.tileUrls = ['http://tiles.example.test/{z}/{x}/{y}.png'];
      },
    },
    {
      name: 'tile endpoint missing XYZ token',
      mutate: (orthophoto: Record<string, unknown>) => {
        orthophoto.tileUrls = ['https://tiles.example.test/{z}/{x}/tile.png'];
      },
    },
    {
      name: 'unsafe attribution',
      mutate: (orthophoto: Record<string, unknown>) => {
        orthophoto.attribution = '<a href="javascript:alert(1)">NAPR</a>';
      },
    },
    {
      name: 'invalid tile size',
      mutate: (orthophoto: Record<string, unknown>) => {
        orthophoto.tileSize = 300;
      },
    },
    {
      name: 'reversed zooms',
      mutate: (orthophoto: Record<string, unknown>) => {
        orthophoto.minZoom = 19;
        orthophoto.maxZoom = 0;
      },
    },
    {
      name: 'out-of-range bounds',
      mutate: (orthophoto: Record<string, unknown>) => {
        orthophoto.bounds = [-181, 41, 44, 44];
      },
    },
    {
      name: 'misordered bounds',
      mutate: (orthophoto: Record<string, unknown>) => {
        orthophoto.bounds = [44, 41, 43, 44];
      },
    },
  ])('rejects NAPR orthophoto with $name', ({ mutate }) => {
    const input = structuredClone(
      defaultMapProviderConfigurationInput,
    ) as unknown as Record<string, unknown>;
    mutate(input.naprOrthophoto2025 as Record<string, unknown>);

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
});
