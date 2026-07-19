import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import { mapLayerIds, mapSourceIds } from '@/presentation/map/mapIds';
import {
  mapVisualModePaint,
  mapVisualPalette,
} from '@/presentation/map/mapVisualPalette';

export const englishFirstLabelExpression: ExpressionSpecification = [
  'coalesce',
  ['get', 'name:en'],
  ['get', 'name:latin'],
  ['get', 'name_en'],
  ['get', 'name'],
];

const labelLayout: NonNullable<SymbolLayerSpecification['layout']> = {
  'text-field': englishFirstLabelExpression,
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
      paint: { 'background-color': mapVisualPalette.base.background },
    },
    {
      id: mapLayerIds.landcover,
      type: 'fill',
      source,
      'source-layer': sourceLayers.landcover,
      filter: ['!=', ['get', 'class'], 'ice'],
      paint: {
        'fill-antialias': false,
        'fill-color': [
          'case',
          ['==', ['get', 'class'], 'wood'],
          mapVisualPalette.vegetation.forest,
          ['in', ['get', 'subclass'], ['literal', ['scrub', 'shrubbery', 'heath']]],
          mapVisualPalette.vegetation.scrub,
          ['==', ['get', 'class'], 'grass'],
          mapVisualPalette.vegetation.grass,
          ['==', ['get', 'class'], 'farmland'],
          mapVisualPalette.vegetation.farmland,
          ['==', ['get', 'class'], 'wetland'],
          mapVisualPalette.vegetation.wetland,
          ['==', ['get', 'class'], 'rock'],
          mapVisualPalette.base.rock,
          ['==', ['get', 'class'], 'sand'],
          mapVisualPalette.base.sand,
          ['==', ['get', 'class'], 'ice'],
          mapVisualPalette.base.ice,
          mapVisualPalette.base.land,
        ],
        ...mapVisualModePaint.vector[mapLayerIds.landcover],
      },
    },
    {
      id: mapLayerIds.glacierAreas,
      type: 'fill',
      source,
      'source-layer': sourceLayers.landcover,
      filter: ['==', ['get', 'class'], 'ice'],
      paint: {
        'fill-antialias': false,
        'fill-color': mapVisualPalette.glacier.fill,
        ...mapVisualModePaint.vector[mapLayerIds.glacierAreas],
      },
    },
    {
      id: mapLayerIds.landuse,
      type: 'fill',
      source,
      'source-layer': sourceLayers.landuse,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['residential', 'commercial', 'industrial', 'cemetery']],
      ],
      paint: {
        'fill-antialias': false,
        'fill-color': [
          'match',
          ['get', 'class'],
          'residential',
          mapVisualPalette.base.built,
          'commercial',
          mapVisualPalette.base.built,
          'industrial',
          mapVisualPalette.base.built,
          'cemetery',
          mapVisualPalette.vegetation.grass,
          mapVisualPalette.base.land,
        ],
        ...mapVisualModePaint.vector[mapLayerIds.landuse],
      },
    },
    {
      id: mapLayerIds.restrictedAreas,
      type: 'line',
      source,
      'source-layer': sourceLayers.landuse,
      filter: ['==', ['get', 'class'], 'military'],
      paint: {
        'line-color': mapVisualPalette.restricted.line,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2],
        ...mapVisualModePaint.vector[mapLayerIds.restrictedAreas],
      },
    },
    {
      id: mapLayerIds.parks,
      type: 'fill',
      source,
      'source-layer': sourceLayers.parks,
      paint: {
        'fill-antialias': false,
        'fill-color': mapVisualPalette.vegetation.park,
        ...mapVisualModePaint.vector[mapLayerIds.parks],
      },
    },
    {
      id: mapLayerIds.water,
      type: 'fill',
      source,
      'source-layer': sourceLayers.water,
      paint: {
        'fill-color': mapVisualPalette.water.fill,
        ...mapVisualModePaint.vector[mapLayerIds.water],
      },
    },
    {
      id: mapLayerIds.waterways,
      type: 'line',
      source,
      'source-layer': sourceLayers.waterways,
      paint: {
        'line-color': mapVisualPalette.water.line,
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
        'line-color': mapVisualPalette.boundary,
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
        'line-color': mapVisualPalette.transport.casing,
        ...mapVisualModePaint.vector[mapLayerIds.roadCasings],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 14, 4.2],
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
          mapVisualPalette.transport.motorway,
          'trunk',
          mapVisualPalette.transport.trunk,
          'primary',
          mapVisualPalette.transport.primary,
          'secondary',
          mapVisualPalette.transport.secondary,
          mapVisualPalette.transport.minor,
        ],
        ...mapVisualModePaint.vector[mapLayerIds.roads],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 14, 3.2],
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
        'line-color': mapVisualPalette.transport.path,
        ...mapVisualModePaint.vector[mapLayerIds.hikingPaths],
        'line-dasharray': [2, 1.5],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2.1],
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
        'line-color': mapVisualPalette.transport.steps,
        ...mapVisualModePaint.vector[mapLayerIds.hikingSteps],
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
        'circle-color': mapVisualPalette.point,
        'circle-opacity': 0.76,
        'circle-radius': 3,
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
        'text-color': mapVisualPalette.text.primary,
        'text-halo-color': mapVisualPalette.text.haloVector,
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
        'circle-color': mapVisualPalette.text.secondary,
        'circle-radius': 3,
        'circle-stroke-color': mapVisualPalette.text.haloVector,
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
          englishFirstLabelExpression,
          [
            'case',
            ['has', 'ele'],
            ['concat', '  ', ['to-string', ['get', 'ele']], ' m'],
            '',
          ],
        ],
      },
      paint: {
        'text-color': mapVisualPalette.text.primary,
        'text-halo-color': mapVisualPalette.text.haloVector,
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
        'text-field': englishFirstLabelExpression,
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
      },
      paint: {
        'text-color': mapVisualPalette.text.secondary,
        'text-halo-color': mapVisualPalette.text.haloVector,
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
        'text-color': mapVisualPalette.water.label,
        'text-halo-color': mapVisualPalette.text.haloVector,
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
        'text-color': mapVisualPalette.text.primary,
        'text-halo-color': mapVisualPalette.text.haloVector,
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
