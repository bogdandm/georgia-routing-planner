import { Marker, type LngLat, type Map as MapLibreMap } from 'maplibre-gl';

const bearingDegreesPerPixel = 0.28;
const pitchDegreesPerPixel = 0.175;
const maximumPitchDegrees = 75;
/** Per-finger pinch or pan travel that decides a two-finger touch as zoom-or-pan. */
const zoomOrPanIntentPixels = 10;
/** How many times the other movement the deciding movement must reach. */
const intentDominance = 1.5;
/** Per-finger twist along the finger circle needed before a touch may rotate. */
const rotationIntentPixels = 25;
/** Minimum twist angle before a touch may rotate, so wide finger spans need a real turn. */
const rotationIntentDegrees = 15;

type TwoFingerIntent = 'zoom-or-pan' | 'rotate';

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
/** A two-finger touch whose zoom-pan-or-twist intent is still undecided. */
interface TwoFingerTouch {
  readonly first: TouchStart;
  readonly second: TouchStart;
  /** Smallest finger span so far, which keeps a pinch-in from inflating the twist. */
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

/**
 * Decides a two-finger touch from each finger's share of pinch, pan, and twist since it
 * began. A movement decides only once it clearly outweighs the others, so a pinch or
 * drag that twists a little never rotates and a deliberate twist never needs to zoom.
 */
function classifyTwoFingerMove(
  touch: TwoFingerTouch,
  first: TouchVector,
  second: TouchVector,
): TwoFingerIntent | null {
  const start = {
    x: touch.first.x - touch.second.x,
    y: touch.first.y - touch.second.y,
  };
  const current = { x: start.x + first.x - second.x, y: start.y + first.y - second.y };
  const span = Math.hypot(current.x, current.y);
  touch.minimumSpan = Math.min(touch.minimumSpan, span);

  const twistRadians = Math.abs(
    Math.atan2(
      current.x * start.y - current.y * start.x,
      current.x * start.x + current.y * start.y,
    ),
  );
  const twist = (twistRadians * touch.minimumSpan) / 2;
  const pinch = Math.abs(span - Math.hypot(start.x, start.y)) / 2;
  // Travel both fingers share: a twist around one held finger moves only the other one,
  // so it adds no pan even though the midpoint moves.
  const longerTravel = Math.max(
    Math.hypot(first.x, first.y),
    Math.hypot(second.x, second.y),
  );
  const pan =
    longerTravel === 0
      ? 0
      : Math.max(0, first.x * second.x + first.y * second.y) / longerTravel;
  const zoomOrPan = Math.max(pinch, pan);

  if (zoomOrPan >= zoomOrPanIntentPixels && zoomOrPan >= intentDominance * twist) {
    return 'zoom-or-pan';
  }
  if (
    twist >= rotationIntentPixels &&
    (twistRadians * 180) / Math.PI >= rotationIntentDegrees &&
    twist >= intentDominance * zoomOrPan
  ) {
    return 'rotate';
  }
  return null;
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
 * MapLibre's ordinary left and right button behavior. It also decides when a two-finger
 * touch may rotate. MapLibre alone rotates once the fingers twist about 25 px, which an
 * ordinary pinch-zoom or two-finger drag easily does, especially with fingers spread
 * wide. This control replaces that threshold check: rotation starts only after the
 * twist clearly outweighs the pinch and pan, and never in a gesture already decided as
 * zoom-or-pan.
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
  /** Decision for the current two-finger gesture; null until one movement dominates. */
  #twoFingerIntent: TwoFingerIntent | null = null;
  #restoreRotationThreshold: (() => void) | null = null;

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
    if (map !== undefined) this.gateTouchRotation(map);
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
    this.#restoreRotationThreshold?.();
    this.#restoreRotationThreshold = null;
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

  /**
   * MapLibre's `TwoFingersTouchRotateHandler` asks `_isBelowThreshold` on every move
   * until rotation starts, then rotates for the rest of the gesture. Answering from the
   * gesture intent is the only way to delay rotation without losing the gesture:
   * `disableRotation()` resets the handler, and enabling it again mid-gesture cannot
   * resume. The handler and method are underscored but part of MapLibre's typings.
   */
  private gateTouchRotation(map: MapLibreMap): void {
    const rotateHandler = map.touchZoomRotate._touchRotate;
    const originalThresholdCheck = rotateHandler._isBelowThreshold.bind(rotateHandler);
    rotateHandler._isBelowThreshold = () => this.#twoFingerIntent !== 'rotate';
    this.#restoreRotationThreshold = () => {
      rotateHandler._isBelowThreshold = originalThresholdCheck;
    };
  }

  private readonly handleTouchStart = (event: TouchEvent): void => {
    this.#twoFingerIntent = null;
    const [first, second] = [event.touches[0], event.touches[1]];
    if (event.touches.length !== 2 || first === undefined || second === undefined) {
      // Any other touch count drops the pair, so no later MapLibre pair can start
      // rotating from a stale decision. A rotation already running keeps going.
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
   * move, so a twist decided here starts rotating on this move.
   */
  private readonly handleTouchMove = (event: TouchEvent): void => {
    const touch = this.#twoFingerTouch;
    if (touch === null) return;
    const first = touchTravel(event.touches, touch.first);
    const second = touchTravel(event.touches, touch.second);
    if (first === null || second === null) return;

    const intent = classifyTwoFingerMove(touch, first, second);
    if (intent === null) return;
    this.#twoFingerIntent = intent;
    this.#twoFingerTouch = null;
  };

  private readonly handleTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length < 2) this.finishTouchGesture();
  };

  /** MapLibre resets every touch handler on cancel, so the gesture ends here too. */
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
    this.#twoFingerIntent = null;
  }
}
