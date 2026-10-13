import { Marker, type LngLat, type Map as MapLibreMap } from 'maplibre-gl';

const bearingDegreesPerPixel = 0.28;
const pitchDegreesPerPixel = 0.175;
const maximumPitchDegrees = 75;
/** Travel each finger needs before a shared-direction two-finger move counts as a pan. */
const twoFingerPanDistancePixels = 10;
/** Minimum cosine between both fingers' travel directions for that pan. */
const twoFingerPanMinimumAlignment = 0.7;
/**
 * MapLibre's `TwoFingersTouchRotateHandler` starts rotating once the fingers twist this
 * far along the circle they span (its private `ROTATION_THRESHOLD`).
 */
const mapLibreRotationThresholdPixels = 25;

type Gesture = 'pan' | 'orbit' | null;
interface TouchStart {
  readonly identifier: number;
  readonly x: number;
  readonly y: number;
}
interface TouchVector {
  readonly x: number;
  readonly y: number;
}
/** A two-finger touch whose pan-or-twist intent is still undecided. */
interface TwoFingerTouch {
  readonly first: TouchStart;
  readonly second: TouchStart;
  /** Smallest finger span so far; MapLibre scales its rotation threshold by it. */
  minimumSpan: number;
}

/** Observes touches before MapLibre's listeners on the same container, never blocking them. */
const touchListenerOptions = { capture: true, passive: true } as const;

/** Returns how far the touch that began at `start` has moved, or null once it lifted. */
function touchTravel(touches: TouchList, start: TouchStart): TouchVector | null {
  for (const touch of touches) {
    if (touch.identifier === start.identifier) {
      return { x: touch.clientX - start.x, y: touch.clientY - start.y };
    }
  }
  return null;
}

function isSharedDirectionPan(first: TouchVector, second: TouchVector): boolean {
  const firstDistance = Math.hypot(first.x, first.y);
  const secondDistance = Math.hypot(second.x, second.y);
  return (
    firstDistance >= twoFingerPanDistancePixels &&
    secondDistance >= twoFingerPanDistancePixels &&
    (first.x * second.x + first.y * second.y) / (firstDistance * secondDistance) >=
      twoFingerPanMinimumAlignment
  );
}

/** Mirrors MapLibre's test for whether a two-finger twist has started rotating. */
function isPastMapLibreRotationThreshold(touch: TwoFingerTouch, vector: TouchVector) {
  const start = {
    x: touch.first.x - touch.second.x,
    y: touch.first.y - touch.second.y,
  };
  const twistDegrees =
    (Math.abs(
      Math.atan2(
        vector.x * start.y - vector.y * start.x,
        vector.x * start.x + vector.y * start.y,
      ),
    ) *
      180) /
    Math.PI;
  const thresholdDegrees =
    (mapLibreRotationThresholdPixels / (Math.PI * touch.minimumSpan)) * 360;
  return twistDegrees >= thresholdDegrees;
}

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
 * MapLibre's ordinary left and right button behavior. It also keeps a two-finger touch
 * pan from rotating: MapLibre rotates as soon as the fingers twist past a small
 * threshold, which an ordinary two-finger drag easily does. Once both fingers travel
 * together before any rotation starts, touch rotation stays off until they lift. A
 * twist that starts first still rotates and pans as before.
 */
