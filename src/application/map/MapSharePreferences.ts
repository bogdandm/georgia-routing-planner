/**
 * Browser-local choices for what a map share link reproduces beyond the center and zoom.
 * Each flag only applies while the map actually shows that content.
 */
export interface MapSharePreferences {
  /** The visible static raster basemap (Google, Bing, Esri, NAPR, or Soviet maps). */
  readonly includeSatelliteLayer: boolean;
  /** The visible Sentinel-2 scene. */
  readonly includeSentinelImage: boolean;
  /** Bearing, pitch, and 3D mode while 3D terrain is active. */
  readonly include3dCamera: boolean;
}

export const defaultMapSharePreferences: MapSharePreferences = {
  includeSatelliteLayer: true,
  includeSentinelImage: true,
  include3dCamera: true,
};
