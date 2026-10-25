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
 * Starts before a deferred MapLibre control or its first credits may exist. It keeps
 * native disclosure state aligned when MapLibre later collapses the control on drag.
 */
export function synchronizeMapAttributionDisclosure(
  map: Pick<MapLibreMap, 'getContainer'>,
): () => void {
  const container = map.getContainer();
  let control: Element | null = null;
  const synchronize = () => {
    const nextControl = container.querySelector(
      '.maplibregl-ctrl-attrib.maplibregl-compact',
    );
    if (nextControl === null) {
      control = null;
      return;
    }
    if (nextControl !== control) {
      control = nextControl;
      nextControl.classList.remove('maplibregl-compact-show');
      nextControl.removeAttribute('open');
      return;
    }
    nextControl.toggleAttribute(
      'open',
      nextControl.classList.contains('maplibregl-compact-show'),
    );
  };
  synchronize();
  const Observer = container.ownerDocument.defaultView?.MutationObserver;
  if (Observer === undefined) return () => undefined;
  const observer = new Observer(synchronize);
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
