import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { MapLibrePointInspector } from '@/presentation/map/MapLibrePointInspector';

type MapListener = () => void;

class TestPoint {
  public constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}

  public add(other: TestPoint): TestPoint {
    return new TestPoint(this.x + other.x, this.y + other.y);
  }

  public _add(other: TestPoint): TestPoint {
    return this.add(other);
  }
}

class FakeNativeMap {
  readonly #listeners = new Map<string, Set<MapListener>>();
  readonly #container = document.createElement('div');
  readonly _canvasContainer = this.#container;
  readonly _ownerWindow = window;
  readonly _camera = {
    transform: {
      width: 800,
      height: 600,
      getCoveringTilesDetailsProvider: () => ({
        allowWorldCopies: () => false,
      }),
      isLocationOccluded: () => false,
    },
  };
  #projectedY = 100;

  public get transform() {
    return this._camera.transform;
  }

  public getContainer(): HTMLElement {
    return this.#container;
  }

  public getCanvasContainer(): HTMLElement {
    return this.#container;
  }

  public project(): TestPoint {
    return new TestPoint(400, this.#projectedY);
  }

  public on(type: string, listener: MapListener): this {
    const listeners = this.#listeners.get(type) ?? new Set<MapListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
    return this;
  }

  public off(type: string, listener: MapListener): this {
    this.#listeners.get(type)?.delete(listener);
    return this;
  }

  public once(type: string, listener: MapListener): this {
    return this.on(type, listener);
  }

  public loaded(): boolean {
    return false;
  }

  public isMoving(): boolean {
    return false;
  }

  public _getUIString(): string {
    return 'Map point';
  }

  public setProjectedY(y: number): void {
    this.#projectedY = y;
  }

  public dispatchMove(): void {
    for (const listener of this.#listeners.get('move') ?? []) {
      listener();
    }
  }
}

describe('MapLibrePointInspector', () => {
  it('places the reported 3D target popup below the point after first layout', () => {
    const scheduledFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      scheduledFrames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      scheduledFrames.delete(frameId);
    });
    const runAnimationFrames = () => {
      const callbacks = [...scheduledFrames.values()];
      scheduledFrames.clear();
      for (const callback of callbacks) callback(performance.now());
    };

    const nativeMap = new FakeNativeMap();
    const inspector = new MapLibrePointInspector();
    inspector.attach(nativeMap as unknown as MapLibreMap);
    inspector.show({
      status: 'open',
      coordinate: { longitude: 44.51866, latitude: 42.69657 },
      elevation: { status: 'loading' },
      nearbyPoi: { status: 'loading' },
    });

    const popup = nativeMap
      .getContainer()
      .querySelector<HTMLElement>('.maplibregl-popup');
    if (popup === null) throw new Error('Expected the MapLibre popup to render.');
    Object.defineProperties(popup, {
      offsetWidth: { configurable: true, value: 300 },
      offsetHeight: { configurable: true, value: 250 },
    });

    runAnimationFrames();
    expect(popup).toHaveClass('maplibregl-popup-anchor-top');

    nativeMap.setProjectedY(300);
    nativeMap.dispatchMove();
    expect(popup).toHaveClass('maplibregl-popup-anchor-bottom');

    inspector.destroy();
  });

  it('keeps only the point marker while the popup is disabled for the touch sheet', () => {
    const nativeMap = new FakeNativeMap();
    const container = nativeMap.getContainer();
    const inspector = new MapLibrePointInspector();
    inspector.attach(nativeMap as unknown as MapLibreMap);
    inspector.setPopupEnabled(false);
    inspector.show({
      status: 'open',
      coordinate: { longitude: 44.51866, latitude: 42.69657 },
      elevation: { status: 'loading' },
      nearbyPoi: { status: 'loading' },
    });

    expect(container.querySelector('.map-point-inspector__anchor')).not.toBeNull();
    expect(container.querySelector('.maplibregl-popup')).toBeNull();
    expect(inspector.isVisible()).toBe(true);

    inspector.setPopupEnabled(true);
    expect(container.querySelector('.maplibregl-popup')).not.toBeNull();

    inspector.close();
    expect(inspector.isVisible()).toBe(false);
    inspector.destroy();
  });
});
