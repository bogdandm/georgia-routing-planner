import { mapLayerIds, terrainOverlayLayerIds } from '@/presentation/map/mapIds';
import { appColors } from '@/presentation/theme/appColors';

export type MapVisualMode = 'vector' | 'satellite';

/**
 * Semantic map colors shared by the vector basemap, satellite overlays, terrain, and
 * future user geometry. Colors retain their meaning between visual modes; only the
 * contrast paint below changes when imagery is visible.
 */
export const mapVisualPalette = {
  base: {
    background: appColors.surface.map,
    land: '#E5E3DC',
    built: '#D7D4CC',
    rock: '#CBCAC5',
    sand: '#E5D6B3',
    ice: '#F1F1EE',
  },
  vegetation: {
    forest: '#B5C69A',
    grass: '#DEE2DA',
    farmland: '#DFE0DA',
    scrub: '#C0CBA2',
    wetland: '#B3CBC0',
    park: '#C2CFA7',
  },
  glacier: {
    fill: '#DCE9ED',
  },
  water: {
    fill: '#78B7D5',
    line: '#78B7D5',
    label: '#075E7A',
  },
  transport: {
    casing: '#6E3C08',
    motorway: appColors.brand.tigerOrange,
    trunk: '#F49416',
    primary: '#F6A326',
    secondary: appColors.brand.amber,
    minor: '#F5BE69',
    path: '#D76A00',
    steps: '#A95100',
  },
  terrain: {
    contourMinor: appColors.brand.blueGreenDark,
    contourIndex: appColors.brand.deepSpace,
    contourLabel: appColors.brand.deepSpace,
    shadow: '#565A5C',
    highlight: '#F5F4EF',
    accent: '#898D8F',
  },
  restricted: {
    line: '#C95050',
  },
  boundary: '#656B70',
  point: '#365F70',
  text: {
    primary: '#29343A',
    secondary: '#58636A',
    haloVector: 'rgba(247, 246, 241, 0.92)',
    haloSatellite: 'rgba(255, 255, 255, 0.92)',
  },
  userGeometry: {
    /** Reserved for imported and user-created GPX tracks. */
    gpxTrack: '#168BFF',
    gpxTrackCasing: 'rgba(255, 255, 255, 0.78)',
    satelliteFootprint: '#FF8C1A',
  },
} as const;

export type MapVisualModePaint = Readonly<
  Record<string, Readonly<Record<string, string | number>>>
>;

/** Paint changes needed to preserve contrast without changing a feature's meaning. */
export const mapVisualModePaint = {
  vector: {
    [mapLayerIds.landcover]: { 'fill-opacity': 1 },
    [mapLayerIds.glacierAreas]: { 'fill-opacity': 1 },
    [mapLayerIds.landuse]: { 'fill-opacity': 1 },
    [mapLayerIds.restrictedAreas]: { 'line-opacity': 0.88 },
    [mapLayerIds.parks]: { 'fill-opacity': 0 },
    [mapLayerIds.waterways]: { 'line-opacity': 1 },
    [mapLayerIds.water]: { 'fill-opacity': 1 },
    [mapLayerIds.boundaries]: { 'line-opacity': 0.7 },
    [mapLayerIds.roadCasings]: { 'line-opacity': 0.46 },
    [mapLayerIds.roads]: { 'line-opacity': 0.86 },
    [mapLayerIds.hikingPaths]: { 'line-opacity': 0.9 },
    [mapLayerIds.hikingSteps]: { 'line-opacity': 0.9 },
    [mapLayerIds.hikingPois]: {
      'circle-opacity': 0.76,
      'circle-stroke-opacity': 1,
    },
    [mapLayerIds.peaks]: { 'circle-opacity': 1, 'circle-stroke-opacity': 1 },
    [terrainOverlayLayerIds.reliefShade]: { 'hillshade-exaggeration': 0.2 },
    [terrainOverlayLayerIds.contourMinor]: { 'line-opacity': 0.5 },
    [terrainOverlayLayerIds.contourIndex]: { 'line-opacity': 0.74 },
    [terrainOverlayLayerIds.contourLabels]: {
      'text-opacity': 1,
      'text-halo-color': 'rgba(247, 246, 241, 0.9)',
    },
    [mapLayerIds.hikingPoiLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloVector,
    },
    [mapLayerIds.peakLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloVector,
    },
    [mapLayerIds.roadLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloVector,
    },
    [mapLayerIds.waterLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloVector,
    },
    [mapLayerIds.placeLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloVector,
    },
  },
  satellite: {
    [mapLayerIds.landcover]: { 'fill-opacity': 0 },
    [mapLayerIds.glacierAreas]: { 'fill-opacity': 0 },
    [mapLayerIds.landuse]: { 'fill-opacity': 0 },
    [mapLayerIds.restrictedAreas]: { 'line-opacity': 0.8 },
    [mapLayerIds.parks]: { 'fill-opacity': 0 },
    [mapLayerIds.waterways]: { 'line-opacity': 1 },
    [mapLayerIds.water]: { 'fill-opacity': 0.38 },
    [mapLayerIds.boundaries]: { 'line-opacity': 0.7 },
    [mapLayerIds.roadCasings]: { 'line-opacity': 0.64 },
    [mapLayerIds.roads]: { 'line-opacity': 0.96 },
    [mapLayerIds.hikingPaths]: { 'line-opacity': 0.96 },
    [mapLayerIds.hikingSteps]: { 'line-opacity': 0.96 },
    [mapLayerIds.hikingPois]: {
      'circle-opacity': 0.76,
      'circle-stroke-opacity': 1,
    },
    [mapLayerIds.peaks]: { 'circle-opacity': 1, 'circle-stroke-opacity': 1 },
    [terrainOverlayLayerIds.reliefShade]: { 'hillshade-exaggeration': 0.14 },
    [terrainOverlayLayerIds.contourMinor]: { 'line-opacity': 0.72 },
    [terrainOverlayLayerIds.contourIndex]: { 'line-opacity': 0.9 },
    [terrainOverlayLayerIds.contourLabels]: {
      'text-opacity': 1,
      'text-halo-color': 'rgba(255, 255, 255, 0.94)',
    },
    [mapLayerIds.hikingPoiLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloSatellite,
    },
    [mapLayerIds.peakLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloSatellite,
    },
    [mapLayerIds.roadLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloSatellite,
    },
    [mapLayerIds.waterLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloSatellite,
    },
    [mapLayerIds.placeLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloSatellite,
    },
  },
} as const satisfies Readonly<Record<MapVisualMode, MapVisualModePaint>>;
