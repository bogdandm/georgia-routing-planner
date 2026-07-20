import type { LngLat, Map as MapLibreMap } from 'maplibre-gl';

import {
  MapLibreOrbitPivotIndicator,
  type OrbitPivotIndicator,
} from '@/presentation/map/MapLibreOrbitPivotIndicator';

const bearingDegreesPerPixel = 0.28;
const pitchDegreesPerPixel = 0.175;
const maximumPitchDegrees = 85;

/**
 * Provides a restrained 3D-only middle-button orbit around the terrain point beneath
 * the initial press. MapLibre owns projection, terrain anchoring, camera limits, and
 * movement events through one zero-duration `easeTo` per pointer update.
 */
export class MiddleMouseCameraControl {
  #container: HTMLElement | null = null;
  #map: MapLibreMap | null = null;
  #enabled = false;
  #active = false;
  #orbitAnchor: LngLat | null = null;
  #lastPointer: { readonly x: number; readonly y: number } | null = null;

  public constructor(
    private readonly pivotIndicator: OrbitPivotIndicator = new MapLibreOrbitPivotIndicator(),
  ) {}

  public attach(container: HTMLElement, map?: MapLibreMap): void {
    if (this.#container === container && this.#map === (map ?? null)) return;
    this.detach();
    this.#container = container;
    this.#map = map ?? null;
    container.addEventListener('mousedown', this.handleMouseDown, true);
    container.addEventListener('contextmenu', this.handleContextMenu, true);
    container.addEventListener('auxclick', this.handleAuxClick, true);
  }

  public setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) this.finishGesture();
  }

  public detach(): void {
    const container = this.#container;
    if (container !== null) {
      container.removeEventListener('mousedown', this.handleMouseDown, true);
      container.removeEventListener('contextmenu', this.handleContextMenu, true);
      container.removeEventListener('auxclick', this.handleAuxClick, true);
    }
    this.finishGesture();
    this.pivotIndicator.destroy();
    this.#container = null;
    this.#map = null;
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 2) {
      // Right drag remains available to the browser instead of changing the camera.
      event.stopImmediatePropagation();
      return;
    }
    if (event.button !== 1 || this.#container === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.#enabled || this.#map === null) return;

    const bounds = this.#container.getBoundingClientRect();
    this.#orbitAnchor = this.#map.unproject([
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    ]);
    this.pivotIndicator.show(this.#map, this.#orbitAnchor);
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    this.#active = true;
    window.addEventListener('mousemove', this.handleMouseMove, true);
    window.addEventListener('mouseup', this.handleMouseUp, true);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const map = this.#map;
    const anchor = this.#orbitAnchor;
    const previous = this.#lastPointer;
    if (!this.#active || map === null || anchor === null || previous === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const horizontalDelta = event.clientX - previous.x;
    const verticalDelta = event.clientY - previous.y;
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    map.easeTo({
      around: anchor,
      bearing: map.getBearing() + horizontalDelta * bearingDegreesPerPixel,
      pitch: Math.min(
        maximumPitchDegrees,
        Math.max(0, map.getPitch() - verticalDelta * pitchDegreesPerPixel),
      ),
      duration: 0,
      essential: true,
    });
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (!this.#active || event.button !== 1) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.finishGesture();
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.stopImmediatePropagation();
  };

  private readonly handleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) event.preventDefault();
  };

  private finishGesture(): void {
    this.#active = false;
    this.#orbitAnchor = null;
    this.#lastPointer = null;
    this.pivotIndicator.hide();
    window.removeEventListener('mousemove', this.handleMouseMove, true);
    window.removeEventListener('mouseup', this.handleMouseUp, true);
  }
}
