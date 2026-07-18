import type {
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import { mapLayerIds, mapSourceIds } from '@/presentation/map/mapIds';

const labelLayout: NonNullable<SymbolLayerSpecification['layout']> = {
  'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
  'text-font': ['Noto Sans Regular'],
  'text-size': 12,
  'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
  'text-radial-offset': 0.5,
  'text-justify': 'auto',
};

function createBasemapLayers(
  sourceLayers: MapProviderConfiguration['vector']['sourceLayers'],
): readonly LayerSpecification[] {
  const source = mapSourceIds.basemapVector;
  return [
    {
      id: mapLayerIds.background,
      type: 'background',
      paint: { 'background-color': '#e9efe5' },
    },
    {
      id: mapLayerIds.landcover,
      type: 'fill',
      source,
      'source-layer': sourceLayers.landcover,
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'wood',
          '#cfe0c5',
          'grass',
          '#dce8c9',
          'rock',
          '#ddd8cf',
          'sand',
          '#eee3c7',
          'ice',
          '#eef5f4',
          '#e7eadf',
        ],
        'fill-opacity': 0.8,
      },
    },
    {
      id: mapLayerIds.landuse,
      type: 'fill',
      source,
      'source-layer': sourceLayers.landuse,
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'residential',
          '#e8e3dc',
          'cemetery',
          '#d8e2d1',
          'military',
          '#eadbd5',
          '#e6e8df',
        ],
        'fill-opacity': 0.65,
      },
    },
    {
      id: mapLayerIds.parks,
      type: 'fill',
      source,
      'source-layer': sourceLayers.parks,
      paint: { 'fill-color': '#c9dfbd', 'fill-opacity': 0.55 },
    },
    {
      id: mapLayerIds.water,
      type: 'fill',
      source,
      'source-layer': sourceLayers.water,
      paint: { 'fill-color': '#a9cede' },
    },
    {
      id: mapLayerIds.waterways,
      type: 'line',
      source,
      'source-layer': sourceLayers.waterways,
      paint: {
        'line-color': '#87b9cf',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2],
      },
    },
    {
      id: mapLayerIds.boundaries,
      type: 'line',
      source,
      'source-layer': sourceLayers.boundaries,
      filter: ['all', ['in', ['get', 'admin_level'], ['literal', [2, 4]]]],
      paint: {
        'line-color': '#8f8b86',
        'line-dasharray': [3, 2],
        'line-opacity': 0.7,
        'line-width': ['match', ['get', 'admin_level'], 2, 1.5, 0.8],
      },
    },
    {
      id: mapLayerIds.roadCasings,
      type: 'line',
      source,
      'source-layer': sourceLayers.transportation,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#b9afa2',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 14, 5.5],
      },
    },
    {
      id: mapLayerIds.roads,
      type: 'line',
      source,
      'source-layer': sourceLayers.transportation,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'motorway',
          '#e7ad6f',
          'trunk',
          '#e9bd82',
          'primary',
          '#f2d2a2',
          '#f7f2e8',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 14, 4],
      },
    },
    {
      id: mapLayerIds.hikingPaths,
      type: 'line',
      source,
      'source-layer': sourceLayers.transportation,
      minzoom: 10,
      filter: [
        'any',
        ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        [
          'in',
          ['get', 'subclass'],
          ['literal', ['path', 'footway', 'bridleway', 'cycleway']],
        ],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#8a603c',
        'line-dasharray': [2, 1.5],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2.4],
      },
    },
    {
      id: mapLayerIds.hikingSteps,
      type: 'line',
      source,
      'source-layer': sourceLayers.transportation,
      minzoom: 13,
      filter: ['==', ['get', 'subclass'], 'steps'],
      paint: {
        'line-color': '#6f4d32',
        'line-dasharray': [0.5, 1],
        'line-width': 2,
      },
    },
    {
      id: mapLayerIds.hikingPois,
      type: 'circle',
      source,
      'source-layer': sourceLayers.pois,
      minzoom: 11,
      filter: [
        'any',
        ['in', ['get', 'class'], ['literal', ['campsite', 'lodging', 'attraction']]],
        [
          'in',
          ['get', 'subclass'],
          [
            'literal',
            [
              'shelter',
              'alpine_hut',
              'wilderness_hut',
              'camp_site',
              'drinking_water',
              'viewpoint',
              'information',
            ],
          ],
        ],
      ],
      paint: {
        'circle-color': '#365f48',
        'circle-radius': 4,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    },
    {
      id: mapLayerIds.hikingPoiLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.pois,
      minzoom: 13,
      filter: [
        'in',
        ['get', 'subclass'],
        [
          'literal',
          ['shelter', 'alpine_hut', 'wilderness_hut', 'camp_site', 'viewpoint'],
        ],
      ],
      layout: labelLayout,
      paint: {
        'text-color': '#294737',
        'text-halo-color': '#f7f6ef',
        'text-halo-width': 1.2,
      },
    },
    {
      id: mapLayerIds.peaks,
      type: 'circle',
      source,
      'source-layer': sourceLayers.peaks,
      minzoom: 9,
      filter: ['in', ['get', 'class'], ['literal', ['peak', 'volcano', 'saddle']]],
      paint: {
        'circle-color': '#6e6255',
        'circle-radius': 3,
        'circle-stroke-color': '#f8f5ee',
        'circle-stroke-width': 1,
      },
    },
    {
      id: mapLayerIds.peakLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.peaks,
      minzoom: 10,
      layout: {
        ...labelLayout,
        'text-field': [
          'concat',
          ['coalesce', ['get', 'name:en'], ['get', 'name']],
          [
            'case',
            ['has', 'ele'],
            ['concat', '  ', ['to-string', ['get', 'ele']], ' m'],
            '',
          ],
        ],
      },
      paint: {
        'text-color': '#4e463e',
        'text-halo-color': '#f7f6ef',
        'text-halo-width': 1.2,
      },
    },
    {
      id: mapLayerIds.roadLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.transportationNames,
      minzoom: 11,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
      },
      paint: {
        'text-color': '#635c54',
        'text-halo-color': '#f7f6ef',
        'text-halo-width': 1,
      },
    },
    {
      id: mapLayerIds.waterLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.waterNames,
      minzoom: 7,
      layout: labelLayout,
      paint: {
        'text-color': '#477d94',
        'text-halo-color': '#e5f0f2',
        'text-halo-width': 1,
      },
    },
    {
      id: mapLayerIds.placeLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.places,
      layout: {
        ...labelLayout,
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5,
          ['match', ['get', 'class'], 'city', 14, 11],
          12,
          ['match', ['get', 'class'], 'city', 18, 13],
        ],
      },
      paint: {
        'text-color': '#27342d',
        'text-halo-color': '#f7f6ef',
        'text-halo-width': 1.4,
      },
    },
  ];
}

export function createHikingMapStyle(
  configuration: MapProviderConfiguration,
): StyleSpecification {
  return {
    version: 8,
    name: 'Georgia hiking basemap v1',
    glyphs: configuration.vector.glyphsUrl,
    sources: {
      [mapSourceIds.basemapVector]: {
        type: 'vector',
        url: configuration.vector.tileJsonUrl,
        attribution: configuration.vector.attribution,
      },
    },
    layers: [...createBasemapLayers(configuration.vector.sourceLayers)],
  };
}
