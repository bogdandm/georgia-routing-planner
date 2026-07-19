import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';

export const logicalMapLayerIds = [
  'satellite-imagery',
  'scene-footprint',
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
  reflectanceMax: 10_000,
  gamma: 1.8,
  saturation: 1.05,
};

export interface PersistedMapLayerPreferences {
  readonly visibility: MapLayerVisibilityPreferences;
  readonly appliedScene: SatelliteScene | null;
  readonly renderingTuning: SatelliteRenderingTuning;
}

/** Persists map presentation choices locally without synchronizing them off-device. */
export interface MapLayerPreferencesRepository {
  loadMapLayerPreferences(): Promise<PersistedMapLayerPreferences>;
  saveMapLayerPreferences(value: PersistedMapLayerPreferences): Promise<void>;
}
