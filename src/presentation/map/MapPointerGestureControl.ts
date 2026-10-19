import { Marker, type LngLat, type Map as MapLibreMap } from 'maplibre-gl';

const bearingDegreesPerPixel = 0.28;
const pitchDegreesPerPixel = 0.175;
/** Share of the orbit rate that look-around turns per pixel, for finer aiming. */
const lookSensitivity = 0.4;
const maximumPitchDegrees = 75;
/** Pointer moves this recent set the release velocity; an older last move is a stop. */
const releaseVelocityWindowMs = 50;
/** Decay time of the coast after release; it adds about release speed × this of travel. */
const coastTimeConstantMs = 60;
/** Coasting stops, or never starts, below this speed in pixels per millisecond. */
const coastStopSpeed = 0.02;
/** Per-finger pinch or pan travel that decides a two-finger touch as zoom-or-pan. */
const zoomOrPanIntentPixels = 10;
/** How many times the other movement the deciding movement must reach. */
const intentDominance = 1.5;
/** Per-finger twist along the finger circle needed before a touch may rotate. */
const rotationIntentPixels = 25;
/** Minimum twist angle before a touch may rotate, so wide finger spans need a real turn. */
const rotationIntentDegrees = 15;

type TwoFingerIntent = 'zoom-or-pan' | 'rotate';

/**
 * `orbit` turns the camera around the terrain point under the press; `look` turns it in
 * place, around the camera position itself.
 */
type Gesture = 'pan' | 'orbit' | 'look' | null;
interface TouchStart {
  readonly identifier: number;
  readonly x: number;
  readonly y: number;
}
interface TouchVector {
  readonly x: number;
  readonly y: number;
}
/** Pointer travel since the previous move, stamped with the event time. */
interface PointerMove {
  readonly time: number;
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

/** Observes events before MapLibre's listeners on the same container, never blocking them. */
const observerListenerOptions = { capture: true, passive: true } as const;

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

interface OrbitPivotIndicator {
  show(map: MapLibreMap, coordinate: LngLat): void;
  hide(): void;
}

/** Reuses one terrain-aware MapLibre marker for the active 3D orbit pivot. */
function createOrbitPivotIndicator(): OrbitPivotIndicator {
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
 * Owns middle-button panning, Shift+left terrain orbit, and Ctrl+left look-around
 * gestures without changing MapLibre's ordinary left and right button behavior. It also
 * decides when a two-finger touch may rotate. MapLibre alone rotates once the fingers
 * twist about 25 px, which an ordinary pinch-zoom or two-finger drag easily does,
 * especially with fingers spread wide. This control replaces that threshold check:
 * rotation starts only after the twist clearly outweighs the pinch and pan, and never in
 * a gesture already decided as zoom-or-pan.
 */
export class MapPointerGestureControl {
  #container: HTMLElement | null = null;
  #map: MapLibreMap | null = null;
  #terrainOrbitEnabled = false;
  #gesture: Gesture = null;
  #gestureButton: 0 | 1 | null = null;
  #orbitAnchor: LngLat | null = null;
  #lastPointer: { readonly x: number; readonly y: number } | null = null;
  /** Pointer travel not yet applied; the camera moves at most once per frame. */
  #pendingDelta = { x: 0, y: 0 };
  #frameRequest: number | null = null;
  #cameraMoved = false;
  #movingCamera = false;
  /** Recent pointer moves of the held gesture, oldest first, for the release velocity. */
  #recentMoves: readonly PointerMove[] = [];
  /** Pixels per millisecond while a released gesture coasts; null while held or idle. */
  #coastVelocity: { readonly x: number; readonly y: number } | null = null;
  #lastCoastFrameTime = 0;
  #twoFingerTouch: TwoFingerTouch | null = null;
  /** Decision for the current two-finger gesture; null until one movement dominates. */
  #twoFingerIntent: TwoFingerIntent | null = null;
  #restoreRotationThreshold: (() => void) | null = null;
  readonly #pivotIndicator: OrbitPivotIndicator;
  readonly #onCameraGestureEnd: () => void;

  /**
   * Every gesture step is its own zero-duration MapLibre move with its own `moveend`.
   * The owner treats the whole gesture as one movement: it skips the `moveend`s fired
   * while `movingCamera` is true and settles once in `onCameraGestureEnd`, which runs
   * when a gesture that moved the camera ends: after its release coast, on focus loss,
   * on another press or wheel during the coast, when 3D turns off, or on detach. A
   * keyboard or programmatic movement replacing the coast settles through its own
   * `moveend` instead.
   */
  public constructor({
    pivotIndicator = createOrbitPivotIndicator(),
    onCameraGestureEnd = () => undefined,
  }: {
    readonly pivotIndicator?: OrbitPivotIndicator;
    readonly onCameraGestureEnd?: () => void;
  } = {}) {
    this.#pivotIndicator = pivotIndicator;
    this.#onCameraGestureEnd = onCameraGestureEnd;
  }

  /** True only while a gesture step synchronously moves the camera. */
  public get movingCamera(): boolean {
    return this.#movingCamera;
  }

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
      observerListenerOptions,
    );
    container.addEventListener(
      'touchmove',
      this.handleTouchMove,
      observerListenerOptions,
    );
    container.addEventListener(
      'touchend',
      this.handleTouchEnd,
      observerListenerOptions,
    );
    container.addEventListener(
      'touchcancel',
      this.handleTouchCancel,
      observerListenerOptions,
    );
  }

