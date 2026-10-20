import {
  createExpression,
  featureFilter,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';

import { romanizePlaceLabel } from '@/domain/tracks/trackNaming';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  basemapImageIds,
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
  it('passes the MapLibre style specification validator', () => {
    expect(validateStyleMin(createHikingMapStyle(configuration))).toEqual([]);
  });

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
    expect(style.sources[mapSourceIds.bingSatelliteBasemap]).toEqual({
      type: 'raster',
      tiles: [
        'https://ecn.t0.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1&mkt=en-US&n=z',
        'https://ecn.t1.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1&mkt=en-US&n=z',
        'https://ecn.t2.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1&mkt=en-US&n=z',
        'https://ecn.t3.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1&mkt=en-US&n=z',
      ],
      tileSize: 256,
      attribution:
        '<a href="https://www.microsoft.com/maps/product/terms.html" target="_blank">© Microsoft Bing</a>',
    });
    expect(style.sources[mapSourceIds.esriSatelliteBasemap]).toEqual({
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        '<a href="https://www.esri.com/" target="_blank">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
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
      satelliteBasemapLayerIds.bing,
      satelliteBasemapLayerIds.esri,
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
      mapLayerIds.protectedAreaLabels,
      mapLayerIds.waterLabels,
    ]);
  });

  it('keeps every 3D-draped basemap layer below the first icon or label layer', () => {
    // MapLibre drapes consecutive layers of these types into one texture per terrain
    // tile; any other layer between them starts another full set of 3D textures.
    const drapedLayerTypes: Record<string, true> = {
      background: true,
      fill: true,
      line: true,
      raster: true,
      hillshade: true,
    };
    const layers = createHikingMapStyle(configuration).layers;
    const firstUndrapedIndex = layers.findIndex(
      (layer) => drapedLayerTypes[layer.type] !== true,
    );

    expect(layers[firstUndrapedIndex]?.id).toBe(
      mapInsertionPoints.importedTracksBeforeLayerId,
    );
    expect(
      layers
        .slice(firstUndrapedIndex)
        .filter((layer) => drapedLayerTypes[layer.type] === true)
        .map((layer) => layer.id),
    ).toEqual([]);
  });

  it('applies paint changes instantly so 3D-draped textures never freeze mid-fade', () => {
    // MapLibre redraws draped terrain textures only on the first frame of a paint change;
    // a transition would leave OSM fills stuck at their previous opacity in 3D.
    expect(createHikingMapStyle(configuration).transition).toEqual({
      duration: 0,
      delay: 0,
    });
  });

  it('renders Shortbread brownfields, buildings, service roads, and detailed paths', () => {
    const style = createHikingMapStyle(configuration);
    const orderedLayerIds = style.layers.map((layer) => layer.id);
    const brownfields = style.layers.find(
      (layer) => layer.id === mapLayerIds.brownfieldAreas,
    );
    const buildings = style.layers.find((layer) => layer.id === mapLayerIds.buildings);
    const roads = style.layers.find((layer) => layer.id === mapLayerIds.roads);
    const overviewPaths = style.layers.find(
      (layer) => layer.id === mapLayerIds.hikingPaths,
    );
    const detailPaths = style.layers.find(
      (layer) => layer.id === mapLayerIds.hikingPathDetails,
    );
    const bridleways = style.layers.find(
      (layer) => layer.id === mapLayerIds.hikingBridleways,
    );
    const steps = style.layers.find((layer) => layer.id === mapLayerIds.hikingSteps);

    expect(style.sources[mapSourceIds.basemapDetailVector]).toEqual({
      type: 'vector',
      url: 'https://vector.openstreetmap.org/shortbread_v1/tilejson.json',
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
    });
    expect(brownfields).toMatchObject({
      type: 'fill',
      source: mapSourceIds.basemapDetailVector,
      'source-layer': 'land',
      filter: ['==', ['get', 'kind'], 'brownfield'],
      paint: {
        'fill-antialias': false,
        'fill-color': mapVisualPalette.base.brownfield,
        'fill-opacity': 1,
      },
    });
    expect(buildings).toMatchObject({
      type: 'fill',
      source: mapSourceIds.basemapDetailVector,
      'source-layer': 'buildings',
      paint: {
        'fill-antialias': false,
        'fill-color': mapVisualPalette.base.building,
        'fill-opacity': 1,
      },
    });
    expect(roads).toMatchObject({
      type: 'line',
      source: mapSourceIds.basemapDetailVector,
      'source-layer': 'streets',
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
      },
    });
    expect(overviewPaths).toMatchObject({
      source: mapSourceIds.basemapVector,
      maxzoom: 13,
    });
    expect(detailPaths).toMatchObject({
      source: mapSourceIds.basemapDetailVector,
      'source-layer': 'streets',
      minzoom: 13,
      filter: [
        'in',
        ['get', 'kind'],
        ['literal', ['track', 'footway', 'path', 'cycleway', 'pedestrian']],
      ],
      paint: { 'line-color': mapVisualPalette.transport.path, 'line-opacity': 0.9 },
    });
    expect(bridleways).toMatchObject({
      source: mapSourceIds.basemapVector,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: ['==', ['get', 'subclass'], 'bridleway'],
    });
    expect(steps).toMatchObject({
      source: mapSourceIds.basemapDetailVector,
      'source-layer': 'streets',
      minzoom: 13,
      filter: ['==', ['get', 'kind'], 'steps'],
    });
    expect(
      orderedLayerIds.slice(
        orderedLayerIds.indexOf(mapLayerIds.landuse) + 1,
        orderedLayerIds.indexOf(mapLayerIds.landuse) + 4,
      ),
    ).toEqual([
      mapLayerIds.cemeteries,
      mapLayerIds.brownfieldAreas,
      mapLayerIds.restrictedAreas,
    ]);
    expect(
      orderedLayerIds.slice(
        orderedLayerIds.indexOf(mapLayerIds.water) + 1,
        orderedLayerIds.indexOf(mapLayerIds.water) + 3,
      ),
    ).toEqual([mapLayerIds.buildings, mapLayerIds.boundaries]);
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

  it('draws land country borders black and disputed-territory lines as a red dash', () => {
    const style = createHikingMapStyle(configuration);
    const boundaryLayerIds = [
      mapLayerIds.boundaries,
      mapLayerIds.countryBorders,
      mapLayerIds.disputedBorders,
    ];
    // Property sets as published in OpenFreeMap boundary tiles.
    const layersDrawing = (properties: Record<string, string | number>) =>
      boundaryLayerIds.filter((layerId) => {
        const layer = style.layers.find((candidate) => candidate.id === layerId);
        if (layer?.type !== 'line') throw new Error(`Missing line layer ${layerId}`);
        return featureFilter(layer.filter, 'filter').filter(
          { zoom: 10 },
          { type: 2, properties },
        );
      });

    expect(
      layersDrawing({
        disputed: 1,
        disputed_name: 'Territory',
        maritime: 0,
        admin_level: 3,
      }),
    ).toEqual([mapLayerIds.disputedBorders]);
    expect(
      layersDrawing({
        disputed: 1,
        disputed_name: 'Territory',
        maritime: 0,
        admin_level: 2,
      }),
    ).toEqual([mapLayerIds.countryBorders]);
    expect(
      layersDrawing({
        adm0_l: 'GEO',
        adm0_r: 'ARM',
        disputed: 0,
        maritime: 0,
        admin_level: 2,
      }),
    ).toEqual([mapLayerIds.countryBorders]);
    expect(
      layersDrawing({ adm0_r: 'GEO', disputed: 0, maritime: 1, admin_level: 2 }),
    ).toEqual([mapLayerIds.boundaries]);
    expect(
      layersDrawing({ disputed: 1, disputed_name: 'Sea', maritime: 1, admin_level: 2 }),
    ).toEqual([mapLayerIds.boundaries]);
    expect(layersDrawing({ disputed: 0, maritime: 0, admin_level: 4 })).toEqual([
      mapLayerIds.boundaries,
    ]);
    expect(layersDrawing({ disputed: 0, maritime: 0, admin_level: 3 })).toEqual([]);

    const country = style.layers.find(
      (layer) => layer.id === mapLayerIds.countryBorders,
    );
    const disputed = style.layers.find(
      (layer) => layer.id === mapLayerIds.disputedBorders,
    );
    expect(country).toHaveProperty(
      'paint.line-color',
      mapVisualPalette.boundary.country,
    );
    expect(country).not.toHaveProperty('paint.line-dasharray');
    expect(disputed).toHaveProperty(
      'paint.line-color',
      mapVisualPalette.boundary.disputed,
    );
    expect(disputed).toHaveProperty('paint.line-dasharray');
  });

  it('labels each protected area once from its provider point, not along its polygon', () => {
    const style = createHikingMapStyle(configuration);
    const labels = style.layers.find(
      (layer) => layer.id === mapLayerIds.protectedAreaLabels,
    );
    if (labels?.type !== 'symbol') throw new Error('Missing protected-area labels');
    const filter = featureFilter(labels.filter, 'filter');
    const properties = { class: 'national_park', name: 'Park' };

    expect(filter.filter({ zoom: 12 }, { type: 1, properties })).toBe(true);
    expect(filter.filter({ zoom: 12 }, { type: 3, properties })).toBe(false);
  });

  it('draws national parks and reserves but leaves protected landscapes out', () => {
    const style = createHikingMapStyle(configuration);
    // Classes observed in OpenFreeMap park tiles over Georgia; each layer is checked
    // with the geometry it draws: polygons for sign and outline, points for the name.
    const drawn = (protectionClass: string) =>
      (
        [
          [mapLayerIds.protectedAreas, 3],
          [mapLayerIds.protectedAreaOutlines, 3],
          [mapLayerIds.protectedAreaLabels, 1],
        ] as const
      ).map(([layerId, type]) => {
        const layer = style.layers.find((candidate) => candidate.id === layerId);
        if (layer === undefined || !('filter' in layer)) throw new Error(layerId);
        return featureFilter(layer.filter, 'filter').filter(
          { zoom: 12 },
          { type, properties: { class: protectionClass } },
        );
      });

    for (const protectionClass of ['national_park', 'sustainable', 'nature_reserve']) {
      expect(drawn(protectionClass)).toEqual([true, true, true]);
    }
    expect(drawn('conservation')).toEqual([false, false, false]);
  });

  it('labels English first and romanizes native names like track names', () => {
    const parsed = createExpression(englishFirstLabelExpression, 'text-field');
    if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
    const label = (properties: Record<string, string>) =>
      parsed.value.evaluate({ zoom: 14 }, { type: 'Point', properties }) as string;

    expect(label({ 'name:en': 'Keli Pass', name: 'Кельский' })).toBe('Keli Pass');
    expect(label({ 'name:en': 'Qelitsadi Lake', name: 'ყელიცადის ტბა' })).toBe(
      'Kelitsadi Lake',
    );
    expect(label({ 'name:en': 'Mosque Square', name: 'მეჩეთის მოედანი' })).toBe(
      'Mosque Square',
    );
    expect(label({ 'name:en': 'Qatar', 'name:ka': 'კატარი', name: 'قطر' })).toBe(
      'Qatar',
    );
    for (const nativeName of [
      'ესის უღელტეხილი',
      'ჭაუხის ორმაგი უღელტეხილი',
      '\u1C9B\u1C94\u1CA1\u1CA2\u1C98\u1C90',
      'Верхние ночевки',
      'Ёлка',
      'Хъелы хох',
      'სტეფანწმინდა — გველეთი',
    ]) {
      expect(label({ name_en: nativeName, name: nativeName })).toBe(
        romanizePlaceLabel(nativeName),
      );
    }
    expect(label({})).toBe('');

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

  it('draws passes as crosses, GOST cliffs, fords, and hiking and historic POIs without hotels', () => {
    const style = createHikingMapStyle(configuration);
    const layer = (id: string) => style.layers.find((candidate) => candidate.id === id);

    expect(layer(mapLayerIds.peaks)).toHaveProperty('filter', [
      'in',
      ['get', 'class'],
      ['literal', ['peak', 'volcano']],
    ]);
    expect(layer(mapLayerIds.mountainPasses)).toMatchObject({
      type: 'symbol',
      'source-layer': 'mountain_peak',
      filter: ['==', ['get', 'class'], 'saddle'],
      layout: { 'icon-image': basemapImageIds.mountainPass },
    });
    expect(layer(mapLayerIds.cliffs)).toMatchObject({
      type: 'line',
      'source-layer': 'mountain_peak',
      filter: ['==', ['get', 'class'], 'cliff'],
      paint: { 'line-pattern': basemapImageIds.cliffPattern },
    });
    expect(layer(mapLayerIds.fords)).toMatchObject({
      type: 'symbol',
      'source-layer': 'transportation',
      filter: ['==', ['get', 'brunnel'], 'ford'],
      layout: { 'icon-image': basemapImageIds.ford },
    });
    const pois = layer(mapLayerIds.hikingPois);
    const poiFilter = featureFilter(
      pois && 'filter' in pois ? pois.filter : undefined,
      'filter',
    );
    const showsPoi = (properties: Record<string, string>) =>
      poiFilter.filter({ zoom: 14 }, { type: 1, properties });
    expect(showsPoi({ class: 'lodging', subclass: 'alpine_hut' })).toBe(true);
    expect(showsPoi({ class: 'drinking_water', subclass: 'drinking_water' })).toBe(
      true,
    );
    expect(showsPoi({ class: 'information', subclass: 'guidepost' })).toBe(true);
    expect(showsPoi({ class: 'lodging', subclass: 'hotel' })).toBe(false);
    expect(showsPoi({ class: 'lodging', subclass: 'guest_house' })).toBe(false);
    if (pois?.type !== 'symbol') throw new Error('Missing hiking POI symbol layer');
    const iconImage = createExpression(pois.layout?.['icon-image'], 'icon-image');
    if (iconImage.result !== 'success') throw new Error('Invalid POI icon expression');
    const poiIcon = (properties: Record<string, string>) =>
      iconImage.value.evaluate({ zoom: 14 }, { type: 'Point', properties }) as unknown;
    for (const subclass of ['castle', 'ruins']) {
      expect(showsPoi({ class: 'castle', subclass })).toBe(true);
    }
    expect(poiIcon({ class: 'castle', subclass: 'castle' })).toBe(
      basemapImageIds.castle,
    );
    expect(poiIcon({ class: 'castle', subclass: 'ruins' })).toBe(basemapImageIds.ruins);
    expect(poiIcon({ class: 'attraction', subclass: 'attraction' })).toBe(
      basemapImageIds.attraction,
    );
  });

  it('draws GOST signs for vegetation, plantings, swamps, scree, and cemeteries', () => {
    const style = createHikingMapStyle(configuration);
    const signFor = (layerId: string, properties: Record<string, string>) => {
      const layer = style.layers.find((candidate) => candidate.id === layerId);
      if (layer?.type !== 'fill') throw new Error(`Missing fill layer ${layerId}`);
      const feature = { type: 3 as const, properties };
      if (!featureFilter(layer.filter, 'filter').filter({ zoom: 14 }, feature))
        return null;
      const pattern = createExpression(layer.paint?.['fill-pattern'], 'fill-pattern');
      if (pattern.result !== 'success') throw new Error(JSON.stringify(pattern.value));
      return pattern.value.evaluate({ zoom: 14 }, feature) as unknown;
    };
    const provider = mapLayerIds.landcoverPatterns;
    const detail = mapLayerIds.landcoverPatternDetails;

    expect(signFor(provider, { class: 'wood', subclass: 'forest' })).toBe(
      basemapImageIds.forestPattern,
    );
    expect(signFor(provider, { class: 'grass', subclass: 'scrub' })).toBe(
      basemapImageIds.scrubPattern,
    );
    expect(signFor(provider, { class: 'farmland', subclass: 'vineyard' })).toBe(
      basemapImageIds.plantationPattern,
    );
    expect(signFor(provider, { class: 'farmland', subclass: 'orchard' })).toBe(
      basemapImageIds.plantationPattern,
    );
    expect(signFor(provider, { class: 'wetland', subclass: 'wetland' })).toBe(
      basemapImageIds.wetlandPattern,
    );
    expect(signFor(provider, { class: 'grass', subclass: 'meadow' })).toBeNull();
    expect(signFor(detail, { kind: 'bog' })).toBe(basemapImageIds.wetlandPattern);
    expect(signFor(detail, { kind: 'vineyard' })).toBe(
      basemapImageIds.plantationPattern,
    );
    expect(signFor(detail, { kind: 'scree' })).toBe(basemapImageIds.screePattern);
    expect(signFor(detail, { kind: 'brownfield' })).toBeNull();
    expect(signFor(mapLayerIds.cemeteries, { kind: 'grave_yard' })).toBe(
      basemapImageIds.cemeteryPattern,
    );

    const detailFill = style.layers.find(
      (candidate) => candidate.id === mapLayerIds.landcoverDetails,
    );
    if (detailFill?.type !== 'fill') throw new Error('Missing detail fill layer');
    const fillFor = (kind: string) => {
      const feature = { type: 3 as const, properties: { kind } };
      if (!featureFilter(detailFill.filter, 'filter').filter({ zoom: 14 }, feature)) {
        return null;
      }
      const color = createExpression(detailFill.paint?.['fill-color'], 'fill-color');
      if (color.result !== 'success') throw new Error(JSON.stringify(color.value));
      return String(color.value.evaluate({ zoom: 14 }, feature));
    };
    // Shortbread-only areas get the fill their signs belong to; swamps stay plain land.
    expect(fillFor('forest')).toBe(mapVisualPalette.vegetation.forest);
    expect(fillFor('vineyard')).toBe(mapVisualPalette.vegetation.farmland);
    expect(fillFor('bog')).toBeNull();
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
      detailVector: {
        ...configuration.detailVector,
        sourceLayers: {
          ...configuration.detailVector.sourceLayers,
          land: 'fixture_land',
          buildings: 'fixture_buildings',
          streets: 'fixture_streets',
        },
      },
    };
    const style = createHikingMapStyle(customConfiguration);
    const hikingPaths = style.layers.find(
      (layer) => layer.id === mapLayerIds.hikingPaths,
    );
    const peaks = style.layers.find((layer) => layer.id === mapLayerIds.peaks);
    const ridges = style.layers.find((layer) => layer.id === mapLayerIds.ridges);

    const brownfields = style.layers.find(
      (layer) => layer.id === mapLayerIds.brownfieldAreas,
    );
    const buildings = style.layers.find((layer) => layer.id === mapLayerIds.buildings);
    const roads = style.layers.find((layer) => layer.id === mapLayerIds.roads);
    expect(hikingPaths).toHaveProperty('source-layer', 'fixture_transport');
    expect(peaks).toHaveProperty('source-layer', 'fixture_peaks');
    expect(ridges).toHaveProperty('source-layer', 'fixture_peaks');
    expect(brownfields).toHaveProperty('source-layer', 'fixture_land');
    expect(buildings).toHaveProperty('source-layer', 'fixture_buildings');
    expect(roads).toHaveProperty('source-layer', 'fixture_streets');
  });
});
