import { msg } from '@lingui/core/macro';
import { Marker, Popup, type Map as MapLibreMap } from 'maplibre-gl';

import { appI18n } from '@/presentation/localization/appI18n';
import type { MapPointInspection } from '@/presentation/map/mapTypes';

type OpenMapPointInspection = Exclude<MapPointInspection, { status: 'closed' }>;

export interface PointInspectorActions {
  readonly onClose: () => void;
  readonly onCopyLink?: (inspection: OpenMapPointInspection) => void;
  readonly onCreateMarker?: (inspection: OpenMapPointInspection) => void;
}

// Decimal-degree coordinates keep the same machine-readable form as copied values.
// eslint-disable-next-line lingui/no-unlocalized-strings -- BCP 47 locale token.
const coordinateFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
});
const POPUP_OFFSET = 10;

export interface PointInspectorPopup {
  attach(map: MapLibreMap): void;
  show(inspection: OpenMapPointInspection): void;
  isVisible(): boolean;
  close(): void;
  destroy(): void;
}

function appendLabelValue(
  container: HTMLElement,
  label: string,
  value: string,
): HTMLElement {
  const group = document.createElement('div');
  const labelElement = document.createElement('div');
  labelElement.className = 'map-point-inspector__label';
  labelElement.textContent = label;
  const valueElement = document.createElement('div');
  valueElement.className = 'map-point-inspector__value';
  valueElement.textContent = value;
  group.append(labelElement, valueElement);
  container.append(group);
  return group;
}

function appendFeatureLinks(container: HTMLElement, name: string): void {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Search query data.
  const query = encodeURIComponent(`${name} Georgia`);
  const wikipediaTitle = encodeURIComponent(name.replaceAll(' ', '_'));
  const links = document.createElement('div');
  links.className = 'map-point-inspector__links';
  /* eslint-disable lingui/no-unlocalized-strings -- External product names and URLs stay invariant. */
  for (const [label, href] of [
    ['Wikipedia', `https://en.wikipedia.org/wiki/${wikipediaTitle}`],
    ['Google Search', `https://www.google.com/search?q=${query}`],
  ] as const) {
    /* eslint-enable lingui/no-unlocalized-strings */
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    links.append(link);
  }
  container.append(links);
}

function elevationText(
  inspection: OpenMapPointInspection,
  measurementFormatter: Intl.NumberFormat,
): string {
  switch (inspection.elevation.status) {
    case 'loading':
      return appI18n._(msg`Loading elevation…`);
    case 'available': {
      const elevation = measurementFormatter.format(inspection.elevation.meters);
      return appI18n._(msg`${elevation} m`);
    }
    case 'unavailable':
      return appI18n._(msg`Elevation is unavailable here.`);
    case 'error':
      return appI18n._(msg`Elevation could not be loaded.`);
  }
}

function nearbyFeatureText(
  inspection: OpenMapPointInspection,
  measurementFormatter: Intl.NumberFormat,
): string {
  switch (inspection.nearbyPoi.status) {
    case 'loading':
      return appI18n._(msg`Checking nearby map data…`);
    case 'none':
      return appI18n._(msg`No named map feature found.`);
    case 'error':
      return appI18n._(msg`Nearby map data could not be inspected.`);
    case 'found': {
      const poi = inspection.nearbyPoi.poi;
      const name = poi.name ?? appI18n._(msg`Unnamed map feature`);
      const distance = measurementFormatter.format(poi.distanceMeters);
      if (poi.category === null) return appI18n._(msg`${name}, ${distance} m away`);
      const category = poi.category.replaceAll('_', ' ');
      return appI18n._(msg`${name} (${category}), ${distance} m away`);
    }
  }
}

export function renderPointInspectorContent(
  container: HTMLElement,
  inspection: OpenMapPointInspection,
  actions: PointInspectorActions,
): void {
  const restoreCloseFocus = container.contains(document.activeElement);
  const measurementFormatter = new Intl.NumberFormat(appI18n.locale, {
    maximumFractionDigits: 0,
  });
  container.replaceChildren();
  const header = document.createElement('div');
  header.className = 'map-point-inspector__header';
  const title = document.createElement('strong');
  title.id = 'map-point-inspector-title';
  title.textContent = appI18n._(msg`Map point`);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'map-point-inspector__close';
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM attribute name.
  closeButton.setAttribute('aria-label', appI18n._(msg`Close map point details`));
  closeButton.textContent = '×';
  closeButton.addEventListener('click', actions.onClose, { once: true });
  header.append(title, closeButton);
  container.append(header);
  appendLabelValue(
    container,
    appI18n._(msg`Coordinates`),
    `${coordinateFormatter.format(inspection.coordinate.latitude)}, ${coordinateFormatter.format(inspection.coordinate.longitude)}`,
  );
  appendLabelValue(
    container,
    appI18n._(msg`Terrain elevation`),
    elevationText(inspection, measurementFormatter),
  );
  const nearbyFeature = appendLabelValue(
    container,
    appI18n._(msg`Nearby map feature`),
    nearbyFeatureText(inspection, measurementFormatter),
  );
  if (
    inspection.nearbyPoi.status === 'found' &&
    inspection.nearbyPoi.poi.name !== null
  ) {
    appendFeatureLinks(nearbyFeature, inspection.nearbyPoi.poi.name);
  }
  if (actions.onCopyLink !== undefined && actions.onCreateMarker !== undefined) {
    const actionRow = document.createElement('div');
    actionRow.className = 'map-point-inspector__actions';
    const copyLinkButton = document.createElement('button');
    copyLinkButton.type = 'button';
    copyLinkButton.className =
      'map-point-inspector__action map-point-inspector__action--outlined';
    copyLinkButton.textContent = appI18n._(msg`Copy link`);
    copyLinkButton.addEventListener('click', () => {
      actions.onCopyLink?.(inspection);
    });
    const createMarkerButton = document.createElement('button');
    createMarkerButton.type = 'button';
    createMarkerButton.className =
      'map-point-inspector__action map-point-inspector__action--contained';
    createMarkerButton.textContent = appI18n._(msg`Create marker`);
    createMarkerButton.addEventListener('click', () => {
      actions.onCreateMarker?.(inspection);
    });
    actionRow.append(copyLinkButton, createMarkerButton);
    container.append(actionRow);
  }
  if (restoreCloseFocus) closeButton.focus();
}

