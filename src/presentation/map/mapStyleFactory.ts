import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  basemapImageIds,
  mapLayerIds,
  mapSourceIds,
  naprOrthophotoLayerIds,
  naprOrthophotoSourceIds,
  satelliteBasemapLayerIds,
} from '@/presentation/map/mapIds';
import {
  cyrillicIotatingPredecessors,
  cyrillicLatin,
  georgianLatin,
  georgianMkhedruliStart,
} from '@/domain/tracks/trackNaming';
import {
  mapVisualModePaint,
  mapVisualPalette,
} from '@/presentation/map/mapVisualPalette';

/** Longer labels are shown unchanged: the expression romanizes one position at a time. */
const romanizedLabelMaximumLength = 40;

/** Romanized output for each lower-case Georgian and Cyrillic letter, grouped by output. */
const romanizationMatchArguments: readonly (string | string[])[] = (() => {
  const lettersByLatin = new Map<string, string[]>();
  const add = (letter: string, latin: string) => {
    lettersByLatin.set(latin, [...(lettersByLatin.get(latin) ?? []), letter]);
  };
  georgianLatin.forEach((latin, index) => {
    add(String.fromCharCode(georgianMkhedruliStart + index), latin);
  });
  for (const [letter, latin] of Object.entries(cyrillicLatin)) add(letter, latin);
  return [...lettersByLatin].flatMap(([latin, letters]) => [letters, latin]);
})();

/**
 * Mirrors `romanizePlaceLabel` for the character at `index` of the `label` variable.
 * MapLibre expressions have no string replacement, so each position is matched alone.
 * A character is a letter exactly when it has distinct cases, which also holds for
 * Georgian (Mkhedruli/Mtavruli) and Cyrillic.
 */
function romanizedCharacterExpression(index: number): ExpressionSpecification {
  const label: ExpressionSpecification = ['var', 'label'];
  const character: ExpressionSpecification = ['var', 'character'];
  const lower: ExpressionSpecification = ['var', 'lower'];
  const latin: ExpressionSpecification = ['var', 'latin'];
  const previous: ExpressionSpecification = ['slice', label, index - 1, index];
  const atWordStart: ExpressionSpecification | boolean = index === 0 || [
    '==',
    ['downcase', previous],
    ['upcase', previous],
  ];
  const iotated: ExpressionSpecification | boolean = index === 0 || [
    'any',
    atWordStart,
    ['in', ['downcase', previous], cyrillicIotatingPredecessors],
  ];
  const followedByU: ExpressionSpecification = [
    '==',
    ['downcase', ['slice', label, index + 1, index + 2]],
    'u',
  ];
  return [
    'let',
    'character',
    ['slice', label, index, index + 1],
    [
      'let',
      'lower',
      ['downcase', character],
      [
        'let',
        'latin',
        [
          'match',
          lower,
          ['е', 'ё'],
          ['case', iotated, 'ye', 'e'],
          'q',
          ['case', followedByU, 'q', 'k'],
          ...romanizationMatchArguments,
          character,
        ],
        [
          'case',
          [
            'case',
            ['all', ['>=', lower, 'ა'], ['<=', lower, 'ჿ']],
            atWordStart,
            ['!=', character, lower],
          ],
          ['concat', ['upcase', ['slice', latin, 0, 1]], ['slice', latin, 1]],
          latin,
        ],
      ],
    ],
  ];
}

/**
 * English name first, then the provider transliteration, then the native name; the
 * result is romanized like track names (Georgian road-sign style, BGN/PCGN Cyrillic,
 * national-system `q` as `k`) so the map never shows Georgian or Cyrillic script.
 */
export const englishFirstLabelExpression: ExpressionSpecification = [
  'let',
  'label',
  [
    'coalesce',
    ['get', 'name:en'],
    ['get', 'name:latin'],
    ['get', 'name_en'],
    ['get', 'name'],
    '',
  ],
  [
    'case',
    ['<=', ['length', ['var', 'label']], romanizedLabelMaximumLength],
    [
      'concat',
      ...Array.from({ length: romanizedLabelMaximumLength }, (_, index) =>
        romanizedCharacterExpression(index),
      ),
    ],
    ['var', 'label'],
  ],
];

