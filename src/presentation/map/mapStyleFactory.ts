import type {
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import { mapLayerIds, mapSourceIds } from '@/presentation/map/mapIds';
import { appColors } from '@/presentation/theme/appColors';

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
      paint: { 'background-color': appColors.surface.map },
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
          '#C6E2E3',
          'grass',
          '#D8ECEB',
          'rock',
          '#DCE6E8',
          'sand',
          '#F6E6C3',
          'ice',
          '#F5FBFC',
          '#E3EEF0',
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
          '#E7F0F3',
          'cemetery',
          '#D8ECE6',
          'military',
          '#F7E2D5',
          '#E3EDF0',
        ],
        'fill-opacity': 0.65,
      },
    },
    {
      id: mapLayerIds.parks,
      type: 'fill',
      source,
      'source-layer': sourceLayers.parks,
      paint: { 'fill-color': '#BFE0DC', 'fill-opacity': 0.55 },
    },
    {
      id: mapLayerIds.water,
      type: 'fill',
      source,
      'source-layer': sourceLayers.water,
      paint: { 'fill-color': appColors.brand.sky },
    },
    {
      id: mapLayerIds.waterways,
      type: 'line',
      source,
      'source-layer': sourceLayers.waterways,
      paint: {
        'line-color': appColors.brand.blueGreen,
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
        'line-color': appColors.text.secondary,
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
        'line-color': appColors.border.default,
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
          appColors.brand.tigerOrange,
          'trunk',
          appColors.brand.amber,
          'primary',
          '#FFD36B',
          appColors.surface.panel,
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
        'line-color': appColors.status.warning,
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
        'line-color': appColors.brand.deepSpace,
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
        'circle-color': appColors.brand.blueGreen,
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
        'text-color': appColors.brand.deepSpace,
        'text-halo-color': appColors.surface.panel,
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
        'circle-color': appColors.text.secondary,
        'circle-radius': 3,
        'circle-stroke-color': appColors.surface.panel,
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
        'text-color': appColors.text.primary,
        'text-halo-color': appColors.surface.panel,
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
        'text-color': appColors.text.secondary,
        'text-halo-color': appColors.surface.panel,
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
        'text-color': '#075E7A',
        'text-halo-color': appColors.surface.canvas,
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
        'text-color': appColors.text.primary,
        'text-halo-color': appColors.surface.panel,
        'text-halo-width': 1.4,
      },
    },
  ];
}

/**
 * Builds the complete deterministic hiking basemap style from validated provider
 * mappings. Stable IDs and layer order are integration contracts for later overlays.
 */
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
