import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { MapPointerGestureControl } from '@/presentation/map/MapPointerGestureControl';

function createMapDouble() {
  const camera = { bearing: 10, pitch: 30 };
  const unproject = vi.fn(() => ({ lng: 44.8, lat: 41.7 }));
  const panBy = vi.fn();
  const easeTo = vi.fn(
    (options: { readonly bearing: number; readonly pitch: number }) => {
      camera.bearing = options.bearing;
      camera.pitch = options.pitch;
    },
  );
  const cameraPosition = { lng: 44.79, lat: 41.68 };
  const calculateCameraOptionsFromCameraLngLatAltRotation = vi.fn(
    (_position: unknown, _altitude: number, bearing: number, pitch: number) => ({
      center: { lng: 44.81, lat: 41.72 },
      zoom: 12.5,
      elevation: 1_500,
      bearing,
      pitch,
    }),
  );
  const originalThresholdCheck = vi.fn(() => true);
  const rotateHandler = { _isBelowThreshold: originalThresholdCheck };
  return {
    unproject,
    panBy,
    easeTo,
    cameraPosition,
    calculateCameraOptionsFromCameraLngLatAltRotation,
    originalThresholdCheck,
    /** Whether MapLibre's rotate handler would start rotating on the current move. */
    mayRotate: () => !rotateHandler._isBelowThreshold(),
    map: {
      unproject,
      panBy,
      getBearing: () => camera.bearing,
      getPitch: () => camera.pitch,
      getZoom: () => 12.5,
      getMinZoom: () => 0,
      getMaxZoom: () => 22,
      easeTo,
      calculateCameraOptionsFromCameraLngLatAltRotation,
      _camera: {
        transform: {
          getCameraLngLat: () => cameraPosition,
          getCameraAltitude: () => 4_200,
        },
      },
      touchZoomRotate: { _touchRotate: rotateHandler },
    } as unknown as MapLibreMap,
  };
}

/** Dispatches a touch event whose `touches` hold the listed fingers by identifier. */
function dispatchTouch(
  container: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  fingers: readonly (readonly [number, number])[],
) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'touches', {
    value: fingers.map(([clientX, clientY], identifier) => ({
      identifier,
      clientX,
      clientY,
    })),
  });
  container.dispatchEvent(event);
}

function createPivotDouble() {
  return { show: vi.fn(), hide: vi.fn() };
}

