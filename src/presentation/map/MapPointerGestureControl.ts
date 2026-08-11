import { Marker, type LngLat, type Map as MapLibreMap } from 'maplibre-gl';

const bearingDegreesPerPixel = 0.28;
const pitchDegreesPerPixel = 0.175;
const maximumPitchDegrees = 75;

type Gesture = 'pan' | 'orbit' | null;

/** Reuses one terrain-aware MapLibre marker for the active 3D orbit pivot. */
function createOrbitPivotIndicator() {
  const element = document.createElement('div');
  element.className = 'map-orbit-pivot';
  element.setAttribute('aria-hidden', 'true');
  const marker = new Marker({
    element,
    anchor: 'center',
    opacityWhenCovered: 0,
    subpixelPositioning: true,
  });
  return {
    show: (map: MapLibreMap, coordinate: LngLat) => {
      marker.setLngLat(coordinate).addTo(map);
    },
    hide: () => {
      marker.remove();
    },
  };
}

/**
 * Owns middle-button panning and Shift+left terrain orbit gestures without changing
 * MapLibre's ordinary left and right button behavior.
 */
export class MapPointerGestureControl {
  #container: HTMLElement | null = null;
  #map: MapLibreMap | null = null;
  #terrainOrbitEnabled = false;
  #gesture: Gesture = null;
  #orbitAnchor: LngLat | null = null;
  #lastPointer: { readonly x: number; readonly y: number } | null = null;

  public constructor(
    private readonly pivotIndicator: ReturnType<
      typeof createOrbitPivotIndicator
    > = createOrbitPivotIndicator(),
  ) {}

  public attach(container: HTMLElement, map?: MapLibreMap): void {
    if (this.#container === container && this.#map === (map ?? null)) return;
    this.detach();
    this.#container = container;
    this.#map = map ?? null;
    container.addEventListener('mousedown', this.handleMouseDown, true);
    container.addEventListener('auxclick', this.handleAuxClick, true);
  }

  public setTerrainOrbitEnabled(enabled: boolean): void {
    this.#terrainOrbitEnabled = enabled;
    if (!enabled && this.#gesture === 'orbit') this.finishGesture();
  }

  public detach(): void {
    const container = this.#container;
    if (container !== null) {
      container.removeEventListener('mousedown', this.handleMouseDown, true);
      container.removeEventListener('auxclick', this.handleAuxClick, true);
    }
    this.finishGesture();
    this.#container = null;
    this.#map = null;
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    const gesture: Gesture =
      event.button === 1
        ? 'pan'
        : event.button === 0 && event.shiftKey
          ? 'orbit'
          : null;
    if (gesture === null || this.#container === null) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.#gesture = gesture;
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    window.addEventListener('mousemove', this.handleMouseMove, true);
    window.addEventListener('mouseup', this.handleMouseUp, true);

    if (gesture !== 'orbit' || !this.#terrainOrbitEnabled || this.#map === null) return;

    const bounds = this.#container.getBoundingClientRect();
    this.#orbitAnchor = this.#map.unproject([
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    ]);
    this.pivotIndicator.show(this.#map, this.#orbitAnchor);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const gesture = this.#gesture;
    const map = this.#map;
    const previous = this.#lastPointer;
    if (gesture === null || map === null || previous === null) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const horizontalDelta = event.clientX - previous.x;
    const verticalDelta = event.clientY - previous.y;
    this.#lastPointer = { x: event.clientX, y: event.clientY };

    if (gesture === 'pan') {
      map.panBy([-horizontalDelta, -verticalDelta], { duration: 0 });
      return;
    }
    const anchor = this.#orbitAnchor;
    if (!this.#terrainOrbitEnabled || anchor === null) return;
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
    const isExpectedButton =
      (this.#gesture === 'pan' && event.button === 1) ||
      (this.#gesture === 'orbit' && event.button === 0);
    if (!isExpectedButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const suppressClick = this.#gesture === 'orbit';
    this.finishGesture();
    if (suppressClick) this.suppressNextClick();
  };

  private readonly handleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) event.preventDefault();
  };

  private suppressNextClick(): void {
    const handleClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener('click', handleClick, true);
    };
    window.addEventListener('click', handleClick, true);
    window.setTimeout(() => {
      window.removeEventListener('click', handleClick, true);
    }, 0);
  }

  private finishGesture(): void {
    this.#gesture = null;
    this.#orbitAnchor = null;
    this.#lastPointer = null;
    this.pivotIndicator.hide();
    window.removeEventListener('mousemove', this.handleMouseMove, true);
    window.removeEventListener('mouseup', this.handleMouseUp, true);
  }
}
