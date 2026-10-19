import type { RasterDEMSourceSpecification } from 'maplibre-gl';

import type { TerrainDemTileSize } from '@/application/ports/MapLayerPreferencesRepository';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';

/**
 * Builds the provider DEM source that MapLibre loads directly for 3D terrain and relief
 * shading, declared with the user's `TerrainDemTileSize` rather than the image size.
 * Elevation decoding reads the real image size either way.
 */
export function createTerrainDemSource(
  terrain: MapProviderConfiguration['terrain'],
  tileSize: TerrainDemTileSize,
): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [terrain.tileUrl],
    tileSize,
    minzoom: terrain.minZoom,
    maxzoom: terrain.maxZoom,
    encoding: terrain.encoding,
    attribution: terrain.attribution,
  };
}
