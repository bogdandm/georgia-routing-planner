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
import { englishFirstLabelExpression } from '@/presentation/map/mapStyleFactory';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';

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
    expect(layerIds.indexOf(mapInsertionPoints.satelliteBeforeLayerId)).toBeLessThan(
      layerIds.indexOf(mapLayerIds.water),
    );
    expect(layerIds.indexOf(mapLayerIds.waterways)).toBeLessThan(
      layerIds.indexOf(mapLayerIds.water),
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

  it('uses one semantic palette for terrain, transport, vegetation, and future GPX', () => {
    const style = createHikingMapStyle(configuration);
    const serialized = JSON.stringify(style);

    expect(serialized).toContain(mapVisualPalette.base.background);
    expect(serialized).toContain(mapVisualPalette.vegetation.forest);
    expect(serialized).toContain(mapVisualPalette.transport.motorway);
    expect(mapVisualPalette.vegetation.grass).toBe('#DEE2DA');
    expect(mapVisualPalette.vegetation.farmland).toBe('#DFE0DA');
    expect(mapVisualPalette.water.line).toBe(mapVisualPalette.water.fill);
    expect(mapVisualPalette.terrain.contourIndex).toBe('#023047');
    expect(mapVisualPalette.userGeometry.gpxTrack).toBe('#168BFF');
    const roads = style.layers.find((layer) => layer.id === mapLayerIds.roads);
    const hikingPaths = style.layers.find(
      (layer) => layer.id === mapLayerIds.hikingPaths,
    );
    expect(roads).toHaveProperty('paint.line-opacity', 0.86);
    expect(hikingPaths).toHaveProperty(
      'paint.line-color',
      mapVisualPalette.transport.path,
    );
    expect(hikingPaths).toHaveProperty('paint.line-opacity', 0.9);
  });

  it('renders vegetation, glaciers, and provider-supported restricted areas distinctly', () => {
    const style = createHikingMapStyle(configuration);
    const vegetation = style.layers.find((layer) => layer.id === mapLayerIds.landcover);
    const restricted = style.layers.find(
      (layer) => layer.id === mapLayerIds.restrictedAreas,
    );
    const glaciers = style.layers.find(
      (layer) => layer.id === mapLayerIds.glacierAreas,
    );

    expect(vegetation).toHaveProperty('source-layer', 'landcover');
    expect(vegetation).toHaveProperty('filter', ['!=', ['get', 'class'], 'ice']);
    expect(vegetation).toHaveProperty('paint.fill-antialias', false);
    expect(vegetation).toHaveProperty('paint.fill-opacity', 1);
    expect(JSON.stringify(vegetation)).toContain('wood');
    expect(JSON.stringify(vegetation)).toContain('scrub');
    const landuse = style.layers.find((layer) => layer.id === mapLayerIds.landuse);
    expect(landuse).toHaveProperty('filter', [
      'in',
      ['get', 'class'],
      ['literal', ['residential', 'commercial', 'industrial', 'cemetery']],
    ]);
    expect(landuse).toHaveProperty('paint.fill-antialias', false);
    expect(glaciers).toHaveProperty('source-layer', 'landcover');
    expect(glaciers).toHaveProperty('paint.fill-antialias', false);
    expect(glaciers).toHaveProperty('filter', ['==', ['get', 'class'], 'ice']);
    expect(restricted).toHaveProperty('source-layer', 'landuse');
    expect(restricted).toHaveProperty('type', 'line');
    expect(restricted).toHaveProperty(
      'paint.line-color',
      mapVisualPalette.restricted.line,
    );
    expect(restricted).toHaveProperty('paint.line-opacity', 0.88);
    expect(restricted).toHaveProperty('filter', ['==', ['get', 'class'], 'military']);
  });

  it('prefers English, then provider transliteration, before a native name', () => {
    expect(englishFirstLabelExpression).toEqual([
      'coalesce',
      ['get', 'name:en'],
      ['get', 'name:latin'],
      ['get', 'name_en'],
      ['get', 'name'],
    ]);
    const style = createHikingMapStyle(configuration);
    for (const layerId of [
      mapLayerIds.hikingPoiLabels,
      mapLayerIds.roadLabels,
      mapLayerIds.waterLabels,
      mapLayerIds.placeLabels,
    ]) {
      expect(style.layers.find((layer) => layer.id === layerId)).toHaveProperty(
        'layout.text-field',
        englishFirstLabelExpression,
      );
    }
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
