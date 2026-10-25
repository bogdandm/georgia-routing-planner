import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * MapLibre initializes compact attribution expanded and collapses it only after a drag.
 * Remove that startup state; the native button restores it when the user asks for credits.
 */
export function collapseInitialMapAttribution(
  map: Pick<MapLibreMap, 'getContainer'>,
): void {
  map
    .getContainer()
    .querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')
    ?.classList.remove('maplibregl-compact-show');
}
