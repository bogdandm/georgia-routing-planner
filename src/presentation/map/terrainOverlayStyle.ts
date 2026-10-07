import type { RasterDEMSourceSpecification } from 'maplibre-gl';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';

/** Builds the provider DEM source that MapLibre loads directly for 3D terrain and relief shading. */
export function createTerrainDemSource(
  terrain: MapProviderConfiguration['terrain'],
): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [terrain.tileUrl],
    tileSize: terrain.tileSize,
    minzoom: terrain.minZoom,
    maxzoom: terrain.maxZoom,
    encoding: terrain.encoding,
    attribution: terrain.attribution,
  };
}
