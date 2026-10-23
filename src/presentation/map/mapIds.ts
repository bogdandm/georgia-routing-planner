import type { MarkerColorKey, MarkerIconKey } from '@/domain/markers/savedMarker';

export const mapSourceIds = {
  basemapVector: 'basemap-vector',
  basemapDetailVector: 'basemap-detail-vector',
  terrainDem: 'terrain-dem',
  terrainContours: 'terrain-contours',
  weatherClouds: 'weather-clouds',
  weatherPrecipitation: 'weather-precipitation',
  weatherWind: 'weather-wind',
  satelliteBasemap: 'satellite-basemap',
  bingSatelliteBasemap: 'bing-satellite-basemap',
  esriSatelliteBasemap: 'esri-satellite-basemap',
  sentinelRasterA: 'sentinel-raster-a',
  sentinelRasterB: 'sentinel-raster-b',
  sentinelFootprint: 'sentinel-footprint',
  importedTrack: 'imported-track',
  importedTrackHighlight: 'imported-track-highlight',
  importedTrackFocusA: 'imported-track-focus-a',
  importedTrackFocusB: 'imported-track-focus-b',
  importedTrackTrace: 'imported-track-trace',
  importedTrackEndpoints: 'imported-track-endpoints',
  routePlan: 'route-plan',
  routeSearch: 'route-search',
  measurement: 'measurement',
  trackPointSelection: 'track-point-selection',
  savedMarkers: 'saved-markers',
} as const;

export const sentinelMosaicIdPrefixes = {
  source: 'sentinel-mosaic-source-',
  layer: 'sentinel-mosaic-layer-',
} as const;

export const naprOrthophotoSourceIds = {
  national2016To2017: 'napr-orthophoto-2016-2017',
  westernGeorgia2020: 'napr-orthophoto-2020-west',
  kutaisi2020: 'napr-orthophoto-2020-kutaisi',
  racha2025: 'napr-orthophoto-2025-racha',
} as const;

export const sovietTopographicSourceIds = {
  nationwide25k: 'soviet-topographic-25k',
  detailed10k: 'soviet-topographic-10k',
} as const;

export const terrainOverlayLayerIds = {
  reliefShade: 'terrain-relief-shade',
  contourMinor: 'terrain-contour-minor',
  contourIndex: 'terrain-contour-index',
  contourLabels: 'terrain-contour-labels',
} as const;
export const weatherMapLayerIds = {
  clouds: 'weather-clouds',
  precipitation: 'weather-precipitation',
  wind: 'weather-wind-arrows',
} as const;

export const sentinelMapLayerIds = {
  rasterA: 'sentinel-raster-a',
  rasterB: 'sentinel-raster-b',
  footprint: 'sentinel-footprint',
} as const;

export const satelliteBasemapLayerIds = {
  imagery: 'satellite-basemap-imagery',
  bing: 'bing-satellite-basemap-imagery',
  esri: 'esri-satellite-basemap-imagery',
} as const;

export const naprOrthophotoLayerIds = {
  national2016To2017: 'napr-orthophoto-2016-2017-imagery',
  westernGeorgia2020: 'napr-orthophoto-2020-west-imagery',
  kutaisi2020: 'napr-orthophoto-2020-kutaisi-imagery',
  racha2025: 'napr-orthophoto-2025-racha-imagery',
} as const;

export const sovietTopographicLayerIds = {
  nationwide25k: 'soviet-topographic-25k-imagery',
  detailed10k: 'soviet-topographic-10k-imagery',
} as const;

export const importedTrackLayerIds = {
  casing: 'imported-track-casing',
  line: 'imported-track-line',
  highlight: 'imported-track-highlight',
  focusCasingA: 'imported-track-focus-a-casing',
  focusLineA: 'imported-track-focus-a-line',
  focusHighlightA: 'imported-track-focus-a-highlight',
  focusCasingB: 'imported-track-focus-b-casing',
  focusLineB: 'imported-track-focus-b-line',
  focusHighlightB: 'imported-track-focus-b-highlight',
  endpoints: 'imported-track-endpoints',
  trace: 'imported-track-trace',
} as const;
export const importedTrackEndpointImageIds = {
  start: 'imported-track-start',
  finish: 'imported-track-finish',
} as const;
export const routePlanLayerIds = {
  routed: 'route-plan-routed',
  direct: 'route-plan-direct',
  preview: 'route-plan-preview',
  previewLabel: 'route-plan-preview-label',
  waypoints: 'route-plan-waypoints',
  waypointLabels: 'route-plan-waypoint-labels',
} as const;
export const routeSearchLayerIds = {
  casing: 'route-search-casing',
  arcs: 'route-search-arcs',
} as const;
export const measurementLayerIds = {
  routed: 'measurement-routed',
  direct: 'measurement-direct',
  preview: 'measurement-preview',
  previewLabel: 'measurement-preview-label',
  waypoints: 'measurement-waypoints',
  waypointLabels: 'measurement-waypoint-labels',
} as const satisfies Record<keyof typeof routePlanLayerIds, string>;
/** The selected track-point run and anchors, drawn above tracks and route plans. */
export const trackPointSelectionLayerIds = {
  line: 'track-point-selection-line',
  points: 'track-point-selection-points',
} as const;

