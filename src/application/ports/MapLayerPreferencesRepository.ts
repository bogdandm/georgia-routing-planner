import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';

export const logicalMapLayerIds = [
  'satellite-imagery',
  'scene-footprint',
  'terrain-relief',
  'elevation-isolines',
  'hiking-paths',
  'roads',
  'places-and-pois',
] as const;

export type LogicalMapLayerId = (typeof logicalMapLayerIds)[number];

export type MapLayerVisibilityPreferences = Readonly<
  Record<LogicalMapLayerId, boolean>
>;

export interface SatelliteRenderingTuning {
  readonly reflectanceMax: number;
  readonly gamma: number;
  readonly saturation: number;
}

export const defaultSatelliteRenderingTuning: SatelliteRenderingTuning = {
  reflectanceMax: 11_000,
  gamma: 2.25,
  saturation: 2.5,
};

export const supportedContourIntervals = [20, 25, 40, 50, 100] as const;

export type ContourIntervalMeters = (typeof supportedContourIntervals)[number];

export interface TerrainOverlayPreferences {
  readonly contourIntervalMeters: ContourIntervalMeters;
  readonly shadeAboveSatellite: boolean;
}

export const defaultTerrainOverlayPreferences: TerrainOverlayPreferences = {
  contourIntervalMeters: 50,
  shadeAboveSatellite: false,
};

export interface PersistedMapLayerPreferences {
  readonly visibility: MapLayerVisibilityPreferences;
  readonly appliedScene: SatelliteScene | null;
  readonly renderingTuning: SatelliteRenderingTuning;
  readonly terrainOverlays: TerrainOverlayPreferences;
}

/** Persists map presentation choices locally without synchronizing them off-device. */
export interface MapLayerPreferencesRepository {
  loadMapLayerPreferences(): Promise<PersistedMapLayerPreferences>;
  saveMapLayerPreferences(value: PersistedMapLayerPreferences): Promise<void>;
}