describe('MapPointerGestureControl', () => {
  it.each([false, true])(
    'pans in 2D and orbits the 3D camera with middle drag (%s)',
    (terrainEnabled) => {
      const container = document.createElement('div');
      const { easeTo, map, panBy, unproject } = createMapDouble();
      const pivot = createPivotDouble();
      const control = new MapPointerGestureControl({ pivotIndicator: pivot });
      control.attach(container, map);
      control.setTerrainOrbitEnabled(terrainEnabled);

      const down = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 1,
        buttons: 4,
        clientX: 10,
        clientY: 10,
      });
      container.dispatchEvent(down);
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          button: 1,
          buttons: 4,
          clientX: 110,
          clientY: -1_000,
        }),
      );
      const up = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: 1,
        buttons: 0,
      });
      window.dispatchEvent(up);
      const aux = new MouseEvent('auxclick', {
        bubbles: true,
        cancelable: true,
        button: 1,
      });
      container.dispatchEvent(aux);

      expect(down.defaultPrevented).toBe(true);
      expect(up.defaultPrevented).toBe(true);
      expect(aux.defaultPrevented).toBe(true);
      if (terrainEnabled) {
        expect(easeTo).toHaveBeenCalledWith(
          expect.objectContaining({
            around: { lng: 44.8, lat: 41.7 },
            bearing: 38,
            pitch: 75,
          }),
        );
        expect(panBy).not.toHaveBeenCalled();
        expect(unproject).toHaveBeenCalledWith([10, 10]);
        expect(pivot.show).toHaveBeenCalledWith(map, { lng: 44.8, lat: 41.7 });
      } else {
        expect(panBy).toHaveBeenCalledWith([-100, 1_010], { duration: 0 });
        expect(easeTo).not.toHaveBeenCalled();
        expect(unproject).not.toHaveBeenCalled();
        expect(pivot.show).not.toHaveBeenCalled();
      }
      control.detach();
    },
  );

  it('orbits only with Shift+left and terrain enabled, caps pitch, and suppresses click', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const mapClickListener = vi.fn();
    container.addEventListener('click', mapClickListener);
    const { easeTo, map, panBy, unproject } = createMapDouble();
    const pivot = createPivotDouble();
    const control = new MapPointerGestureControl({ pivotIndicator: pivot });
    control.attach(container, map);
    control.setTerrainOrbitEnabled(true);

    container.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        shiftKey: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: 110,
        clientY: -1_000,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 0,
      }),
    );

    expect(unproject).toHaveBeenCalledWith([10, 10]);
    expect(pivot.show).toHaveBeenCalledWith(map, { lng: 44.8, lat: 41.7 });
    expect(easeTo).toHaveBeenCalledWith(
      expect.objectContaining({
        around: { lng: 44.8, lat: 41.7 },
        bearing: 38,
        pitch: 75,
      }),
    );
    expect(panBy).not.toHaveBeenCalled();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    container.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(mapClickListener).not.toHaveBeenCalled();
    control.detach();
    container.remove();
  });

  it('turns the 3D camera in place with Ctrl+left, without a pivot, and suppresses click', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const mapClickListener = vi.fn();
    container.addEventListener('click', mapClickListener);
    const {
      calculateCameraOptionsFromCameraLngLatAltRotation,
      cameraPosition,
      easeTo,
      map,
      unproject,
    } = createMapDouble();
    const pivot = createPivotDouble();
    const control = new MapPointerGestureControl({ pivotIndicator: pivot });
    control.attach(container, map);
    control.setTerrainOrbitEnabled(true);

    container.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        ctrlKey: true,
        shiftKey: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: 110,
        clientY: -1_000,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }),
    );

    expect(unproject).not.toHaveBeenCalled();
    expect(pivot.show).not.toHaveBeenCalled();
    const [solvedPosition, solvedAltitude, solvedBearing, solvedPitch] =
      calculateCameraOptionsFromCameraLngLatAltRotation.mock.calls[0] ?? [];
    expect(solvedPosition).toBe(cameraPosition);
    expect(solvedAltitude).toBe(4_200);
    expect(solvedBearing).toBeCloseTo(29.6);
    expect(solvedPitch).toBe(75);
    expect(easeTo).toHaveBeenCalledOnce();
    expect(easeTo.mock.calls[0]?.[0]).toMatchObject({
      center: { lng: 44.81, lat: 41.72 },
      zoom: 12.5,
      elevation: 1_500,
      bearing: solvedBearing,
      pitch: 75,
      duration: 0,
      essential: true,
      freezeElevation: true,
    });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    container.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(mapClickListener).not.toHaveBeenCalled();
    control.detach();
    container.remove();
  });

  it('holds the look-around pitch where the fixed camera would exceed the zoom limit', () => {
    const container = document.createElement('div');
    const { calculateCameraOptionsFromCameraLngLatAltRotation, easeTo, map } =
      createMapDouble();
    calculateCameraOptionsFromCameraLngLatAltRotation.mockImplementation(
      (_position, _altitude, bearing, pitch) => ({
        center: { lng: 44.81, lat: 41.72 },
        zoom: pitch < 30 ? 22.4 : 21.9,
        elevation: 1_500,
        bearing,
        pitch,
      }),
    );
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);
    control.setTerrainOrbitEnabled(true);

    container.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 0,
        ctrlKey: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 30 }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));

    expect(easeTo).toHaveBeenCalledOnce();
    expect(easeTo.mock.calls[0]?.[0]).toMatchObject({ pitch: 30, zoom: 21.9 });
    expect(easeTo.mock.calls[0]?.[0].bearing).toBeCloseTo(11.96);
    control.detach();
  });

  it('moves the camera once per frame and settles once after a gesture that moved it', () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => frames.push(callback));
    const container = document.createElement('div');
    const { easeTo, map } = createMapDouble();
    const movingDuringSteps: boolean[] = [];
    const applyStep = easeTo.getMockImplementation();
    easeTo.mockImplementation((options) => {
      movingDuringSteps.push(control.movingCamera);
      applyStep?.(options);
    });
    const onCameraGestureEnd = vi.fn();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
      onCameraGestureEnd,
    });
    control.attach(container, map);
    control.setTerrainOrbitEnabled(true);
    const press = () => {
      container.dispatchEvent(
        new MouseEvent('mousedown', { button: 1, clientX: 0, clientY: 0 }),
      );
    };

    press();
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1 }));
    expect(onCameraGestureEnd).not.toHaveBeenCalled();

    press();
    for (const clientX of [10, 30, 50]) {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY: 0 }));
    }
    expect(easeTo).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(easeTo).toHaveBeenCalledOnce();
    expect(easeTo.mock.calls[0]?.[0].bearing).toBeCloseTo(24);

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1 }));
    expect(easeTo).toHaveBeenCalledTimes(2);
    expect(easeTo.mock.calls[1]?.[0].bearing).toBeCloseTo(26.8);
    expect(movingDuringSteps).toEqual([true, true]);
    expect(control.movingCamera).toBe(false);
    expect(onCameraGestureEnd).toHaveBeenCalledOnce();

    // A chorded Ctrl+left stays native, and losing focus ends the orbit with its
    // queued travel instead of waiting for a release that never arrives.
    press();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 0 }));
    const chord = new MouseEvent('mousedown', {
      button: 0,
      ctrlKey: true,
      cancelable: true,
    });
    container.dispatchEvent(chord);
    window.dispatchEvent(new Event('blur'));
    expect(chord.defaultPrevented).toBe(false);
    expect(easeTo).toHaveBeenCalledTimes(3);
    expect(easeTo.mock.calls[2]?.[0]).toMatchObject({
      around: { lng: 44.8, lat: 41.7 },
    });
    expect(easeTo.mock.calls[2]?.[0].bearing).toBeCloseTo(32.4);
    expect(onCameraGestureEnd).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 0 }));
    expect(frames).toHaveLength(3);
    control.detach();
    requestFrame.mockRestore();
  });

  it('leaves Shift+left, Ctrl+left, ordinary left, and right native in 2D', () => {
    const container = document.createElement('div');
    const nativeListener = vi.fn();
    const { easeTo, map, panBy } = createMapDouble();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);
    container.addEventListener('mousedown', nativeListener);

    const shiftDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      shiftKey: true,
    });
    const ctrlDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      ctrlKey: true,
    });
    container.dispatchEvent(shiftDown);
    container.dispatchEvent(ctrlDown);
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));

    expect(shiftDown.defaultPrevented).toBe(false);
    expect(ctrlDown.defaultPrevented).toBe(false);
    expect(easeTo).not.toHaveBeenCalled();
    expect(panBy).not.toHaveBeenCalled();
    expect(nativeListener).toHaveBeenCalledTimes(4);
    control.detach();
  });

  it('never rotates a two-finger drag that twists slightly, until the fingers lift', () => {
    const container = document.createElement('div');
    const { map, mayRotate } = createMapDouble();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', [
      [130, 280],
      [262, 302],
    ]);
    dispatchTouch(container, 'touchmove', [
      [160, 260],
      [290, 290],
    ]);
    // A large twist later in the same gesture still does not rotate.
    dispatchTouch(container, 'touchmove', [
      [160, 200],
      [290, 350],
    ]);
    expect(mayRotate()).toBe(false);

    dispatchTouch(container, 'touchend', []);
    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', [
      [100, 340],
      [250, 260],
    ]);
    expect(mayRotate()).toBe(true);
    control.detach();
  });

  it.each([
    [
      'a pinch-out that twists slightly',
      [
        [60, 305],
        [290, 292],
      ],
    ],
    [
      'a pinch-in that twists slightly',
      [
        [130, 295],
        [220, 300],
      ],
    ],
    [
      'a pinch with one held finger',
      [
        [100, 300],
        [300, 320],
      ],
    ],
  ] as const)('never rotates %s, even when it twists later', (_name, moved) => {
    const container = document.createElement('div');
    const { map, mayRotate } = createMapDouble();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', moved);
    dispatchTouch(container, 'touchmove', [
      [120, 360],
      [230, 240],
    ]);

    expect(mayRotate()).toBe(false);
    control.detach();
  });

  it.each([
    [
      'a symmetric twist',
      [
        [100, 340],
        [250, 260],
      ],
    ],
    [
      'a twist around one held finger',
      [
        [100, 300],
        [240, 250],
      ],
    ],
  ] as const)('rotates %s', (_name, moved) => {
    const container = document.createElement('div');
    const { map, mayRotate } = createMapDouble();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', moved);

    expect(mayRotate()).toBe(true);
    control.detach();
  });

  it('waits while a twist neither clearly outweighs a pinch nor is outweighed by it', () => {
    const container = document.createElement('div');
    const { map, mayRotate } = createMapDouble();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    // About 18 degrees of twist while each finger also pinches outward about 20 px.
    dispatchTouch(container, 'touchmove', [
      [84, 330],
      [266, 270],
    ]);

    expect(mayRotate()).toBe(false);
    control.detach();
  });

  it('keeps a twist that started first rotating while it pinches and pans', () => {
    const container = document.createElement('div');
    const { map, mayRotate } = createMapDouble();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', [
      [100, 330],
      [250, 270],
    ]);
    dispatchTouch(container, 'touchmove', [
      [140, 360],
      [370, 290],
    ]);

    expect(mayRotate()).toBe(true);
    control.detach();
  });

  it('does not let a new finger pair rotate from an earlier twist decision', () => {
    const container = document.createElement('div');
    const { map, mayRotate } = createMapDouble();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', [
      [100, 340],
      [250, 260],
    ]);
    expect(mayRotate()).toBe(true);

    dispatchTouch(container, 'touchstart', [
      [100, 340],
      [250, 260],
      [175, 400],
    ]);
    dispatchTouch(container, 'touchmove', [
      [100, 380],
      [250, 220],
      [175, 400],
    ]);

    expect(mayRotate()).toBe(false);
    control.detach();
  });

  it('ends the rotation decision on touchcancel and restores MapLibre on detach', () => {
    const container = document.createElement('div');
    const { map, mayRotate, originalThresholdCheck } = createMapDouble();
    const control = new MapPointerGestureControl({
      pivotIndicator: createPivotDouble(),
    });
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', [
      [100, 340],
      [250, 260],
    ]);
    expect(mayRotate()).toBe(true);
    dispatchTouch(container, 'touchcancel', [
      [100, 340],
      [250, 260],
    ]);
    expect(mayRotate()).toBe(false);

    control.detach();
    expect(originalThresholdCheck).not.toHaveBeenCalled();
    mayRotate();
    expect(originalThresholdCheck).toHaveBeenCalledTimes(1);
  });
});