export const savedMarkerLayerIds = {
  symbols: 'saved-marker-symbols',
} as const;

export function savedMarkerImageId(
  iconKey: MarkerIconKey,
  colorKey: MarkerColorKey,
): string {
  return `saved-marker-${iconKey}-${colorKey}`;
}

export const mapLayerIds = {
  background: 'basemap-background',
  landcover: 'basemap-landcover',
  glacierAreas: 'basemap-glacier-areas',
  landcoverDetails: 'basemap-landcover-details',
  landcoverPatterns: 'basemap-landcover-patterns',
  landcoverPatternDetails: 'basemap-landcover-pattern-details',
  landuse: 'basemap-landuse',
  cemeteries: 'basemap-cemeteries',
  brownfieldAreas: 'basemap-brownfield-areas',
  restrictedAreas: 'basemap-restricted-areas',
  protectedAreas: 'basemap-protected-areas',
  protectedAreaOutlines: 'basemap-protected-area-outlines',
  waterways: 'basemap-waterways',
  intermittentWaterways: 'basemap-intermittent-waterways',
  water: 'basemap-water',
  buildings: 'basemap-buildings',
  boundaries: 'basemap-boundaries',
  countryBorders: 'basemap-country-borders',
  disputedBorders: 'basemap-disputed-borders',
  roadCasings: 'basemap-road-casings',
  roads: 'basemap-roads',
  hikingPaths: 'basemap-hiking-paths',
  hikingPathDetails: 'basemap-hiking-path-details',
  hikingBridleways: 'basemap-hiking-bridleways',
  hikingSteps: 'basemap-hiking-steps',
  aerialways: 'basemap-aerialways',
  ridges: 'basemap-ridges',
  cliffs: 'basemap-cliffs',
  fords: 'basemap-fords',
  hikingPois: 'basemap-hiking-pois',
  hikingPoiLabels: 'basemap-hiking-poi-labels',
  peaks: 'basemap-peaks',
  mountainPasses: 'basemap-mountain-passes',
  peakLabels: 'basemap-peak-labels',
  roadLabels: 'basemap-road-labels',
  riverLabels: 'basemap-river-labels',
  ridgeLabels: 'basemap-ridge-labels',
  protectedAreaLabels: 'basemap-protected-area-labels',
  waterLabels: 'basemap-water-labels',
  placeLabels: 'basemap-place-labels',
} as const;

/** Icons and line patterns the basemap style references; generated on first use. */
export const basemapImageIds = {
  drinkingWater: 'basemap-drinking-water',
  hut: 'basemap-hut',
  shelter: 'basemap-shelter',
  campSite: 'basemap-camp-site',
  viewpoint: 'basemap-viewpoint',
  guidepost: 'basemap-guidepost',
  castle: 'basemap-castle',
  ruins: 'basemap-ruins',
  attraction: 'basemap-attraction',
  ford: 'basemap-ford',
  mountainPass: 'basemap-mountain-pass',
  cliffPattern: 'basemap-cliff-pattern',
  aerialwayPattern: 'basemap-aerialway-pattern',
  wetlandPattern: 'basemap-wetland-pattern',
  forestPattern: 'basemap-forest-pattern',
  scrubPattern: 'basemap-scrub-pattern',
  plantationPattern: 'basemap-plantation-pattern',
  screePattern: 'basemap-scree-pattern',
  cemeteryPattern: 'basemap-cemetery-pattern',
  protectedAreaPattern: 'basemap-protected-area-pattern',
  protectedAreaSparsePattern: 'basemap-protected-area-sparse-pattern',
} as const;

/**
 * 3D terrain renders consecutive line, fill, raster, and hillshade layers into one draped
 * texture per terrain tile; every symbol or circle layer between them starts another full
 * set of textures and terrain passes. Lines and fills therefore stay below the first
 * basemap icon layer, and labels and icons sit above all of them.
 */
export const mapInsertionPoints = {
  satelliteBeforeLayerId: mapLayerIds.landcover,
  // Relief needs to render over opaque land-cover and land-use fills.
  terrainOverlaysBeforeLayerId: mapLayerIds.boundaries,
  // Water polygons mask generated terrain contours while waterways remain visible.
  contoursBeforeLayerId: mapLayerIds.water,
  contourLabelsBeforeLayerId: mapLayerIds.hikingPoiLabels,
  // Weather stays below roads, hiking paths, labels, user routes, and markers.
  weatherBeforeLayerId: mapLayerIds.roadCasings,
  // User routes, tracks, and the Sentinel scene footprint are the last lines, directly
  // below the first basemap icons.
  satelliteFootprintBeforeLayerId: mapLayerIds.fords,
  importedTracksBeforeLayerId: mapLayerIds.fords,
} as const;
