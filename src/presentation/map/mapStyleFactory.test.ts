import { describe, expect, it } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  mapInsertionPoints,
  mapLayerIds,
  mapSourceIds,
} from '@/presentation/map/mapIds';
import { createHikingMapStyle } from '@/presentation/map/mapStyleFactory';

const configuration = parseMapProviderConfiguration(
  defaultMapProviderConfigurationInput,
  'https://example.test/georgia-routing-planner/',
);

describe('createHikingMapStyle', () => {
  it('maps the provider schema into a deterministic hiking-focused layer order', () => {
    const style = createHikingMapStyle(configuration);
    const layerIds = style.layers.map((layer) => layer.id);

    expect(style.sources[mapSourceIds.basemapVector]).toMatchObject({
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    });
    expect(layerIds).toEqual(Object.values(mapLayerIds));
    expect(layerIds.indexOf(mapLayerIds.landcover)).toBeLessThan(
      layerIds.indexOf(mapInsertionPoints.satelliteBeforeLayerId),
    );
    expect(layerIds.indexOf(mapLayerIds.hikingPaths)).toBeGreaterThan(
      layerIds.indexOf(mapLayerIds.roads),
    );
    expect(layerIds.indexOf(mapLayerIds.placeLabels)).toBeGreaterThan(
      layerIds.indexOf(mapLayerIds.hikingPois),
    );
  });

  it('retains provider attribution and contains no query secrets', () => {
    const style = createHikingMapStyle(configuration);
    const serialized = JSON.stringify(style);

    expect(serialized).toContain('OpenFreeMap');
    expect(serialized).toContain('OpenStreetMap');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('token=');
  });

  it('uses the shared application palette for the dominant basemap accents', () => {
    const style = createHikingMapStyle(configuration);
    const serialized = JSON.stringify(style);

    expect(serialized).toContain('#8ECAE6');
    expect(serialized).toContain('#219EBC');
    expect(serialized).toContain('#023047');
    expect(serialized).toContain('#FFB703');
    expect(serialized).toContain('#FB8500');
  });

  it('uses the configured source-layer mapping exactly once at the style boundary', () => {
    const customConfiguration = {
      ...configuration,
      vector: {
        ...configuration.vector,
        sourceLayers: {
          ...configuration.vector.sourceLayers,
          transportation: 'fixture_transport',
          peaks: 'fixture_peaks',
        },
      },
    };
    const style = createHikingMapStyle(customConfiguration);
    const hikingPaths = style.layers.find(
      (layer) => layer.id === mapLayerIds.hikingPaths,
    );
    const peaks = style.layers.find((layer) => layer.id === mapLayerIds.peaks);

    expect(hikingPaths).toHaveProperty('source-layer', 'fixture_transport');
    expect(peaks).toHaveProperty('source-layer', 'fixture_peaks');
  });
});
