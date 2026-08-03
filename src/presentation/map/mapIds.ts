export const mapSourceIds = {
  basemapVector: 'basemap-vector',
  terrainDem: 'terrain-dem',
  terrainContours: 'terrain-contours',
  sentinelRasterA: 'sentinel-raster-a',
  sentinelRasterB: 'sentinel-raster-b',
  sentinelFootprint: 'sentinel-footprint',
  importedTrack: 'imported-track',
  importedTrackHighlight: 'imported-track-highlight',
  importedTrackTrace: 'imported-track-trace',
} as const;

export const terrainOverlayLayerIds = {
  reliefShade: 'terrain-relief-shade',
  contourMinor: 'terrain-contour-minor',
  contourIndex: 'terrain-contour-index',
  contourLabels: 'terrain-contour-labels',
} as const;

export const sentinelMapLayerIds = {
  rasterA: 'sentinel-raster-a',
  rasterB: 'sentinel-raster-b',
  footprint: 'sentinel-footprint',
} as const;

export const importedTrackLayerIds = {
  casing: 'imported-track-casing',
  line: 'imported-track-line',
  highlight: 'imported-track-highlight',
  trace: 'imported-track-trace',
} as const;

export const mapLayerIds = {
  background: 'basemap-background',
  landcover: 'basemap-landcover',
  glacierAreas: 'basemap-glacier-areas',
  landuse: 'basemap-landuse',
  restrictedAreas: 'basemap-restricted-areas',
  parks: 'basemap-parks',
  waterways: 'basemap-waterways',
  water: 'basemap-water',
  boundaries: 'basemap-boundaries',
  roadCasings: 'basemap-road-casings',
  roads: 'basemap-roads',
  hikingPaths: 'basemap-hiking-paths',
  hikingSteps: 'basemap-hiking-steps',
  hikingPois: 'basemap-hiking-pois',
  hikingPoiLabels: 'basemap-hiking-poi-labels',
  peaks: 'basemap-peaks',
  peakLabels: 'basemap-peak-labels',
  roadLabels: 'basemap-road-labels',
  riverLabels: 'basemap-river-labels',
  waterLabels: 'basemap-water-labels',
  placeLabels: 'basemap-place-labels',
} as const;

export const mapInsertionPoints = {
  satelliteBeforeLayerId: mapLayerIds.landcover,
  // Relief needs to render over opaque land-cover and land-use fills.
  terrainOverlaysBeforeLayerId: mapLayerIds.boundaries,
  // Water polygons mask generated terrain contours while waterways remain visible.
  contoursBeforeLayerId: mapLayerIds.water,
  satelliteFootprintBeforeLayerId: mapLayerIds.roadLabels,
  importedTracksBeforeLayerId: mapLayerIds.hikingPoiLabels,
} as const;