export class MapPointerGestureControl {
  #container: HTMLElement | null = null;
  #map: MapLibreMap | null = null;
  #terrainOrbitEnabled = false;
  #gesture: Gesture = null;
  #gestureButton: 0 | 1 | null = null;
  #orbitAnchor: LngLat | null = null;
  #lastPointer: { readonly x: number; readonly y: number } | null = null;
  #twoFingerTouch: TwoFingerTouch | null = null;
  #touchRotationLocked = false;

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
    container.addEventListener(
      'touchstart',
      this.handleTouchStart,
      touchListenerOptions,
    );
    container.addEventListener('touchmove', this.handleTouchMove, touchListenerOptions);
    container.addEventListener('touchend', this.handleTouchEnd, touchListenerOptions);
    container.addEventListener(
      'touchcancel',
      this.handleTouchCancel,
      touchListenerOptions,
    );
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
      container.removeEventListener('touchstart', this.handleTouchStart, true);
      container.removeEventListener('touchmove', this.handleTouchMove, true);
      container.removeEventListener('touchend', this.handleTouchEnd, true);
      container.removeEventListener('touchcancel', this.handleTouchCancel, true);
    }
    this.finishGesture();
    this.finishTouchGesture();
    this.#container = null;
    this.#map = null;
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    const gesture: Gesture =
      event.button === 1
        ? this.#terrainOrbitEnabled
          ? 'orbit'
          : 'pan'
        : event.button === 0 && event.shiftKey && this.#terrainOrbitEnabled
          ? 'orbit'
          : null;
    if (gesture === null || this.#container === null) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.#gesture = gesture;
    this.#gestureButton = event.button === 0 ? 0 : 1;
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    window.addEventListener('mousemove', this.handleMouseMove, true);
    window.addEventListener('mouseup', this.handleMouseUp, true);

    if (gesture !== 'orbit' || this.#map === null) return;

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
    const gesture = this.#gesture;
    if (gesture === null || event.button !== this.#gestureButton) return;
    const suppressClick = gesture === 'orbit' && event.button === 0;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.finishGesture();
    if (suppressClick) this.suppressNextClick();
  };

  private readonly handleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) event.preventDefault();
  };

  private readonly handleTouchStart = (event: TouchEvent): void => {
    const [first, second] = [event.touches[0], event.touches[1]];
    if (
      event.touches.length !== 2 ||
      first === undefined ||
      second === undefined ||
      this.#touchRotationLocked
    ) {
      // A third finger makes the gesture neither a plain two-finger pan nor twist.
      this.#twoFingerTouch = null;
      return;
    }
    this.#twoFingerTouch = {
      first: { identifier: first.identifier, x: first.clientX, y: first.clientY },
      second: { identifier: second.identifier, x: second.clientX, y: second.clientY },
      minimumSpan: Math.hypot(
        first.clientX - second.clientX,
        first.clientY - second.clientY,
      ),
    };
  };

  /**
   * Runs in the capture phase, before MapLibre's own container listeners handle the same
   * move. A twist past MapLibre's threshold, even on the same move as a pan, is left to
   * rotate; otherwise a detected pan disables rotation before MapLibre can start it.
   * `map.isRotating()` cannot decide this because MapLibre only reports rotation after
   * its next render frame.
   */
  private readonly handleTouchMove = (event: TouchEvent): void => {
    const touch = this.#twoFingerTouch;
    const map = this.#map;
    if (touch === null || map === null) return;
    const first = touchTravel(event.touches, touch.first);
    const second = touchTravel(event.touches, touch.second);
    if (first === null || second === null) return;

    const vector = {
      x: touch.first.x + first.x - (touch.second.x + second.x),
      y: touch.first.y + first.y - (touch.second.y + second.y),
    };
    touch.minimumSpan = Math.min(touch.minimumSpan, Math.hypot(vector.x, vector.y));
    if (isPastMapLibreRotationThreshold(touch, vector)) {
      this.#twoFingerTouch = null;
    } else if (isSharedDirectionPan(first, second)) {
      this.#twoFingerTouch = null;
      this.#touchRotationLocked = true;
      map.touchZoomRotate.disableRotation();
    }
  };

  private readonly handleTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length < 2) this.finishTouchGesture();
  };

  /** MapLibre resets every touch handler on cancel, so the lock ends with it. */
  private readonly handleTouchCancel = (): void => {
    this.finishTouchGesture();
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
    this.#gestureButton = null;
    this.#orbitAnchor = null;
    this.#lastPointer = null;
    this.pivotIndicator.hide();
    window.removeEventListener('mousemove', this.handleMouseMove, true);
    window.removeEventListener('mouseup', this.handleMouseUp, true);
  }

  private finishTouchGesture(): void {
    this.#twoFingerTouch = null;
    if (!this.#touchRotationLocked) return;
    this.#touchRotationLocked = false;
    this.#map?.touchZoomRotate.enableRotation();
  }
}
