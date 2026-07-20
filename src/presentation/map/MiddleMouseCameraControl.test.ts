import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { MiddleMouseCameraControl } from '@/presentation/map/MiddleMouseCameraControl';

function createMapDouble() {
  const camera = { bearing: 10, pitch: 30 };
  const unproject = vi.fn(() => ({ lng: 44.8, lat: 41.7 }));
  const easeTo = vi.fn(
    (options: { readonly bearing: number; readonly pitch: number }) => {
      camera.bearing = options.bearing;
      camera.pitch = options.pitch;
    },
  );
  return {
    camera,
    unproject,
    easeTo,
    map: {
      unproject,
      getBearing: () => camera.bearing,
      getPitch: () => camera.pitch,
      easeTo,
    } as unknown as MapLibreMap,
  };
}

function createPivotDouble() {
  return { show: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
}

describe('MiddleMouseCameraControl', () => {
  it('orbits around the pressed point with restrained bearing and pitch deltas', () => {
    const container = document.createElement('div');
    const { easeTo, map, unproject } = createMapDouble();
    const pivot = createPivotDouble();
    const control = new MiddleMouseCameraControl(pivot);
    control.attach(container, map);
    control.setEnabled(true);

    container.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 1,
        buttons: 4,
        clientX: 10,
        clientY: 10,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        button: 1,
        buttons: 4,
        clientX: 110,
        clientY: -90,
      }),
    );

    expect(unproject).toHaveBeenCalledWith([10, 10]);
    expect(pivot.show).toHaveBeenCalledWith(map, { lng: 44.8, lat: 41.7 });
    expect(easeTo).toHaveBeenCalledWith({
      around: { lng: 44.8, lat: 41.7 },
      bearing: 38,
      pitch: 47.5,
      duration: 0,
      essential: true,
    });
    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 1, buttons: 0 }),
    );
    expect(pivot.hide).toHaveBeenCalled();
    control.detach();
  });

  it('consumes middle drag without moving the camera while 2D is active', () => {
    const container = document.createElement('div');
    const { easeTo, map } = createMapDouble();
    const pivot = createPivotDouble();
    const control = new MiddleMouseCameraControl(pivot);
    control.attach(container, map);
    const down = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 1,
      buttons: 4,
    });
    container.dispatchEvent(down);
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, button: 1, buttons: 4 }),
    );
    expect(down.defaultPrevented).toBe(true);
    expect(easeTo).not.toHaveBeenCalled();
    expect(pivot.show).not.toHaveBeenCalled();
  });

  it('blocks native right-button camera input and removes listeners on detach', () => {
    const container = document.createElement('div');
    const bubbleListener = vi.fn();
    container.addEventListener('mousedown', bubbleListener);
    const control = new MiddleMouseCameraControl(createPivotDouble());
    control.attach(container);
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
    expect(bubbleListener).not.toHaveBeenCalled();

    control.detach();
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
    expect(bubbleListener).toHaveBeenCalledOnce();
  });
});
