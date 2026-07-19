import type { TerrainOverlayPreferences } from '@/application/ports/MapLayerPreferencesRepository';

export type TerrainOverlayCommandResult =
  | { readonly status: 'success' }
  | { readonly status: 'failed'; readonly message: string };

/** Controls terrain-overlay rendering without exposing the native map instance. */
export interface TerrainOverlayMap {
  getTerrainOverlayPreferences(): TerrainOverlayPreferences;
  setTerrainOverlayPreferences(
    value: TerrainOverlayPreferences,
  ): TerrainOverlayCommandResult;
}
