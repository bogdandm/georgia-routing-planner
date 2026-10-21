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
    brownfield: '#D8C8A8',
    building: '#BBB7AE',
    rock: '#CBCAC5',
    sand: '#E5D6B3',
    ice: '#F1F1EE',
    cemeterySign: '#4A4F52',
  },
  vegetation: {
    forest: '#B5C69A',
    grass: '#DEE2DA',
    farmland: '#DFE0DA',
    scrub: '#C0CBA2',
    /** GOST vegetation signs (trees, shrubs, orchards) drawn over the fills. */
    sign: '#8DA273',
  },
  glacier: {
    fill: '#DCE9ED',
  },
  water: {
    fill: '#78B7D5',
    line: '#78B7D5',
    label: '#075E7A',
    /** Blue swamp hatching of Soviet/GOST topographic maps, drawn over plain land. */
    wetland: '#2E7DBF',
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
    aerialway: '#33383B',
  },
  terrain: {
    contourMinor: appColors.brand.blueGreenDark,
    contourIndex: appColors.brand.deepSpace,
    contourLabel: appColors.brand.deepSpace,
    shadow: '#565A5C',
    highlight: '#F5F4EF',
    accent: '#898D8F',
    ridge: '#565A5C',
    /** Brown of the relief on Soviet/GOST topographic maps. */
    cliff: '#8C4A1E',
    pass: '#29343A',
    scree: '#A39B91',
  },
  restricted: {
    line: '#C95050',
  },
  /** National parks, reserves, and other protected land. */
  protectedArea: {
    /** Outline and NR sign: vivid, as forest green vanished among forest and contours. */
    line: '#0FA33B',
    /** Darker shade so names stay readable over green land cover. */
    label: '#17692F',
  },
  boundary: {
    region: '#656B70',
    country: '#151719',
    /** De facto lines of disputed territories below country level. */
    disputed: '#D1002B',
  },
  poi: {
    water: '#0B6E99',
    hut: '#7A4A1E',
    campSite: '#3D6B2A',
    viewpoint: '#29343A',
    guidepost: '#58636A',
    historic: '#7A2E2E',
    attraction: '#365F70',
  },
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
    gpxTrackHighlight: appColors.brand.amber,
    gpxTrackStart: appColors.marker.green,
    gpxTrackFinish: appColors.marker.red,
    satelliteFootprint: '#FF8C1A',
    /** Developer route-search arcs: dark per-direction colors that stand out from orange roads. */
    routeSearchForward: '#5E2CA5',
    routeSearchBackward: '#00796B',
  },
} as const;

const mapVisualModePaintPropertyNames = [
  'circle-opacity',
  'circle-stroke-opacity',
  'fill-opacity',
  'hillshade-exaggeration',
  'icon-opacity',
  'line-opacity',
  'text-halo-color',
  'text-opacity',
] as const;

type MapVisualModePaintProperty = (typeof mapVisualModePaintPropertyNames)[number];

export type MapVisualModePaint = Readonly<
  Record<string, Readonly<Partial<Record<MapVisualModePaintProperty, string | number>>>>
>;