/** Owns one native marker/popup pair so MapLibre anchors it during every render. */
export class MapLibrePointInspector implements PointInspectorPopup {
  readonly #content = document.createElement('div');
  readonly #anchor = document.createElement('div');
  readonly #popup: Popup;
  readonly #marker: Marker;
  #map: MapLibreMap | null = null;
  #placementFrame: number | null = null;
  #placementWindow: Window | null = null;
  #inspection: OpenMapPointInspection | null = null;
  #unsubscribeLocale: (() => void) | null = null;

  public constructor(private readonly actions: PointInspectorActions) {
    this.#content.className = 'map-point-inspector__content';
    /* eslint-disable lingui/no-unlocalized-strings -- DOM attribute names and ARIA tokens. */
    this.#content.setAttribute('role', 'dialog');
    this.#content.setAttribute('aria-labelledby', 'map-point-inspector-title');
    this.#content.setAttribute('aria-live', 'polite');
    this.#anchor.className = 'map-point-inspector__anchor';
    this.#anchor.setAttribute('aria-hidden', 'true');
    /* eslint-enable lingui/no-unlocalized-strings */
    this.#popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: true,
      maxWidth: '300px',
      offset: POPUP_OFFSET,
      subpixelPositioning: true,
      locationOccludedOpacity: 0.2,
      className: 'map-point-inspector',
    }).setDOMContent(this.#content);
    this.#marker = new Marker({
      element: this.#anchor,
      anchor: 'center',
      opacityWhenCovered: 0,
      subpixelPositioning: true,
    }).setPopup(this.#popup);
    // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM attribute name.
    this.#anchor.setAttribute('tabindex', '-1');
  }

  #cancelPlacementUpdate(): void {
    if (this.#placementFrame === null) return;
    this.#placementWindow?.cancelAnimationFrame(this.#placementFrame);
    this.#placementFrame = null;
    this.#placementWindow = null;
  }

  #schedulePlacementUpdate(map: MapLibreMap): void {
    this.#cancelPlacementUpdate();
    const placementWindow = map.getContainer().ownerDocument.defaultView ?? window;
    this.#placementWindow = placementWindow;
    this.#placementFrame = placementWindow.requestAnimationFrame(() => {
      this.#placementFrame = null;
      this.#placementWindow = null;
      if (this.#map === map && this.#popup.isOpen()) {
        this.#popup.setOffset(POPUP_OFFSET);
      }
    });
  }

  public attach(map: MapLibreMap): void {
    // Imperative DOM content does not rerender with React, so repaint on locale change.
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Lingui event name.
    this.#unsubscribeLocale ??= appI18n.on('change', () => {
      if (this.#inspection !== null && this.#popup.isOpen()) {
        renderPointInspectorContent(this.#content, this.#inspection, this.actions);
      }
    });
    if (this.#map === map) return;
    this.#cancelPlacementUpdate();
    this.#marker.remove();
    this.#popup.remove();
    this.#map = map;
  }

  public show(inspection: OpenMapPointInspection): void {
    const map = this.#map;
    if (map === null) return;
    this.#inspection = inspection;
    renderPointInspectorContent(this.#content, inspection, this.actions);
    const lngLat: [number, number] = [
      inspection.coordinate.longitude,
      inspection.coordinate.latitude,
    ];
    this.#marker.setLngLat(lngLat);
    if (this.#marker.getElement().parentElement === null) this.#marker.addTo(map);
    this.#popup.setLngLat(lngLat);
    if (!this.#popup.isOpen()) this.#popup.addTo(map);
    this.#schedulePlacementUpdate(map);
  }

  public isVisible(): boolean {
    const map = this.#map;
    if (map === null || !this.#popup.isOpen()) return false;
    const element = this.#popup.getElement();
    if (!element.isConnected) return false;
    const popupRect = element.getBoundingClientRect();
    // A newly inserted popup may not have been laid out yet. It is open and attached,
    // so treat the zero-size interim state as visible until the browser measures it.
    if (popupRect.width === 0 && popupRect.height === 0) return true;
    const mapRect = map.getContainer().getBoundingClientRect();
    return (
      popupRect.right > mapRect.left &&
      popupRect.left < mapRect.right &&
      popupRect.bottom > mapRect.top &&
      popupRect.top < mapRect.bottom
    );
  }

  public close(): void {
    this.#cancelPlacementUpdate();
    this.#inspection = null;
    this.#popup.remove();
    this.#marker.remove();
  }

  public destroy(): void {
    this.close();
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = null;
    this.#map = null;
  }
}
