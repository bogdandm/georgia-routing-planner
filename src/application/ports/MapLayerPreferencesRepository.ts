export type LogicalMapLayerId =
  | 'google-satellite'
  | 'bing-satellite'
  | 'esri-satellite'
  | 'napr-orthophoto'
  | 'satellite-imagery'
  | 'scene-footprint'
  | 'terrain-relief'
  | 'elevation-isolines'
  | 'natural-features'
  | 'natural-feature-patterns'
  | 'restricted-areas'
  | 'detail-context'
  | 'hiking-paths'
  | 'roads'
  | 'places-and-pois'
  | 'imported-tracks'
  | 'track-elevation-gradient';

type MapLayerVisibilityPreferences = Readonly<Record<LogicalMapLayerId, boolean>>;

export interface SatelliteRenderingTuning {
  readonly reflectanceMax: number;
  readonly gamma: number;
  readonly saturation: number;
}

export type SatelliteRenderingMode = 'auto' | 'server' | 'direct';

export const defaultSatelliteRenderingMode: SatelliteRenderingMode = 'auto';

export const defaultSatelliteRenderingTuning: SatelliteRenderingTuning = {
  reflectanceMax: 11_000,
  gamma: 2.25,
  saturation: 2.5,
};
export const defaultWeatherMapOpacity = 1;

export const supportedContourIntervals = [20, 25, 40, 50, 100] as const;

export type ContourIntervalMeters = (typeof supportedContourIntervals)[number];

/**
 * Tile size declared for the MapLibre DEM source over the provider's 512 px images.
 * MapLibre sizes 3D draped textures at four times this value: 256 keeps them at 1024 px
 * and loads one zoom finer tiles below the provider's maximum zoom; 512 matches the
 * images, with fewer terrain tiles but 2048 px textures.
 */
export const supportedTerrainDemTileSizes = [256, 512] as const;

export type TerrainDemTileSize = (typeof supportedTerrainDemTileSizes)[number];

export interface TerrainOverlayPreferences {
  readonly contourIntervalMeters: ContourIntervalMeters;
  readonly shadeAboveSatellite: boolean;
  readonly demTileSize: TerrainDemTileSize;
}

export const defaultTerrainOverlayPreferences: TerrainOverlayPreferences = {
  contourIntervalMeters: 50,
  shadeAboveSatellite: false,
  demTileSize: 512,
};

export interface PersistedMapLayerPreferences {
  /** `natural-feature-patterns` here is the 2D choice; 3D keeps its own below. */
  readonly visibility: MapLayerVisibilityPreferences;
  /** Area patterns in 3D, off by default because they add work to every draped texture. */
  readonly naturalFeaturePatternsIn3d: boolean;
  readonly openStreetMapOpacity: number;
  readonly importedTrackOpacity: number;
  readonly weatherMapOpacity: number;
  readonly satelliteRenderingMode: SatelliteRenderingMode;
  readonly renderingTuning: SatelliteRenderingTuning;
  readonly terrainOverlays: TerrainOverlayPreferences;
}

/** Persists map presentation choices locally without synchronizing them off-device. */
export interface MapLayerPreferencesRepository {
  loadMapLayerPreferences(): Promise<PersistedMapLayerPreferences>;
  saveMapLayerPreferences(value: PersistedMapLayerPreferences): Promise<void>;
}
