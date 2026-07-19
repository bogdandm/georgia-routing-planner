export const mapSourceIds = {
  basemapVector: 'basemap-vector',
  terrainDem: 'terrain-dem',
  sentinelRasterA: 'sentinel-raster-a',
  sentinelRasterB: 'sentinel-raster-b',
  sentinelFootprint: 'sentinel-footprint',
} as const;

export const sentinelMapLayerIds = {
  rasterA: 'sentinel-raster-a',
  rasterB: 'sentinel-raster-b',
  footprint: 'sentinel-footprint',
} as const;

export const mapLayerIds = {
  background: 'basemap-background',
  landcover: 'basemap-landcover',
  landuse: 'basemap-landuse',
  parks: 'basemap-parks',
  water: 'basemap-water',
  waterways: 'basemap-waterways',
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
  waterLabels: 'basemap-water-labels',
  placeLabels: 'basemap-place-labels',
} as const;

export const mapInsertionPoints = {
  satelliteBeforeLayerId: mapLayerIds.water,
  satelliteFootprintBeforeLayerId: mapLayerIds.roadLabels,
  terrainShadingBeforeLayerId: mapLayerIds.boundaries,
  userOverlaysAfterLayerId: mapLayerIds.placeLabels,
} as const;