const labelLayout: NonNullable<SymbolLayerSpecification['layout']> = {
  'text-field': englishFirstLabelExpression,
  'text-font': ['Noto Sans Regular'],
  'text-size': 13,
  'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
  'text-radial-offset': 0.5,
  'text-justify': 'auto',
};

function createBasemapLayers(
  sourceLayers: MapProviderConfiguration['vector']['sourceLayers'],
  detailSourceLayers: MapProviderConfiguration['detailVector']['sourceLayers'],
): readonly LayerSpecification[] {
  const source = mapSourceIds.basemapVector;
  const detailSource = mapSourceIds.basemapDetailVector;
  return [
    {
      id: mapLayerIds.background,
      type: 'background',
      paint: { 'background-color': mapVisualPalette.base.background },
    },
    {
      id: satelliteBasemapLayerIds.imagery,
      type: 'raster',
      source: mapSourceIds.satelliteBasemap,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0 },
    },
    {
      id: satelliteBasemapLayerIds.bing,
      type: 'raster',
      source: mapSourceIds.bingSatelliteBasemap,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0 },
    },
    {
      id: satelliteBasemapLayerIds.esri,
      type: 'raster',
      source: mapSourceIds.esriSatelliteBasemap,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0 },
    },
    {
      id: naprOrthophotoLayerIds.national2016To2017,
      type: 'raster',
      source: naprOrthophotoSourceIds.national2016To2017,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0 },
    },
    {
      id: naprOrthophotoLayerIds.westernGeorgia2020,
      type: 'raster',
      source: naprOrthophotoSourceIds.westernGeorgia2020,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0 },
    },
    {
      id: naprOrthophotoLayerIds.kutaisi2020,
      type: 'raster',
      source: naprOrthophotoSourceIds.kutaisi2020,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0 },
    },
    {
      id: naprOrthophotoLayerIds.racha2025,
      type: 'raster',
      source: naprOrthophotoSourceIds.racha2025,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0 },
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
      id: mapLayerIds.brownfieldAreas,
      type: 'fill',
      source: detailSource,
      'source-layer': detailSourceLayers.land,
      filter: ['==', ['get', 'kind'], 'brownfield'],
      paint: {
        'fill-antialias': false,
        'fill-color': mapVisualPalette.base.brownfield,
        ...mapVisualModePaint.vector[mapLayerIds.brownfieldAreas],
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
      id: mapLayerIds.waterways,
      type: 'line',
      source,
      'source-layer': sourceLayers.waterways,
      filter: ['!=', ['get', 'intermittent'], 1],
      paint: {
        'line-color': mapVisualPalette.water.line,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2],
      },
    },
    {
      id: mapLayerIds.intermittentWaterways,
      type: 'line',
      source,
      'source-layer': sourceLayers.waterways,
      filter: ['==', ['get', 'intermittent'], 1],
      paint: {
        'line-color': mapVisualPalette.water.line,
        'line-dasharray': [4, 3],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2],
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
      id: mapLayerIds.buildings,
      type: 'fill',
      source: detailSource,
      'source-layer': detailSourceLayers.buildings,
      paint: {
        'fill-antialias': false,
        'fill-color': mapVisualPalette.base.building,
        ...mapVisualModePaint.vector[mapLayerIds.buildings],
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
      source: detailSource,
      'source-layer': detailSourceLayers.streets,
      filter: [
        'in',
        ['get', 'kind'],
        [
          'literal',
          [
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'unclassified',
            'residential',
            'living_street',
            'service',
          ],
        ],
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
      source: detailSource,
      'source-layer': detailSourceLayers.streets,
      filter: [
        'in',
        ['get', 'kind'],
        [
          'literal',
          [
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'unclassified',
            'residential',
            'living_street',
            'service',
          ],
        ],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'kind'],
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
      maxzoom: 13,
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
      id: mapLayerIds.hikingPathDetails,
      type: 'line',
      source: detailSource,
      'source-layer': detailSourceLayers.streets,
      minzoom: 13,
      filter: [
        'in',
        ['get', 'kind'],
        ['literal', ['track', 'footway', 'path', 'cycleway', 'pedestrian']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapVisualPalette.transport.path,
        ...mapVisualModePaint.vector[mapLayerIds.hikingPathDetails],
        'line-dasharray': [2, 1.5],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2.1],
      },
    },
    {
      id: mapLayerIds.hikingBridleways,
      type: 'line',
      source,
      'source-layer': sourceLayers.transportation,
      minzoom: 13,
      filter: ['==', ['get', 'subclass'], 'bridleway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapVisualPalette.transport.path,
        ...mapVisualModePaint.vector[mapLayerIds.hikingBridleways],
        'line-dasharray': [2, 1.5],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2.1],
      },
    },
    {
      id: mapLayerIds.hikingSteps,
      type: 'line',
      source: detailSource,
      'source-layer': detailSourceLayers.streets,
      minzoom: 13,
      filter: ['==', ['get', 'kind'], 'steps'],
      paint: {
        'line-color': mapVisualPalette.transport.steps,
        ...mapVisualModePaint.vector[mapLayerIds.hikingSteps],
        'line-dasharray': [0.5, 1],
        'line-width': 2,
      },
    },
    {
      id: mapLayerIds.aerialways,
      type: 'line',
      source,
      'source-layer': sourceLayers.transportation,
      minzoom: 12,
      filter: ['==', ['get', 'class'], 'aerialway'],
      paint: {
        'line-pattern': basemapImageIds.aerialwayPattern,
        'line-width': 8,
      },
    },
    {
      id: mapLayerIds.fords,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.transportation,
      minzoom: 12,
      filter: ['==', ['get', 'brunnel'], 'ford'],
      layout: {
        'symbol-placement': 'line-center',
        'icon-image': basemapImageIds.ford,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: mapLayerIds.hikingPois,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.pois,
      minzoom: 11,
      // Lodging is limited to mountain huts: hotels and guest houses are not hiking POIs.
      filter: [
        'any',
        ['in', ['get', 'class'], ['literal', ['campsite', 'attraction']]],
        [
          'in',
          ['get', 'subclass'],
          [
            'literal',
            [
              'alpine_hut',
              'wilderness_hut',
              'shelter',
              'drinking_water',
              'viewpoint',
              'guidepost',
            ],
          ],
        ],
      ],
      layout: {
        'icon-image': [
          'match',
          ['get', 'subclass'],
          'drinking_water',
          basemapImageIds.drinkingWater,
          ['alpine_hut', 'wilderness_hut'],
          basemapImageIds.hut,
          'shelter',
          basemapImageIds.shelter,
          'viewpoint',
          basemapImageIds.viewpoint,
          'guidepost',
          basemapImageIds.guidepost,
          [
            'match',
            ['get', 'class'],
            'campsite',
            basemapImageIds.campSite,
            basemapImageIds.attraction,
          ],
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
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
      layout: { ...labelLayout, 'text-radial-offset': 1 },
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
      filter: ['in', ['get', 'class'], ['literal', ['peak', 'volcano']]],
      paint: {
        'circle-color': mapVisualPalette.text.secondary,
        'circle-radius': 3,
        'circle-stroke-color': mapVisualPalette.text.haloVector,
        'circle-stroke-width': 1,
      },
    },
    {
      id: mapLayerIds.mountainPasses,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.peaks,
      minzoom: 9,
      filter: ['==', ['get', 'class'], 'saddle'],
      layout: {
        'icon-image': basemapImageIds.mountainPass,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: mapLayerIds.ridges,
      type: 'line',
      source,
      'source-layer': sourceLayers.peaks,
      minzoom: 13,
      filter: ['==', ['get', 'class'], 'ridge'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapVisualPalette.terrain.ridge,
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 16, 1],
        ...mapVisualModePaint.vector[mapLayerIds.ridges],
      },
    },
    {
      id: mapLayerIds.cliffs,
      type: 'line',
      source,
      'source-layer': sourceLayers.peaks,
      minzoom: 13,
      filter: ['==', ['get', 'class'], 'cliff'],
      paint: {
        'line-pattern': basemapImageIds.cliffPattern,
        'line-width': 10,
      },
    },
    {
      id: mapLayerIds.peakLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.peaks,
      minzoom: 10,
      filter: ['in', ['get', 'class'], ['literal', ['peak', 'volcano', 'saddle']]],
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
        'text-size': 12,
      },
      paint: {
        'text-color': mapVisualPalette.text.secondary,
        'text-halo-color': mapVisualPalette.text.haloVector,
        'text-halo-width': 1,
      },
    },
    {
      id: mapLayerIds.riverLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.waterways,
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
    },
    {
      id: mapLayerIds.ridgeLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.peaks,
      minzoom: 13,
      filter: ['==', ['get', 'class'], 'ridge'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 250,
        'text-field': englishFirstLabelExpression,
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
      },
      paint: {
        'text-color': mapVisualPalette.terrain.ridge,
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
          ['match', ['get', 'class'], 'city', 16, 13],
          12,
          ['match', ['get', 'class'], 'city', 19, 14],
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
      [mapSourceIds.basemapDetailVector]: {
        type: 'vector',
        url: configuration.detailVector.tileJsonUrl,
        attribution: configuration.detailVector.attribution,
      },
      [mapSourceIds.satelliteBasemap]: {
        type: 'raster',
        tiles: [...configuration.satelliteBasemap.tileUrls],
        tileSize: configuration.satelliteBasemap.tileSize,
        attribution: configuration.satelliteBasemap.attribution,
      },
      [mapSourceIds.bingSatelliteBasemap]: {
        type: 'raster',
        tiles: [...configuration.bingSatelliteBasemap.tileUrls],
        tileSize: configuration.bingSatelliteBasemap.tileSize,
        attribution: configuration.bingSatelliteBasemap.attribution,
      },
      [mapSourceIds.esriSatelliteBasemap]: {
        type: 'raster',
        tiles: [...configuration.esriSatelliteBasemap.tileUrls],
        tileSize: configuration.esriSatelliteBasemap.tileSize,
        attribution: configuration.esriSatelliteBasemap.attribution,
      },
      [naprOrthophotoSourceIds.national2016To2017]: {
        type: 'raster',
        tiles: [...configuration.naprOrthophoto.sources.national2016To2017.tileUrls],
        tileSize: configuration.naprOrthophoto.sources.national2016To2017.tileSize,
        minzoom: configuration.naprOrthophoto.sources.national2016To2017.minZoom,
        maxzoom: configuration.naprOrthophoto.sources.national2016To2017.maxZoom,
        bounds: [...configuration.naprOrthophoto.sources.national2016To2017.bounds],
        attribution: configuration.naprOrthophoto.attribution,
      },
      [naprOrthophotoSourceIds.westernGeorgia2020]: {
        type: 'raster',
        tiles: [...configuration.naprOrthophoto.sources.westernGeorgia2020.tileUrls],
        tileSize: configuration.naprOrthophoto.sources.westernGeorgia2020.tileSize,
        minzoom: configuration.naprOrthophoto.sources.westernGeorgia2020.minZoom,
        maxzoom: configuration.naprOrthophoto.sources.westernGeorgia2020.maxZoom,
        bounds: [...configuration.naprOrthophoto.sources.westernGeorgia2020.bounds],
        attribution: configuration.naprOrthophoto.attribution,
      },
      [naprOrthophotoSourceIds.kutaisi2020]: {
        type: 'raster',
        tiles: [...configuration.naprOrthophoto.sources.kutaisi2020.tileUrls],
        tileSize: configuration.naprOrthophoto.sources.kutaisi2020.tileSize,
        minzoom: configuration.naprOrthophoto.sources.kutaisi2020.minZoom,
        maxzoom: configuration.naprOrthophoto.sources.kutaisi2020.maxZoom,
        bounds: [...configuration.naprOrthophoto.sources.kutaisi2020.bounds],
        attribution: configuration.naprOrthophoto.attribution,
      },
      [naprOrthophotoSourceIds.racha2025]: {
        type: 'raster',
        tiles: [...configuration.naprOrthophoto.sources.racha2025.tileUrls],
        tileSize: configuration.naprOrthophoto.sources.racha2025.tileSize,
        minzoom: configuration.naprOrthophoto.sources.racha2025.minZoom,
        maxzoom: configuration.naprOrthophoto.sources.racha2025.maxZoom,
        bounds: [...configuration.naprOrthophoto.sources.racha2025.bounds],
        attribution: configuration.naprOrthophoto.attribution,
      },
    },
    layers: [
      ...createBasemapLayers(
        configuration.vector.sourceLayers,
        configuration.detailVector.sourceLayers,
      ),
    ],
  };
}
