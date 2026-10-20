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
  sovietTopographicLayerIds,
  sovietTopographicSourceIds,
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

/** Land-cover kinds with a GOST sign; both providers use these OSM values. */
const patternedLandcoverSubclasses = [
  'scrub',
  'shrubbery',
  'heath',
  'orchard',
  'vineyard',
  'plant_nursery',
  'scree',
  'shingle',
];

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
 * Georgian (Mkhedruli/Mtavruli) and Cyrillic. On features with a Georgian name, Latin
 * `q` not followed by `u` is written `k`: OSM English names keep the national system's
 * `q` for ყ (Qelitsadi Lake), while signs and guides write Kelitsadi.
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
  const georgianQ: ExpressionSpecification = [
    'all',
    ['var', 'georgianName'],
    ['!=', ['downcase', ['slice', label, index + 1, index + 2]], 'u'],
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
          ['case', georgianQ, 'k', 'q'],
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
 * result is romanized like track names (Georgian road-sign style, BGN/PCGN Cyrillic)
 * so the map never shows Georgian or Cyrillic script.
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
  // Only the native `name` decides: `name:ka` also exists on foreign places (Qatar).
  'georgianName',
  [
    'let',
    'initial',
    ['downcase', ['slice', ['coalesce', ['get', 'name'], ''], 0, 1]],
    ['all', ['>=', ['var', 'initial'], 'ა'], ['<=', ['var', 'initial'], 'ჿ']],
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

/**
 * Protected land drawn by the style. `conservation` (protected landscapes) covers
 * inhabited and farmed land too broadly to mark as a reserve, so it is left out.
 */
const protectedAreaFilter: ExpressionSpecification = [
  '!=',
  ['get', 'class'],
  'conservation',
];

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
      id: sovietTopographicLayerIds.nationwide25k,
      type: 'raster',
      source: sovietTopographicSourceIds.nationwide25k,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0 },
    },
    {
      id: sovietTopographicLayerIds.detailed10k,
      type: 'raster',
      source: sovietTopographicSourceIds.detailed10k,
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
      // Fills Shortbread areas OpenMapTiles omits with the same colours, so their signs sit
      // on the matching fill; swamps stay plain land, as GOST draws them.
      id: mapLayerIds.landcoverDetails,
      type: 'fill',
      source: detailSource,
      'source-layer': detailSourceLayers.land,
      minzoom: 12,
      filter: [
        'in',
        ['get', 'kind'],
        [
          'literal',
          ['forest', 'cemetery', 'grave_yard', ...patternedLandcoverSubclasses],
        ],
      ],
      paint: {
        'fill-antialias': false,
        'fill-color': [
          'match',
          ['get', 'kind'],
          'forest',
          mapVisualPalette.vegetation.forest,
          ['scrub', 'shrubbery', 'heath'],
          mapVisualPalette.vegetation.scrub,
          ['orchard', 'vineyard', 'plant_nursery'],
          mapVisualPalette.vegetation.farmland,
          ['scree', 'shingle'],
          mapVisualPalette.base.rock,
          mapVisualPalette.vegetation.grass,
        ],
        ...mapVisualModePaint.vector[mapLayerIds.landcoverDetails],
      },
    },
    {
      id: mapLayerIds.landcoverPatterns,
      type: 'fill',
      source,
      'source-layer': sourceLayers.landcover,
      minzoom: 10,
      filter: [
        'any',
        ['in', ['get', 'class'], ['literal', ['wetland', 'wood']]],
        ['in', ['get', 'subclass'], ['literal', patternedLandcoverSubclasses]],
      ],
      paint: {
        'fill-pattern': [
          'match',
          ['get', 'subclass'],
          ['scrub', 'shrubbery', 'heath'],
          basemapImageIds.scrubPattern,
          ['orchard', 'vineyard', 'plant_nursery'],
          basemapImageIds.plantationPattern,
          ['scree', 'shingle'],
          basemapImageIds.screePattern,
          [
            'match',
            ['get', 'class'],
            'wetland',
            basemapImageIds.wetlandPattern,
            basemapImageIds.forestPattern,
          ],
        ],
        ...mapVisualModePaint.vector[mapLayerIds.landcoverPatterns],
      },
    },
    {
      // Shortbread adds small bogs, orchards, and scree that OpenMapTiles omits; both
      // layers share the tile pattern grid, so overlapping areas look like one.
      id: mapLayerIds.landcoverPatternDetails,
      type: 'fill',
      source: detailSource,
      'source-layer': detailSourceLayers.land,
      minzoom: 12,
      filter: [
        'in',
        ['get', 'kind'],
        [
          'literal',
          [
            'bog',
            'string_bog',
            'marsh',
            'swamp',
            'reedbed',
            'wet_meadow',
            'forest',
            ...patternedLandcoverSubclasses,
          ],
        ],
      ],
      paint: {
        'fill-pattern': [
          'match',
          ['get', 'kind'],
          ['scrub', 'shrubbery', 'heath'],
          basemapImageIds.scrubPattern,
          ['orchard', 'vineyard', 'plant_nursery'],
          basemapImageIds.plantationPattern,
          ['scree', 'shingle'],
          basemapImageIds.screePattern,
          'forest',
          basemapImageIds.forestPattern,
          basemapImageIds.wetlandPattern,
        ],
        ...mapVisualModePaint.vector[mapLayerIds.landcoverPatternDetails],
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
      id: mapLayerIds.cemeteries,
      type: 'fill',
      source: detailSource,
      'source-layer': detailSourceLayers.land,
      minzoom: 12,
      filter: ['in', ['get', 'kind'], ['literal', ['cemetery', 'grave_yard']]],
      paint: {
        'fill-pattern': basemapImageIds.cemeteryPattern,
        ...mapVisualModePaint.vector[mapLayerIds.cemeteries],
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
      // Protected-land polygons: national parks, reserves, and other
      // `boundary=protected_area` land except protected landscapes. At country scale the
      // sign would only add noise, so the outline appears first and the NR sign follows
      // from z9; from z13 a sparser tile keeps a small visible area from filling with
      // signs.
      id: mapLayerIds.protectedAreas,
      type: 'fill',
      source,
      'source-layer': sourceLayers.parks,
      minzoom: 9,
      filter: protectedAreaFilter,
      paint: {
        'fill-pattern': [
          'step',
          ['zoom'],
          basemapImageIds.protectedAreaPattern,
          13,
          basemapImageIds.protectedAreaSparsePattern,
        ],
        ...mapVisualModePaint.vector[mapLayerIds.protectedAreas],
      },
    },
    {
      id: mapLayerIds.protectedAreaOutlines,
      type: 'line',
      source,
      'source-layer': sourceLayers.parks,
      minzoom: 7,
      filter: protectedAreaFilter,
      paint: {
        'line-color': mapVisualPalette.protectedArea.line,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 14, 2.5],
        ...mapVisualModePaint.vector[mapLayerIds.protectedAreaOutlines],
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
      // Region lines and every sea border, disputed or not; land country borders and
      // disputed land lines have their own layers below.
      id: mapLayerIds.boundaries,
      type: 'line',
      source,
      'source-layer': sourceLayers.boundaries,
      filter: [
        'all',
        ['in', ['get', 'admin_level'], ['literal', [2, 4]]],
        [
          'any',
          ['==', ['get', 'maritime'], 1],
          ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'disputed'], 1]],
        ],
      ],
      paint: {
        'line-color': mapVisualPalette.boundary.region,
        'line-dasharray': [3, 2],
        'line-width': ['match', ['get', 'admin_level'], 2, 1.5, 0.8],
        ...mapVisualModePaint.vector[mapLayerIds.boundaries],
      },
    },
    {
      // Includes disputed country-level segments: they still separate two countries.
      id: mapLayerIds.countryBorders,
      type: 'line',
      source,
      'source-layer': sourceLayers.boundaries,
      filter: [
        'all',
        ['==', ['get', 'admin_level'], 2],
        ['!=', ['get', 'maritime'], 1],
      ],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': mapVisualPalette.boundary.country,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 1.8, 14, 2.6],
        ...mapVisualModePaint.vector[mapLayerIds.countryBorders],
      },
    },
    {
      // OpenMapTiles flags lines of disputed territories below country level.
      id: mapLayerIds.disputedBorders,
      type: 'line',
      source,
      'source-layer': sourceLayers.boundaries,
      filter: [
        'all',
        ['==', ['get', 'disputed'], 1],
        ['!=', ['get', 'admin_level'], 2],
        ['!=', ['get', 'maritime'], 1],
      ],
      paint: {
        'line-color': mapVisualPalette.boundary.disputed,
        'line-dasharray': [2, 1.5],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 10, 2.5, 14, 3.5],
        ...mapVisualModePaint.vector[mapLayerIds.disputedBorders],
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
      // The provider publishes one point per protected area inside its polygon, so each
      // name is drawn once near the middle instead of repeating along the outline.
      id: mapLayerIds.protectedAreaLabels,
      type: 'symbol',
      source,
      'source-layer': sourceLayers.parks,
      minzoom: 8,
      filter: ['all', ['==', ['geometry-type'], 'Point'], protectedAreaFilter],
      layout: { ...labelLayout, 'text-size': 12 },
      paint: {
        'text-color': mapVisualPalette.protectedArea.label,
        ...mapVisualModePaint.vector[mapLayerIds.protectedAreaLabels],
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
    // In 3D, MapLibre draws fill, line, raster, and hillshade layers into cached terrain
    // textures on the first frame after a paint change and never redraws them while a
    // transition runs, so a fade freezes at its starting value until the camera moves.
    // Paint changes therefore apply instantly; animated fades step opacity per frame.
    transition: { duration: 0, delay: 0 },
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
      [sovietTopographicSourceIds.nationwide25k]: {
        type: 'raster',
        tiles: [...configuration.sovietTopographicMap.sources.nationwide25k.tileUrls],
        tileSize: configuration.sovietTopographicMap.sources.nationwide25k.tileSize,
        minzoom: configuration.sovietTopographicMap.sources.nationwide25k.minZoom,
        maxzoom: configuration.sovietTopographicMap.sources.nationwide25k.maxZoom,
        bounds: [...configuration.sovietTopographicMap.sources.nationwide25k.bounds],
        attribution: configuration.sovietTopographicMap.attribution,
      },
      [sovietTopographicSourceIds.detailed10k]: {
        type: 'raster',
        tiles: [...configuration.sovietTopographicMap.sources.detailed10k.tileUrls],
        tileSize: configuration.sovietTopographicMap.sources.detailed10k.tileSize,
        minzoom: configuration.sovietTopographicMap.sources.detailed10k.minZoom,
        maxzoom: configuration.sovietTopographicMap.sources.detailed10k.maxZoom,
        bounds: [...configuration.sovietTopographicMap.sources.detailed10k.bounds],
        attribution: configuration.sovietTopographicMap.attribution,
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
