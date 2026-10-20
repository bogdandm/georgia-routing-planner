import type { LngLat, Map as MapLibreMap } from 'maplibre-gl';

import type { SatelliteCompareCamera } from '@/presentation/map/SatelliteCompareMaps';

interface ComparePane {
  readonly map: MapLibreMap;
  readonly crosshair: HTMLElement | null;
}

/**
 * Keeps the comparison panes on one center and zoom and mirrors the pointer as a
 * crosshair in every other pane. The pane the user moves leads: followers `jumpTo` its
 * camera while `#syncing` is set, so their own move events never echo back. Crosshairs
 * move through inline styles, so pointer movement never renders React.
 */
export class SatelliteCompareSync {
  readonly #panes = new Map<string, ComparePane>();
  #camera: SatelliteCompareCamera;
  #settledCamera: SatelliteCompareCamera;
  #syncing = false;
  #pointer: { readonly paneKey: string; readonly lngLat: LngLat } | null = null;

  public constructor(initialCamera: SatelliteCompareCamera) {
    this.#camera = initialCamera;
    this.#settledCamera = initialCamera;
  }

  /** The shared camera; a pane added later starts here. */
  public get camera(): SatelliteCompareCamera {
    return this.#camera;
  }

  public attach(
    paneKey: string,
    map: MapLibreMap,
    crosshair: HTMLElement | null,
  ): void {
    this.#panes.set(paneKey, { map, crosshair });
    this.#syncing = true;
    try {
      map.jumpTo({
        center: [this.#camera.center.longitude, this.#camera.center.latitude],
        zoom: this.#camera.zoom,
      });
    } finally {
      this.#syncing = false;
    }
    this.renderCrosshairs();
  }

  public detach(paneKey: string): void {
    this.#panes.delete(paneKey);
    if (this.#pointer?.paneKey === paneKey) this.#pointer = null;
    this.renderCrosshairs();
  }

  /** Moves every other pane to the camera of the pane that moved. */
  public handleMove(paneKey: string): void {
    const leader = this.#panes.get(paneKey);
    if (this.#syncing || leader === undefined) return;
    const center = leader.map.getCenter();
    const zoom = leader.map.getZoom();
    this.#camera = { center: { longitude: center.lng, latitude: center.lat }, zoom };
    this.#syncing = true;
    try {
      for (const [key, pane] of this.#panes) {
        if (key !== paneKey) pane.map.jumpTo({ center, zoom });
      }
    } finally {
      this.#syncing = false;
    }
    this.renderCrosshairs();
  }

  /**
   * Returns the shared camera once per settled change. Follower and resize move ends
   * that leave the camera where it settled last return null.
   */
  public handleMoveEnd(paneKey: string): SatelliteCompareCamera | null {
    if (this.#syncing || !this.#panes.has(paneKey)) return null;
    const camera = this.#camera;
    const settled = this.#settledCamera;
    if (
      camera.zoom === settled.zoom &&
      camera.center.longitude === settled.center.longitude &&
      camera.center.latitude === settled.center.latitude
    ) {
      return null;
    }
    this.#settledCamera = camera;
    return camera;
  }

  public showPointer(paneKey: string, lngLat: LngLat): void {
    this.#pointer = { paneKey, lngLat };
    this.renderCrosshairs();
  }

  public hidePointer(): void {
    this.#pointer = null;
    this.renderCrosshairs();
  }

  private renderCrosshairs(): void {
    const pointer = this.#pointer;
    for (const [key, { map, crosshair }] of this.#panes) {
      if (crosshair === null) continue;
      if (pointer === null || pointer.paneKey === key) {
        crosshair.style.display = 'none';
        continue;
      }
      const { x, y } = map.project(pointer.lngLat);
      crosshair.style.display = 'block';
      crosshair.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
    }
  }
}
