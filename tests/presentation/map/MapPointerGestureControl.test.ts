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
  return {
    unproject,
    panBy,
    easeTo,
    map: {
      unproject,
      panBy,
      getBearing: () => camera.bearing,
      getPitch: () => camera.pitch,
      easeTo,
    } as unknown as MapLibreMap,
  };
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
});
