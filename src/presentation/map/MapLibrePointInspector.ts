import { Marker, Popup, type Map as MapLibreMap } from 'maplibre-gl';

import type { MapPointInspection } from '@/presentation/map/mapTypes';

type OpenMapPointInspection = Exclude<MapPointInspection, { status: 'closed' }>;

const POPUP_OFFSET = 10;

export interface PointInspectorPopup {
  /** Popup-owned host element; React renders the inspection content into it. */
  readonly content: HTMLElement;
  attach(map: MapLibreMap): void;
  show(inspection: OpenMapPointInspection): void;
  isVisible(): boolean;
  close(): void;
  destroy(): void;
}

/** Owns one native marker/popup pair so MapLibre anchors it during every render. */
export class MapLibrePointInspector implements PointInspectorPopup {
  public readonly content = document.createElement('div');
  readonly #anchor = document.createElement('div');
  readonly #popup: Popup;
  readonly #marker: Marker;
  #map: MapLibreMap | null = null;
  #placementFrame: number | null = null;
  #placementWindow: Window | null = null;

  public constructor() {
    /* eslint-disable lingui/no-unlocalized-strings -- DOM attribute names and ARIA tokens. */
    this.content.setAttribute('role', 'dialog');
    this.content.setAttribute('aria-labelledby', 'map-point-inspector-title');
    this.content.setAttribute('aria-live', 'polite');
    this.#anchor.className = 'map-point-inspector__anchor';
    this.#anchor.setAttribute('aria-hidden', 'true');
    /* eslint-enable lingui/no-unlocalized-strings */
    // React fills the content after the popup opens, so the content moves focus itself.
    this.#popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: false,
      maxWidth: '300px',
      offset: POPUP_OFFSET,
      subpixelPositioning: true,
      locationOccludedOpacity: 0.2,
      className: 'map-point-inspector',
    }).setDOMContent(this.content);
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
    if (this.#map === map) return;
    this.#cancelPlacementUpdate();
    this.#marker.remove();
    this.#popup.remove();
    this.#map = map;
  }

  public show(inspection: OpenMapPointInspection): void {
    const map = this.#map;
    if (map === null) return;
    const lngLat: [number, number] = [
      inspection.coordinate.longitude,
      inspection.coordinate.latitude,
    ];
    this.#marker.setLngLat(lngLat);
    if (this.#marker.getElement().parentElement === null) this.#marker.addTo(map);
    this.#popup.setLngLat(lngLat);
    if (!this.#popup.isOpen()) this.#popup.addTo(map);
    // Content renders after this call; re-anchor once the browser has laid it out.
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
    this.#popup.remove();
    this.#marker.remove();
  }

  public destroy(): void {
    this.close();
    this.#map = null;
  }
}
