import { describe, expect, it } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  mapInsertionPoints,
  mapLayerIds,
  mapSourceIds,
  naprOrthophotoLayerIds,
  naprOrthophotoSourceIds,
  satelliteBasemapLayerIds,
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
    expect(style.sources[mapSourceIds.satelliteBasemap]).toEqual({
      type: 'raster',
      tiles: [
        'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      ],
      tileSize: 256,
      attribution: '<a href="https://www.google.com/maps" target="_blank">© Google</a>',
    });
    const naprSourceEntries = [
      ['national2016To2017', naprOrthophotoSourceIds.national2016To2017],
      ['westernGeorgia2020', naprOrthophotoSourceIds.westernGeorgia2020],
      ['kutaisi2020', naprOrthophotoSourceIds.kutaisi2020],
      ['racha2025', naprOrthophotoSourceIds.racha2025],
    ] as const;
    for (const [name, sourceId] of naprSourceEntries) {
      const source = configuration.naprOrthophoto.sources[name];
      expect(style.sources[sourceId]).toEqual({
        type: 'raster',
        tiles: source.tileUrls,
        tileSize: source.tileSize,
        minzoom: source.minZoom,
        maxzoom: source.maxZoom,
        bounds: source.bounds,
        attribution: configuration.naprOrthophoto.attribution,
      });
      const layerId = naprOrthophotoLayerIds[name];
      expect(style.layers.find((layer) => layer.id === layerId)).toMatchObject({
        type: 'raster',
        source: sourceId,
        layout: { visibility: 'none' },
        paint: { 'raster-fade-duration': 0 },
      });
    }
    expect(layerIds).toEqual([
      mapLayerIds.background,
      satelliteBasemapLayerIds.imagery,
      naprOrthophotoLayerIds.national2016To2017,
      naprOrthophotoLayerIds.westernGeorgia2020,
      naprOrthophotoLayerIds.kutaisi2020,
      naprOrthophotoLayerIds.racha2025,
      ...Object.values(mapLayerIds).slice(1),
    ]);
    expect(layerIds.indexOf(naprOrthophotoLayerIds.national2016To2017)).toBeLessThan(
      layerIds.indexOf(naprOrthophotoLayerIds.westernGeorgia2020),
    );
    expect(layerIds.indexOf(naprOrthophotoLayerIds.westernGeorgia2020)).toBeLessThan(
      layerIds.indexOf(naprOrthophotoLayerIds.kutaisi2020),
    );
    expect(layerIds.indexOf(naprOrthophotoLayerIds.kutaisi2020)).toBeLessThan(
      layerIds.indexOf(naprOrthophotoLayerIds.racha2025),
    );
    expect(layerIds.indexOf(naprOrthophotoLayerIds.racha2025)).toBeLessThan(
      layerIds.indexOf(mapLayerIds.landcover),
    );
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
    expect(
      layerIds.slice(
        layerIds.indexOf(mapLayerIds.roadLabels),
        layerIds.indexOf(mapLayerIds.waterLabels) + 1,
      ),
    ).toEqual([
      mapLayerIds.roadLabels,
      mapLayerIds.riverLabels,
      mapLayerIds.ridgeLabels,
      mapLayerIds.waterLabels,
    ]);
  });

  it('retains provider attribution and contains no query secrets', () => {
    const style = createHikingMapStyle(configuration);
    const serialized = JSON.stringify(style);

    expect(serialized).toContain('OpenFreeMap');
    expect(serialized).toContain('OpenStreetMap');
    expect(serialized).toContain('© Google');
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

  it('places English-first river labels along river geometry before water-body labels', () => {
    const style = createHikingMapStyle(configuration);
    const riverLabels = style.layers.find(
      (layer) => layer.id === mapLayerIds.riverLabels,
    );

    expect(riverLabels).toMatchObject({
      id: mapLayerIds.riverLabels,
      type: 'symbol',
      source: mapSourceIds.basemapVector,
      'source-layer': 'waterway',
      minzoom: 7,
      filter: ['==', ['get', 'class'], 'river'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 750,
        'text-field': englishFirstLabelExpression,
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
      },
      paint: {
        'text-color': mapVisualPalette.water.label,
        'text-halo-color': mapVisualPalette.text.haloVector,
        'text-halo-width': 1,
      },
    });
  });

  it('renders ridge geometry and places English-first labels along it', () => {
    const style = createHikingMapStyle(configuration);
    const ridges = style.layers.find((layer) => layer.id === mapLayerIds.ridges);
    const peakLabels = style.layers.find(
      (layer) => layer.id === mapLayerIds.peakLabels,
    );
    const ridgeLabels = style.layers.find(
      (layer) => layer.id === mapLayerIds.ridgeLabels,
    );

    expect(ridges).toMatchObject({
      id: mapLayerIds.ridges,
      type: 'line',
      source: mapSourceIds.basemapVector,
      'source-layer': 'mountain_peak',
      minzoom: 13,
      filter: ['==', ['get', 'class'], 'ridge'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapVisualPalette.terrain.ridge,
        'line-opacity': 0.48,
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 16, 1],
      },
    });
    expect(ridgeLabels).toMatchObject({
      id: mapLayerIds.ridgeLabels,
      type: 'symbol',
      source: mapSourceIds.basemapVector,
      'source-layer': 'mountain_peak',
      minzoom: 13,
      filter: ['==', ['get', 'class'], 'ridge'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 250,
        'text-field': englishFirstLabelExpression,
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
      },
    });
    expect(peakLabels).toHaveProperty('filter', [
      'in',
      ['get', 'class'],
      ['literal', ['peak', 'volcano', 'saddle']],
    ]);
  });

  it('keeps labels readable across nearby and distant map detail', () => {
    const style = createHikingMapStyle(configuration);

    for (const layerId of [
      mapLayerIds.hikingPoiLabels,
      mapLayerIds.peakLabels,
      mapLayerIds.waterLabels,
    ]) {
      expect(style.layers.find((layer) => layer.id === layerId)).toHaveProperty(
        'layout.text-size',
        13,
      );
    }
    expect(
      style.layers.find((layer) => layer.id === mapLayerIds.roadLabels),
    ).toHaveProperty('layout.text-size', 12);
    expect(
      style.layers.find((layer) => layer.id === mapLayerIds.placeLabels),
    ).toHaveProperty('layout.text-size', [
      'interpolate',
      ['linear'],
      ['zoom'],
      5,
      ['match', ['get', 'class'], 'city', 16, 13],
      12,
      ['match', ['get', 'class'], 'city', 19, 14],
    ]);
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
    const ridges = style.layers.find((layer) => layer.id === mapLayerIds.ridges);

    expect(hikingPaths).toHaveProperty('source-layer', 'fixture_transport');
    expect(peaks).toHaveProperty('source-layer', 'fixture_peaks');
    expect(ridges).toHaveProperty('source-layer', 'fixture_peaks');
  });
});