  /** Allows the 3D camera gestures, orbit and look-around; disabling ends a running one. */
  public setTerrainOrbitEnabled(enabled: boolean): void {
    this.#terrainOrbitEnabled = enabled;
    if (!enabled && (this.#gesture === 'orbit' || this.#gesture === 'look')) {
      this.endGesture();
    }
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
    this.endGesture();
    this.finishTouchGesture();
    this.#restoreRotationThreshold?.();
    this.#restoreRotationThreshold = null;
    this.#container = null;
    this.#map = null;
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    // Any press stops a coast, and a chorded press stays native while a gesture is held.
    if (this.#coastVelocity !== null) this.endGesture();
    if (this.#gesture !== null) return;
    const gesture: Gesture =
      event.button === 1
        ? this.#terrainOrbitEnabled
          ? 'orbit'
          : 'pan'
        : event.button === 0 && this.#terrainOrbitEnabled
          ? event.ctrlKey
            ? 'look'
            : event.shiftKey
              ? 'orbit'
              : null
          : null;
    if (gesture === null || this.#container === null) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.#gesture = gesture;
    this.#gestureButton = event.button === 0 ? 0 : 1;
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    window.addEventListener('mousemove', this.handleMouseMove, true);
    window.addEventListener('mouseup', this.handleMouseUp, true);
    // Without focus the release never arrives, so the gesture ends here instead.
    window.addEventListener('blur', this.handleWindowBlur);

    if (gesture !== 'orbit' || this.#map === null) return;

    const bounds = this.#container.getBoundingClientRect();
    this.#orbitAnchor = this.#map.unproject([
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    ]);
    this.#pivotIndicator.show(this.#map, this.#orbitAnchor);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const previous = this.#lastPointer;
    if (this.#gesture === null || previous === null) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const move: PointerMove = {
      time: event.timeStamp,
      x: event.clientX - previous.x,
      y: event.clientY - previous.y,
    };
    // Mice report moves faster than the display refreshes, and every camera update runs
    // MapLibre's full camera pipeline, so moves only accumulate until the next frame.
    this.#pendingDelta = {
      x: this.#pendingDelta.x + move.x,
      y: this.#pendingDelta.y + move.y,
    };
    this.#recentMoves = [
      ...this.#recentMoves.filter(
        (recent) => move.time - recent.time <= releaseVelocityWindowMs,
      ),
      move,
    ];
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    this.#frameRequest ??= window.requestAnimationFrame(this.applyPendingMove);
  };

