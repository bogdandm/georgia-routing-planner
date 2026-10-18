import type { RasterDEMSourceSpecification } from 'maplibre-gl';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';

/**
 * Builds the provider DEM source that MapLibre loads directly for 3D terrain and relief
 * shading. MapLibre sizes each 3D render-to-texture tile at four times the declared
 * tile size, so 512 px provider tiles are declared as 256 px: textures stay 1024 px
 * instead of 2048 px, and MapLibre requests one zoom level finer tiles below the
 * provider maximum zoom. Elevation decoding reads the real image size.
 */
export function createTerrainDemSource(
  terrain: MapProviderConfiguration['terrain'],
): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [terrain.tileUrl],
    tileSize: 256,
    minzoom: terrain.minZoom,
    maxzoom: terrain.maxZoom,
    encoding: terrain.encoding,
    attribution: terrain.attribution,
  };
}
