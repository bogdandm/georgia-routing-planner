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
  const originalThresholdCheck = vi.fn(() => true);
  const rotateHandler = { _isBelowThreshold: originalThresholdCheck };
  return {
    unproject,
    panBy,
    easeTo,
    originalThresholdCheck,
    /** Whether MapLibre's rotate handler would start rotating on the current move. */
    mayRotate: () => !rotateHandler._isBelowThreshold(),
    map: {
      unproject,
      panBy,
      getBearing: () => camera.bearing,
      getPitch: () => camera.pitch,
      easeTo,
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
      const control = new MapPointerGestureControl(pivot);
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
    const control = new MapPointerGestureControl(pivot);
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

  it('leaves Shift+left, ordinary left, and right native in 2D', () => {
    const container = document.createElement('div');
    const nativeListener = vi.fn();
    const { easeTo, map, panBy } = createMapDouble();
    const control = new MapPointerGestureControl(createPivotDouble());
    control.attach(container, map);
    container.addEventListener('mousedown', nativeListener);

    const shiftDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      shiftKey: true,
    });
    container.dispatchEvent(shiftDown);
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));

    expect(shiftDown.defaultPrevented).toBe(false);
    expect(easeTo).not.toHaveBeenCalled();
    expect(panBy).not.toHaveBeenCalled();
    expect(nativeListener).toHaveBeenCalledTimes(3);
    control.detach();
  });

  it('never rotates a two-finger drag that twists slightly, until the fingers lift', () => {
    const container = document.createElement('div');
    const { map, mayRotate } = createMapDouble();
    const control = new MapPointerGestureControl(createPivotDouble());
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
    const control = new MapPointerGestureControl(createPivotDouble());
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
    const control = new MapPointerGestureControl(createPivotDouble());
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
    const control = new MapPointerGestureControl(createPivotDouble());
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
    const control = new MapPointerGestureControl(createPivotDouble());
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

  it('does not rotate three-finger touches', () => {
    const container = document.createElement('div');
    const { map, mayRotate } = createMapDouble();
    const control = new MapPointerGestureControl(createPivotDouble());
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
      [175, 400],
    ]);
    dispatchTouch(container, 'touchmove', [
      [100, 340],
      [250, 260],
      [175, 400],
    ]);

    expect(mayRotate()).toBe(false);
    control.detach();
  });

  it('ends the rotation decision on touchcancel and restores MapLibre on detach', () => {
    const container = document.createElement('div');
    const { map, mayRotate, originalThresholdCheck } = createMapDouble();
    const control = new MapPointerGestureControl(createPivotDouble());
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