  private readonly applyPendingMove = (): void => {
    this.#frameRequest = null;
    const gesture = this.#gesture;
    const map = this.#map;
    const { x: horizontalDelta, y: verticalDelta } = this.#pendingDelta;
    this.#pendingDelta = { x: 0, y: 0 };
    if (gesture === null || map === null) return;
    if (horizontalDelta === 0 && verticalDelta === 0) return;
    this.#movingCamera = true;
    try {
      if (this.moveCamera(gesture, map, horizontalDelta, verticalDelta)) {
        this.#cameraMoved = true;
      }
    } finally {
      this.#movingCamera = false;
    }
  };

  /** Applies one frame of pointer travel; returns whether the camera was moved. */
  private moveCamera(
    gesture: Exclude<Gesture, null>,
    map: MapLibreMap,
    horizontalDelta: number,
    verticalDelta: number,
  ): boolean {
    if (gesture === 'pan') {
      map.panBy([-horizontalDelta, -verticalDelta], { duration: 0 });
      return true;
    }
    if (!this.#terrainOrbitEnabled) return false;
    const look = gesture === 'look';
    // Orbit follows MapLibre's drag-right-to-turn and drag-up-to-tilt. Look-around drags
    // the view with the pointer instead, so both axes turn the opposite way, more finely.
    const rate = look ? -lookSensitivity : 1;
    const bearing = map.getBearing() + horizontalDelta * bearingDegreesPerPixel * rate;
    const pitch = Math.min(
      maximumPitchDegrees,
      Math.max(0, map.getPitch() - verticalDelta * pitchDegreesPerPixel * rate),
    );
    if (look) {
      // MapLibre solves the center and zoom that keep the camera where it is with the
      // new rotation. That center sits at the current center elevation, so the elevation
      // stays frozen through the jump; once it ends, MapLibre moves the center along the
      // same view ray onto the terrain without moving the camera. The camera position is
      // only exposed on the rendered transform, underscored but part of MapLibre's typings.
      const { transform } = map._camera;
      const cameraPosition = transform.getCameraLngLat();
      const cameraAltitude = transform.getCameraAltitude();
      let camera = map.calculateCameraOptionsFromCameraLngLatAltRotation(
        cameraPosition,
        cameraAltitude,
        bearing,
        pitch,
      );
      // A lower pitch shortens the view ray and raises the zoom. MapLibre would clamp a
      // zoom past its limits and move the camera, so the pitch holds there instead; a
      // turn alone keeps the ray length and so the zoom.
      const zoom = camera.zoom ?? map.getZoom();
      if (zoom > map.getMaxZoom() || zoom < map.getMinZoom()) {
        camera = map.calculateCameraOptionsFromCameraLngLatAltRotation(
          cameraPosition,
          cameraAltitude,
          bearing,
          map.getPitch(),
        );
      }
      map.easeTo({ ...camera, duration: 0, essential: true, freezeElevation: true });
      return true;
    }
    const anchor = this.#orbitAnchor;
    if (anchor === null) return false;
    map.easeTo({
      around: anchor,
      bearing,
      pitch,
      duration: 0,
      essential: true,
    });
    return true;
  }

  private readonly handleMouseUp = (event: MouseEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.button !== this.#gestureButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (gesture !== 'pan' && event.button === 0) this.suppressNextClick();
    this.releaseGesture(event.timeStamp);
  };

  private readonly handleWindowBlur = (): void => {
    this.endGesture();
  };

  private readonly handleCoastWheel = (): void => {
    this.endGesture();
  };

  /**
   * A keyboard, search, or fit movement replaces the coast: the next coast frame would
   * stop its animation. That movement's own `moveend` settles the view, so the coast
   * ends without settling.
   */
  private readonly handleCoastInterruption = (): void => {
    if (!this.#movingCamera) this.finishGesture();
  };

  /**
   * Ends a held gesture. A pointer still moving at release coasts on for a moment with
   * exponentially decaying speed, like Google Earth's slight inertia; one that had
   * stopped ends at once.
   */
  private releaseGesture(time: number): void {
    const moves = this.#recentMoves.filter(
      (move) => time - move.time <= releaseVelocityWindowMs,
    );
    // The oldest move only marks when the window starts; its travel happened before.
    const span = moves.length < 2 ? 0 : time - (moves[0]?.time ?? time);
    let travelX = 0;
    let travelY = 0;
    for (const move of moves.slice(1)) {
      travelX += move.x;
      travelY += move.y;
    }
    if (span <= 0 || Math.hypot(travelX, travelY) / span < coastStopSpeed) {
      this.endGesture();
      return;
    }
    window.removeEventListener('mousemove', this.handleMouseMove, true);
    window.removeEventListener('mouseup', this.handleMouseUp, true);
    this.#container?.addEventListener(
      'wheel',
      this.handleCoastWheel,
      observerListenerOptions,
    );
    this.#map?.on('movestart', this.handleCoastInterruption);
    if (this.#frameRequest !== null) {
      window.cancelAnimationFrame(this.#frameRequest);
      this.applyPendingMove();
    }
    this.#coastVelocity = { x: travelX / span, y: travelY / span };
    // Event and frame times share one clock, so the first frame coasts from the release.
    this.#lastCoastFrameTime = time;
    this.#frameRequest = window.requestAnimationFrame(this.coast);
  }

  private readonly coast = (time: number): void => {
    this.#frameRequest = null;
    const velocity = this.#coastVelocity;
    if (velocity === null) return;
    // A frame's time is when it began, which can precede the release event within it.
    const elapsed = Math.min(Math.max(time - this.#lastCoastFrameTime, 0), 100);
    this.#lastCoastFrameTime = time;
    // Travel of the decaying velocity over this frame, exact for any frame length.
    const decay = Math.exp(-elapsed / coastTimeConstantMs);
    const travel = coastTimeConstantMs * (1 - decay);
    this.#pendingDelta = { x: velocity.x * travel, y: velocity.y * travel };
    this.#coastVelocity = { x: velocity.x * decay, y: velocity.y * decay };
    this.applyPendingMove();
    if (Math.hypot(velocity.x, velocity.y) * decay < coastStopSpeed) {
      this.endGesture();
      return;
    }
    this.#frameRequest = window.requestAnimationFrame(this.coast);
  };

  /** Applies travel still waiting for a frame, ends the gesture, and settles a move. */
  private endGesture(): void {
    if (this.#frameRequest !== null) {
      window.cancelAnimationFrame(this.#frameRequest);
      this.applyPendingMove();
    }
    const cameraMoved = this.#cameraMoved;
    this.finishGesture();
    if (cameraMoved) this.#onCameraGestureEnd();
  }

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
    if (this.#frameRequest !== null) window.cancelAnimationFrame(this.#frameRequest);
    this.#frameRequest = null;
    this.#pendingDelta = { x: 0, y: 0 };
    this.#cameraMoved = false;
    this.#recentMoves = [];
    this.#coastVelocity = null;
    this.#lastCoastFrameTime = 0;
    this.#gesture = null;
    this.#gestureButton = null;
    this.#orbitAnchor = null;
    this.#lastPointer = null;
    this.#pivotIndicator.hide();
    window.removeEventListener('mousemove', this.handleMouseMove, true);
    window.removeEventListener('mouseup', this.handleMouseUp, true);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.#container?.removeEventListener(
      'wheel',
      this.handleCoastWheel,
      observerListenerOptions,
    );
    this.#map?.off('movestart', this.handleCoastInterruption);
  }

  private finishTouchGesture(): void {
    this.#twoFingerTouch = null;
    this.#twoFingerIntent = null;
  }
}
