import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { CameraOrbitControl } from '@/presentation/map/CameraOrbitControl';

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
  return { show: vi.fn(), hide: vi.fn() };
}

describe('CameraOrbitControl', () => {
  it('orbits around the pressed point with restrained bearing and pitch deltas', () => {
    const container = document.createElement('div');
    const { easeTo, map, unproject } = createMapDouble();
    const pivot = createPivotDouble();
    const control = new CameraOrbitControl(pivot);
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

  it('orbits with Shift+left drag until the primary button releases', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const mapClickListener = vi.fn();
    container.addEventListener('click', mapClickListener);
    const { easeTo, map, unproject } = createMapDouble();
    const pivot = createPivotDouble();
    const control = new CameraOrbitControl(pivot);
    control.attach(container, map);
    control.setEnabled(true);
    pivot.hide.mockClear();

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
      new MouseEvent('mouseup', { bubbles: true, button: 1, buttons: 1 }),
    );
    expect(pivot.hide).not.toHaveBeenCalled();

    const mouseUp = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
    });
    window.dispatchEvent(mouseUp);
    expect(mouseUp.defaultPrevented).toBe(true);
    expect(pivot.hide).toHaveBeenCalledOnce();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    container.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(mapClickListener).not.toHaveBeenCalled();
    control.detach();
    container.remove();
  });

  it('limits a low camera angle to 75 degrees', () => {
    const container = document.createElement('div');
    const { easeTo, map } = createMapDouble();
    const control = new CameraOrbitControl(createPivotDouble());
    control.attach(container, map);
    control.setEnabled(true);

    container.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 1,
        buttons: 4,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        button: 1,
        buttons: 4,
        clientY: -1_000,
      }),
    );

    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 75 }));
    control.detach();
  });

  it.each([
    ['middle drag', 1, 4, false],
    ['Shift+left drag', 0, 1, true],
  ])(
    'consumes %s without moving the camera while 2D is active',
    (_gesture, button, buttons, shiftKey) => {
      const container = document.createElement('div');
      const { easeTo, map } = createMapDouble();
      const pivot = createPivotDouble();
      const control = new CameraOrbitControl(pivot);
      control.attach(container, map);
      const down = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button,
        buttons,
        shiftKey,
      });
      const move = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        button,
        buttons,
      });
      const up = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button,
        buttons: 0,
      });

      container.dispatchEvent(down);
      window.dispatchEvent(move);
      window.dispatchEvent(up);

      expect(down.defaultPrevented).toBe(true);
      expect(move.defaultPrevented).toBe(true);
      expect(up.defaultPrevented).toBe(true);
      expect(easeTo).not.toHaveBeenCalled();
      expect(pivot.show).not.toHaveBeenCalled();
      control.detach();
    },
  );

  it('leaves an ordinary left drag available to native map listeners', () => {
    const container = document.createElement('div');
    const nativeListener = vi.fn();
    const { map, unproject } = createMapDouble();
    const control = new CameraOrbitControl(createPivotDouble());
    control.attach(container, map);
    control.setEnabled(true);
    container.addEventListener('mousedown', nativeListener);

    const down = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
    });
    container.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(false);
    expect(nativeListener).toHaveBeenCalledOnce();
    expect(unproject).not.toHaveBeenCalled();
    control.detach();
  });

  it('leaves native right-button and context-menu events available', () => {
    const container = document.createElement('div');
    const mouseDownListener = vi.fn();
    const contextMenuListener = vi.fn();
    container.addEventListener('mousedown', mouseDownListener);
    container.addEventListener('contextmenu', contextMenuListener);
    const control = new CameraOrbitControl(createPivotDouble());
    control.attach(container);
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
    container.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(mouseDownListener).toHaveBeenCalledOnce();
    expect(contextMenuListener).toHaveBeenCalledOnce();
    control.detach();
  });
});