/** Paint changes needed to preserve contrast without changing a feature's meaning. */
export const mapVisualModePaint = {
  vector: {
    [mapLayerIds.landcover]: { 'fill-opacity': 1 },
    [mapLayerIds.glacierAreas]: { 'fill-opacity': 1 },
    [mapLayerIds.landcoverDetails]: { 'fill-opacity': 1 },
    [mapLayerIds.landcoverPatterns]: { 'fill-opacity': 1 },
    [mapLayerIds.landcoverPatternDetails]: { 'fill-opacity': 1 },
    [mapLayerIds.cemeteries]: { 'fill-opacity': 1 },
    [mapLayerIds.landuse]: { 'fill-opacity': 1 },
    [mapLayerIds.brownfieldAreas]: { 'fill-opacity': 1 },
    [mapLayerIds.buildings]: { 'fill-opacity': 1 },
    [mapLayerIds.restrictedAreas]: { 'line-opacity': 0.88 },
    [mapLayerIds.protectedAreas]: { 'fill-opacity': 0.4 },
    [mapLayerIds.protectedAreaOutlines]: { 'line-opacity': 0.9 },
    [mapLayerIds.waterways]: { 'line-opacity': 1 },
    [mapLayerIds.water]: { 'fill-opacity': 1 },
    [mapLayerIds.boundaries]: { 'line-opacity': 0.7 },
    [mapLayerIds.countryBorders]: { 'line-opacity': 0.9 },
    [mapLayerIds.disputedBorders]: { 'line-opacity': 1 },
    [mapLayerIds.roadCasings]: { 'line-opacity': 0.46 },
    [mapLayerIds.roads]: { 'line-opacity': 0.86 },
    [mapLayerIds.hikingPaths]: { 'line-opacity': 0.9 },
    [mapLayerIds.hikingSteps]: { 'line-opacity': 0.9 },
    [mapLayerIds.hikingPathDetails]: { 'line-opacity': 0.9 },
    [mapLayerIds.hikingBridleways]: { 'line-opacity': 0.9 },
    [mapLayerIds.hikingPois]: { 'icon-opacity': 1 },
    [mapLayerIds.peaks]: { 'circle-opacity': 1, 'circle-stroke-opacity': 1 },
    [mapLayerIds.ridges]: { 'line-opacity': 0.48 },
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
    [mapLayerIds.ridgeLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloVector,
    },
    [mapLayerIds.roadLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloVector,
    },
    [mapLayerIds.protectedAreaLabels]: {
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
    // Imagery already shows vegetation, swamps, and scree, so their signs are removed too.
    [mapLayerIds.landcoverDetails]: { 'fill-opacity': 0 },
    [mapLayerIds.landcoverPatterns]: { 'fill-opacity': 0 },
    [mapLayerIds.landcoverPatternDetails]: { 'fill-opacity': 0 },
    [mapLayerIds.cemeteries]: { 'fill-opacity': 0 },
    [mapLayerIds.landuse]: { 'fill-opacity': 0 },
    [mapLayerIds.restrictedAreas]: { 'line-opacity': 0.8 },
    [mapLayerIds.protectedAreas]: { 'fill-opacity': 0.5 },
    [mapLayerIds.protectedAreaOutlines]: { 'line-opacity': 1 },
    [mapLayerIds.waterways]: { 'line-opacity': 1 },
    [mapLayerIds.water]: { 'fill-opacity': 0.38 },
    [mapLayerIds.brownfieldAreas]: { 'fill-opacity': 0 },
    [mapLayerIds.buildings]: { 'fill-opacity': 0 },
    [mapLayerIds.boundaries]: { 'line-opacity': 0.7 },
    [mapLayerIds.countryBorders]: { 'line-opacity': 1 },
    [mapLayerIds.disputedBorders]: { 'line-opacity': 1 },
    [mapLayerIds.roadCasings]: { 'line-opacity': 0.64 },
    [mapLayerIds.roads]: { 'line-opacity': 0.96 },
    [mapLayerIds.hikingPaths]: { 'line-opacity': 0.96 },
    [mapLayerIds.hikingPathDetails]: { 'line-opacity': 0.96 },
    [mapLayerIds.hikingBridleways]: { 'line-opacity': 0.96 },
    [mapLayerIds.hikingSteps]: { 'line-opacity': 0.96 },
    [mapLayerIds.hikingPois]: { 'icon-opacity': 1 },
    [mapLayerIds.peaks]: { 'circle-opacity': 1, 'circle-stroke-opacity': 1 },
    [terrainOverlayLayerIds.reliefShade]: { 'hillshade-exaggeration': 0.14 },
    [mapLayerIds.ridges]: { 'line-opacity': 0.56 },
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
    [mapLayerIds.ridgeLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloSatellite,
    },
    [mapLayerIds.roadLabels]: {
      'text-opacity': 1,
      'text-halo-color': mapVisualPalette.text.haloSatellite,
    },
    [mapLayerIds.protectedAreaLabels]: {
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

export { mapVisualModePaintPropertyNames };
