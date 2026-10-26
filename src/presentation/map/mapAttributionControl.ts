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
  let control: HTMLDetailsElement | null = null;
  const synchronizeDisclosureState = () => {
    if (control === null) return;
    control.toggleAttribute(
      'open',
      control.classList.contains('maplibregl-compact-show'),
    );
  };
  const synchronize = () => {
    const nextControl = container.querySelector<HTMLDetailsElement>(
      'details.maplibregl-ctrl-attrib.maplibregl-compact',
    );
    if (nextControl === null) {
      control?.removeEventListener('toggle', synchronizeDisclosureState);
      control = null;
      return;
    }
    if (nextControl !== control) {
      control?.removeEventListener('toggle', synchronizeDisclosureState);
      control = nextControl;
      control.addEventListener('toggle', synchronizeDisclosureState);
      control.classList.remove('maplibregl-compact-show');
      control.removeAttribute('open');
      return;
    }
    synchronizeDisclosureState();
  };
  synchronize();
  const Observer = container.ownerDocument.defaultView?.MutationObserver;
  if (Observer === undefined) {
    return () => {
      control?.removeEventListener('toggle', synchronizeDisclosureState);
    };
  }
  const observer = new Observer(synchronize);
  observer.observe(container, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });
  return () => {
    observer.disconnect();
    control?.removeEventListener('toggle', synchronizeDisclosureState);
  };
}
