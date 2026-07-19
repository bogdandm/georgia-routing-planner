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

export interface PersistedMapLayerPreferences {
  readonly visibility: MapLayerVisibilityPreferences;
  readonly appliedScene: SatelliteScene | null;
}

/** Persists map presentation choices locally without synchronizing them off-device. */
export interface MapLayerPreferencesRepository {
  loadMapLayerPreferences(): Promise<PersistedMapLayerPreferences>;
  saveMapLayerPreferences(value: PersistedMapLayerPreferences): Promise<void>;
}
