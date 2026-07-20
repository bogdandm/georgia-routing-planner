import { Marker, type LngLat, type Map as MapLibreMap } from 'maplibre-gl';

export interface OrbitPivotIndicator {
  show(map: MapLibreMap, coordinate: LngLat): void;
  hide(): void;
  destroy(): void;
}

/** Reuses one terrain-aware MapLibre marker for the active 3D orbit pivot. */
export class MapLibreOrbitPivotIndicator implements OrbitPivotIndicator {
  readonly #marker: Marker;

  public constructor() {
    const element = document.createElement('div');
    element.className = 'map-orbit-pivot';
    element.setAttribute('aria-hidden', 'true');
    this.#marker = new Marker({
      element,
      anchor: 'center',
      opacityWhenCovered: 0,
      subpixelPositioning: true,
    });
  }

  public show(map: MapLibreMap, coordinate: LngLat): void {
    this.#marker.setLngLat(coordinate).addTo(map);
  }

  public hide(): void {
    this.#marker.remove();
  }

  public destroy(): void {
    this.hide();
  }
}
