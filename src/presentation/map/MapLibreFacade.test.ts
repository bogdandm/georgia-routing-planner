import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { MapLibreFacade } from '@/presentation/map/MapLibreFacade';
import { createTestServices } from '../../../test/helpers/createTestServices';

type TestListener = (event?: unknown) => void;

class FakeNativeMap {
  readonly #listeners = new Map<string, Set<TestListener>>();
  readonly #canvas = document.createElement('canvas');
  public showTileBoundaries = false;
  public showCollisionBoxes = false;

  public on(type: string, listener: TestListener): this {
    const listeners = this.#listeners.get(type) ?? new Set<TestListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
    return this;
  }

  public off(type: string, listener: TestListener): this {
    this.#listeners.get(type)?.delete(listener);
    return this;
  }

  public getCanvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  public loaded(): boolean {
    return false;
  }

  public getStyle() {
    return {
      version: 8 as const,
      name: 'fixture-style',
      sources: {},
      layers: [{ id: 'background', type: 'background' as const }],
    };
  }

  public getCenter() {
    return { lng: 44.8, lat: 41.7 };
  }

  public getZoom(): number {
    return 8;
  }

  public getBearing(): number {
    return 12;
  }

  public getPitch(): number {
    return 35;
  }

  public fire(type: string, event?: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }

  public listenerCount(): number {
    return [...this.#listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }
}

describe('MapLibreFacade', () => {
  it('owns lifecycle listeners, updates snapshots, and cleans up deterministically', () => {
    const services = createTestServices();
    const nativeMap = new FakeNativeMap();
    const onCameraSettled = vi.fn();
    const facade = new MapLibreFacade(services.logger, onCameraSettled);

    facade.attach(nativeMap as unknown as MapLibreMap);
    facade.attach(nativeMap as unknown as MapLibreMap);
    expect(nativeMap.listenerCount()).toBe(4);

    nativeMap.fire('load');
    nativeMap.fire('idle');
    nativeMap.fire('moveend');

    expect(facade.getDiagnosticsSnapshot()).toMatchObject({
      lifecycle: 'ready',
      styleId: 'fixture-style',
      layerIds: ['background'],
      webGlContext: 'available',
      camera: {
        longitude: 44.8,
        latitude: 41.7,
        zoom: 8,
        bearing: 12,
        pitch: 35,
      },
    });

    facade.setDebugOptions({
      showCollisionBoxes: true,
      showTileBoundaries: true,
    });
    expect(nativeMap.showCollisionBoxes).toBe(true);
    expect(nativeMap.showTileBoundaries).toBe(true);
    expect(onCameraSettled).toHaveBeenCalledOnce();
    expect(onCameraSettled).toHaveBeenCalledWith({
      longitude: 44.8,
      latitude: 41.7,
      zoom: 8,
      bearing: 12,
      pitch: 35,
    });

    facade.destroy();
    expect(nativeMap.listenerCount()).toBe(0);
    expect(
      services.logger
        .getEvents()
        .filter((event) => event.name === 'map.lifecycle.mounted'),
    ).toHaveLength(1);
  });
});
