import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * MapLibre initializes compact attribution expanded and collapses it only after a drag.
 * Remove that startup state; the native button restores it when the user asks for credits.
 */
export function collapseInitialMapAttribution(
  map: Pick<MapLibreMap, 'getContainer'>,
): boolean {
  const control = map
    .getContainer()
    .querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show');
  if (control === null) return false;
  control.classList.remove('maplibregl-compact-show');
  control.removeAttribute('open');
  return true;
}

/**
 * Starts before a deferred MapLibre control or its first credits may exist, then
 * disconnects after collapsing that initial expansion so later user toggles are untouched.
 */
export function collapseInitialMapAttributionWhenAvailable(
  map: Pick<MapLibreMap, 'getContainer'>,
): () => void {
  if (collapseInitialMapAttribution(map)) return () => undefined;
  const container = map.getContainer();
  const Observer = container.ownerDocument.defaultView?.MutationObserver;
  if (Observer === undefined) return () => undefined;
  const observer = new Observer(() => {
    if (collapseInitialMapAttribution(map)) observer.disconnect();
  });
  observer.observe(container, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });
  return () => {
    observer.disconnect();
  };
}
