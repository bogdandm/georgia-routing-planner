import { Marker, Popup, type Map as MapLibreMap } from 'maplibre-gl';

import type { MapPointInspection } from '@/presentation/map/mapTypes';

type OpenMapPointInspection = Exclude<MapPointInspection, { status: 'closed' }>;

const coordinateFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
});
const measurementFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

export interface PointInspectorPopup {
  attach(map: MapLibreMap): void;
  show(inspection: OpenMapPointInspection): void;
  close(): void;
  destroy(): void;
}

function appendLabelValue(container: HTMLElement, label: string, value: string): void {
  const group = document.createElement('div');
  const labelElement = document.createElement('div');
  labelElement.className = 'map-point-inspector__label';
  labelElement.textContent = label;
  const valueElement = document.createElement('div');
  valueElement.className = 'map-point-inspector__value';
  valueElement.textContent = value;
  group.append(labelElement, valueElement);
  container.append(group);
}

function elevationText(inspection: OpenMapPointInspection): string {
  switch (inspection.elevation.status) {
    case 'loading':
      return 'Loading elevation…';
    case 'available':
      return `${measurementFormatter.format(inspection.elevation.meters)} m`;
    case 'unavailable':
      return 'Elevation is unavailable here.';
    case 'error':
      return 'Elevation could not be loaded.';
  }
}

function poiText(inspection: OpenMapPointInspection): string {
  switch (inspection.nearbyPoi.status) {
    case 'loading':
      return 'Checking nearby map data…';
    case 'none':
      return 'No point of interest within 100 m.';
    case 'error':
      return 'Nearby map data could not be inspected.';
    case 'found': {
      const poi = inspection.nearbyPoi.poi;
      const name = poi.name ?? 'Unnamed point of interest';
      const category = poi.category.replaceAll('_', ' ');
      return `${name} — ${category}, ${measurementFormatter.format(poi.distanceMeters)} m away`;
    }
  }
}

export function renderPointInspectorContent(
  container: HTMLElement,
  inspection: OpenMapPointInspection,
  onClose: () => void,
): void {
  const restoreCloseFocus = container.contains(document.activeElement);
  container.replaceChildren();
  const header = document.createElement('div');
  header.className = 'map-point-inspector__header';
  const title = document.createElement('strong');
  title.id = 'map-point-inspector-title';
  title.textContent = 'Map point';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'map-point-inspector__close';
  closeButton.setAttribute('aria-label', 'Close map point details');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', onClose, { once: true });
  header.append(title, closeButton);
  container.append(header);
  appendLabelValue(
    container,
    'Coordinates',
    `${coordinateFormatter.format(inspection.coordinate.longitude)}, ${coordinateFormatter.format(inspection.coordinate.latitude)}`,
  );
  appendLabelValue(container, 'Terrain elevation', elevationText(inspection));
  appendLabelValue(container, 'Nearby point of interest', poiText(inspection));
  if (restoreCloseFocus) closeButton.focus();
}

/** Owns one native marker/popup pair so MapLibre positions it during every render. */
export class MapLibrePointInspector implements PointInspectorPopup {
  readonly #content = document.createElement('div');
  readonly #anchor = document.createElement('div');
  readonly #popup: Popup;
  readonly #marker: Marker;
  #map: MapLibreMap | null = null;

  public constructor(private readonly onClose: () => void) {
    this.#content.className = 'map-point-inspector__content';
    this.#content.setAttribute('role', 'dialog');
    this.#content.setAttribute('aria-labelledby', 'map-point-inspector-title');
    this.#content.setAttribute('aria-live', 'polite');
    this.#anchor.className = 'map-point-inspector__anchor';
    this.#anchor.setAttribute('aria-hidden', 'true');
    this.#popup = new Popup({
      anchor: 'bottom',
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: true,
      maxWidth: '300px',
      offset: 10,
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
    this.#anchor.setAttribute('tabindex', '-1');
  }

  public attach(map: MapLibreMap): void {
    if (this.#map === map) return;
    this.#marker.remove();
    this.#popup.remove();
    this.#map = map;
  }

  public show(inspection: OpenMapPointInspection): void {
    const map = this.#map;
    if (map === null) return;
    this.renderContent(inspection);
    const lngLat: [number, number] = [
      inspection.coordinate.longitude,
      inspection.coordinate.latitude,
    ];
    this.#marker.setLngLat(lngLat);
    if (this.#marker.getElement().parentElement === null) this.#marker.addTo(map);
    this.#popup.setLngLat(lngLat);
    if (!this.#popup.isOpen()) this.#popup.addTo(map);
  }

  public close(): void {
    this.#popup.remove();
    this.#marker.remove();
  }

  public destroy(): void {
    this.close();
    this.#map = null;
  }

  private renderContent(inspection: OpenMapPointInspection): void {
    renderPointInspectorContent(this.#content, inspection, this.onClose);
  }
}
