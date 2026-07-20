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
      renderer: { requestTimeoutMs: 60_000 },
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
    });
  });

  it('resolves fixture endpoints under a GitHub Pages-style base path', () => {
    const input = structuredClone(defaultMapProviderConfigurationInput) as unknown as {
      vector: {
        tileJsonUrl: string;
        glyphsUrl: string;
      };
      terrain: { tileUrl: string };
      satellite: { searchUrl: string };
    };
    input.vector.tileJsonUrl = './fixtures/vector/tiles.json';
    input.vector.glyphsUrl = './fixtures/fonts/{fontstack}/{range}.pbf';
    input.terrain.tileUrl = './fixtures/terrain/{z}/{x}/{y}.png';
    input.satellite.searchUrl = './fixtures/stac/search';

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
      name: 'satellite renderer timeout below the supported floor',
      mutate: (input: Record<string, unknown>) => {
        const satellite = input.satellite as Record<string, unknown>;
        const renderer = satellite.renderer as Record<string, unknown>;
        renderer.requestTimeoutMs = 4_999;
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const input = structuredClone(
      defaultMapProviderConfigurationInput,
    ) as unknown as Record<string, unknown>;
    mutate(input);

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
