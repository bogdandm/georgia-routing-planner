import type { LngLat, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import type { SatelliteCompareCamera } from '@/presentation/map/SatelliteCompareMaps';
import { SatelliteCompareSync } from '@/presentation/map/SatelliteCompareSync';

interface FakeLngLat {
  readonly lng: number;
  readonly lat: number;
}

/** Fires move and moveend synchronously from `jumpTo`, as MapLibre does. */
class FakeCompareMap {
  center: FakeLngLat = { lng: 44.5, lat: 41.5 };
  zoom = 9;
  jumps = 0;

  public constructor(
    private readonly sync: SatelliteCompareSync,
    private readonly paneKey: string,
    private readonly settled: SatelliteCompareCamera[],
  ) {}

  public getCenter(): FakeLngLat {
    return this.center;
  }

  public getZoom(): number {
    return this.zoom;
  }

  public jumpTo(options: {
    readonly center: FakeLngLat | readonly [number, number];
    readonly zoom: number;
  }): void {
    this.jumps += 1;
    this.center =
      'lng' in options.center
        ? options.center
        : { lng: options.center[0], lat: options.center[1] };
    this.zoom = options.zoom;
    this.userMove();
  }

  /** The events MapLibre fires after a gesture, a jump, or a resize. */
  public userMove(): void {
    this.sync.handleMove(this.paneKey);
    const camera = this.sync.handleMoveEnd(this.paneKey);
    if (camera !== null) this.settled.push(camera);
  }

  public project(lngLat: FakeLngLat): { readonly x: number; readonly y: number } {
    return {
      x: 300 + (lngLat.lng - this.center.lng) * 100 * this.zoom,
      y: 200 - (lngLat.lat - this.center.lat) * 100 * this.zoom,
    };
  }
}

const initialCamera: SatelliteCompareCamera = {
  center: { longitude: 44.5, latitude: 41.5 },
  zoom: 9,
};

function createPanes(keys: readonly string[]) {
  const sync = new SatelliteCompareSync(initialCamera);
  const settled: SatelliteCompareCamera[] = [];
  const panes = new Map(
    keys.map((key) => {
      const map = new FakeCompareMap(sync, key, settled);
      const crosshair = document.createElement('div');
      crosshair.style.display = 'none';
      sync.attach(key, map as unknown as MapLibreMap, crosshair);
      map.jumps = 0;
      return [key, { map, crosshair }] as const;
    }),
  );
  function pane(key: string) {
    const found = panes.get(key);
    if (found === undefined) throw new Error(`Missing pane ${key}.`);
    return found;
  }
  return { sync, settled, pane };
}

describe('SatelliteCompareSync', () => {
  it('moves every other pane with the leader and reports each settled camera once', () => {
    const { sync, settled, pane } = createPanes(['a', 'b', 'c']);
    const leader = pane('a').map;

    leader.center = { lng: 45.1, lat: 42.2 };
    leader.zoom = 11;
    leader.userMove();

    for (const key of ['b', 'c']) {
      expect(pane(key).map).toMatchObject({
        center: { lng: 45.1, lat: 42.2 },
        zoom: 11,
        jumps: 1,
      });
    }
    expect(leader.jumps).toBe(0);
    expect(settled).toEqual([
      { center: { longitude: 45.1, latitude: 42.2 }, zoom: 11 },
    ]);
    expect(sync.camera).toEqual(settled[0]);

    // A resized pane keeps its center: it fires move events but settles nothing new.
    pane('b').map.userMove();
    expect(settled).toHaveLength(1);
  });

  it('starts a pane added later on the shared camera', () => {
    const { sync, pane } = createPanes(['a', 'b']);
    pane('a').map.zoom = 12;
    pane('a').map.userMove();

    const added = new FakeCompareMap(sync, 'c', []);
    sync.attach('c', added as unknown as MapLibreMap, null);

    expect(added).toMatchObject({ center: { lng: 44.5, lat: 41.5 }, zoom: 12 });
  });

  it('mirrors the pointer in every other pane and follows camera moves', () => {
    const { sync, pane } = createPanes(['a', 'b', 'c']);

    sync.showPointer('a', { lng: 45, lat: 41 } as LngLat);

    expect(pane('a').crosshair.style.display).toBe('none');
    for (const key of ['b', 'c']) {
      expect(pane(key).crosshair.style.display).toBe('block');
      expect(pane(key).crosshair.style.transform).toBe('translate(750px, 650px)');
    }

    pane('a').map.center = { lng: 45, lat: 41 };
    pane('a').map.userMove();
    expect(pane('b').crosshair.style.transform).toBe('translate(300px, 200px)');

    sync.hidePointer();
    for (const key of ['a', 'b', 'c']) {
      expect(pane(key).crosshair.style.display).toBe('none');
    }
  });

  it('hides mirrored crosshairs when the pointer pane is removed', () => {
    const { sync, pane } = createPanes(['a', 'b']);
    sync.showPointer('a', { lng: 45, lat: 41 } as LngLat);

    sync.detach('a');

    expect(pane('b').crosshair.style.display).toBe('none');
  });
});
