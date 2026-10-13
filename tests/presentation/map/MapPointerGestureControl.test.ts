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
  const rotation = {
    disableRotation: vi.fn(),
    enableRotation: vi.fn(),
  };
  return {
    unproject,
    panBy,
    easeTo,
    rotation,
    map: {
      unproject,
      panBy,
      getBearing: () => camera.bearing,
      getPitch: () => camera.pitch,
      easeTo,
      touchZoomRotate: {
        disableRotation: rotation.disableRotation,
        enableRotation: rotation.enableRotation,
      },
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

  it('keeps a two-finger touch pan from rotating until the fingers lift', () => {
    const container = document.createElement('div');
    const { map, rotation } = createMapDouble();
    const control = new MapPointerGestureControl(createPivotDouble());
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', [
      [106, 296],
      [255, 297],
    ]);
    expect(rotation.disableRotation).not.toHaveBeenCalled();

    // The fingers twist slightly while dragging together, as a real pan does.
    dispatchTouch(container, 'touchmove', [
      [130, 280],
      [262, 302],
    ]);
    dispatchTouch(container, 'touchmove', [
      [160, 260],
      [290, 290],
    ]);
    expect(rotation.disableRotation).toHaveBeenCalledTimes(1);
    expect(rotation.enableRotation).not.toHaveBeenCalled();

    dispatchTouch(container, 'touchend', [[160, 260]]);
    expect(rotation.enableRotation).toHaveBeenCalledTimes(1);

    dispatchTouch(container, 'touchend', []);
    expect(rotation.enableRotation).toHaveBeenCalledTimes(1);
    control.detach();
  });

  it.each([
    [
      'a symmetric twist',
      [
        [100, 320],
        [250, 280],
      ],
    ],
    [
      'a twist around one held finger',
      [
        [100, 300],
        [240, 250],
      ],
    ],
    [
      'a pinch',
      [
        [70, 300],
        [280, 300],
      ],
    ],
    [
      'a twist past the threshold within the same move as a pan',
      [
        [200, 330],
        [350, 270],
      ],
    ],
  ] as const)('keeps touch rotation for %s', (_name, moved) => {
    const container = document.createElement('div');
    const { map, rotation } = createMapDouble();
    const control = new MapPointerGestureControl(createPivotDouble());
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    dispatchTouch(container, 'touchmove', moved);

    expect(rotation.disableRotation).not.toHaveBeenCalled();
    control.detach();
  });

  it('lets a twist that already passed the rotation threshold keep rotating while panning', () => {
    const container = document.createElement('div');
    const { map, rotation } = createMapDouble();
    const control = new MapPointerGestureControl(createPivotDouble());
    control.attach(container, map);

    dispatchTouch(container, 'touchstart', [
      [100, 300],
      [250, 300],
    ]);
    // About 22 degrees of twist, past MapLibre's roughly 19-degree threshold at this span.
    dispatchTouch(container, 'touchmove', [
      [100, 330],
      [250, 270],
    ]);
    dispatchTouch(container, 'touchmove', [
      [180, 340],
      [330, 300],
    ]);

    expect(rotation.disableRotation).not.toHaveBeenCalled();
    control.detach();
  });

  it('leaves three-finger touches to MapLibre', () => {
    const container = document.createElement('div');
    const { map, rotation } = createMapDouble();
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
      [100, 260],
      [250, 260],
      [175, 360],
    ]);

    expect(rotation.disableRotation).not.toHaveBeenCalled();
    control.detach();
  });

  it.each(['touchcancel', 'detach'] as const)(
    'restores touch rotation on %s mid-pan',
    (ending) => {
      const container = document.createElement('div');
      const { map, rotation } = createMapDouble();
      const control = new MapPointerGestureControl(createPivotDouble());
      control.attach(container, map);

      dispatchTouch(container, 'touchstart', [
        [100, 300],
        [250, 300],
      ]);
      dispatchTouch(container, 'touchmove', [
        [100, 260],
        [250, 260],
      ]);
      expect(rotation.disableRotation).toHaveBeenCalledTimes(1);

      if (ending === 'touchcancel') {
        // Cancellation ends MapLibre's gesture even while two other contacts remain.
        dispatchTouch(container, 'touchcancel', [
          [100, 260],
          [250, 260],
        ]);
      } else {
        control.detach();
      }
      expect(rotation.enableRotation).toHaveBeenCalledTimes(1);
      control.detach();
      expect(rotation.enableRotation).toHaveBeenCalledTimes(1);
    },
  );
});
