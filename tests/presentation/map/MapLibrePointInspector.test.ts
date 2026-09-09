import type { Map as MapLibreMap } from 'maplibre-gl';
import { within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  MapLibrePointInspector,
  renderPointInspectorContent,
} from '@/presentation/map/MapLibrePointInspector';

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

describe('renderPointInspectorContent', () => {
  it('renders safe formatted values and accessible current-inspection actions', () => {
    const container = document.createElement('div');
    const onClose = vi.fn();
    const onCopyLink = vi.fn();
    const onCreateMarker = vi.fn();
    const inspection = {
      status: 'open' as const,
      coordinate: { longitude: 44.801234, latitude: 41.712345 },
      elevation: { status: 'available' as const, meters: 1_234.4 },
      nearbyPoi: {
        status: 'found' as const,
        poi: {
          name: '<script>fixture hut</script>',
          category: 'alpine_hut',
          distanceMeters: 42.2,
        },
      },
    };
    renderPointInspectorContent(container, inspection, {
      onClose,
      onCopyLink,
      onCreateMarker,
    });
    expect(container.textContent).toContain('44.80123, 41.71235');
    expect(container.textContent).toContain('1,234 m');
    expect(container.textContent).toContain(
      '<script>fixture hut</script> (alpine hut), 42 m away',
    );
    expect(container.textContent).not.toContain('—');
    expect(container.querySelector('script')).toBeNull();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.map((link) => link.textContent)).toEqual([
      'Wikipedia',
      'Google Search',
    ]);
    expect(links.map((link) => link.href)).toEqual([
      'https://en.wikipedia.org/wiki/%3Cscript%3Efixture_hut%3C%2Fscript%3E',
      'https://www.google.com/search?q=%3Cscript%3Efixture%20hut%3C%2Fscript%3E%20Georgia',
    ]);
    expect(links.every((link) => link.target === '_blank')).toBe(true);
    expect(links.every((link) => link.rel === 'noopener noreferrer')).toBe(true);
    const buttons = within(container).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      '×',
      'Copy link',
      'Create marker',
    ]);
    within(container).getByRole('button', { name: 'Close map point details' }).click();
    within(container).getByRole('button', { name: 'Copy link' }).click();
    within(container).getByRole('button', { name: 'Create marker' }).click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCopyLink).toHaveBeenCalledWith(inspection);
    expect(onCreateMarker).toHaveBeenCalledWith(inspection);
  });

  it('renders loading, missing, and provider-error states intentionally', () => {
    const container = document.createElement('div');
    const coordinate = { longitude: 44.8, latitude: 41.7 };
    renderPointInspectorContent(
      container,
      {
        status: 'open',
        coordinate,
        elevation: { status: 'loading' },
        nearbyPoi: { status: 'loading' },
      },
      { onClose: () => undefined },
    );
    expect(container.textContent).toContain('Loading elevation…');
    renderPointInspectorContent(
      container,
      {
        status: 'open',
        coordinate,
        elevation: { status: 'error' },
        nearbyPoi: { status: 'none' },
      },
      { onClose: () => undefined },
    );
    expect(container.textContent).toContain('Elevation could not be loaded.');
    expect(container.textContent).toContain('No named map feature found.');
  });
});

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
    const inspector = new MapLibrePointInspector({ onClose: () => undefined });
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
});
