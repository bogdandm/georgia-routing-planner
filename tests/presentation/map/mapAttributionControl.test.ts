import { AttributionControl, type Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import {
  collapseInitialMapAttribution,
  synchronizeMapAttributionDisclosure,
} from '@/presentation/map/mapAttributionControl';

describe('collapseInitialMapAttribution', () => {
  it('removes MapLibre startup expansion from compact attribution', () => {
    const mapContainer = document.createElement('div');
    const map = {
      _getUIString: () => 'Toggle attribution',
      getContainer: () => mapContainer,
      getCanvasContainer: () => mapContainer,
      on: vi.fn(),
      off: vi.fn(),
      style: { tileManagers: {}, stylesheet: null },
    } as unknown as MapLibreMap;
    const control = new AttributionControl({
      compact: true,
      customAttribution: 'Provider credits',
    });
    mapContainer.append(control.onAdd(map));
    expect(mapContainer.querySelector('.maplibregl-compact-show')).not.toBeNull();

    const details = mapContainer.querySelector('details');
    expect(details?.open).toBe(true);
    collapseInitialMapAttribution(map);
    expect(details?.open).toBe(false);

    expect(mapContainer.querySelector('.maplibregl-compact-show')).toBeNull();
    expect(mapContainer.querySelector('.maplibregl-compact')).not.toBeNull();
    mapContainer
      .querySelector<HTMLButtonElement>('.maplibregl-ctrl-attrib-button')
      ?.click();
    expect(mapContainer.querySelector('.maplibregl-compact-show')).not.toBeNull();
    expect(details?.open).toBe(true);
    expect(mapContainer.textContent).toContain('Provider credits');
    control.onRemove();
  });

  it('waits for a deferred compact control and collapses its first expansion', async () => {
    const mapContainer = document.createElement('div');
    const map = {
      _getUIString: () => 'Toggle attribution',
      getContainer: () => mapContainer,
      getCanvasContainer: () => mapContainer,
      on: vi.fn(),
      off: vi.fn(),
      style: { tileManagers: {}, stylesheet: null },
    } as unknown as MapLibreMap;
    const stop = synchronizeMapAttributionDisclosure(map);
    const control = new AttributionControl({
      compact: true,
      customAttribution: 'Deferred provider credits',
    });

    mapContainer.append(control.onAdd(map));

    await vi.waitFor(() => {
      expect(mapContainer.querySelector('.maplibregl-compact-show')).toBeNull();
      expect(mapContainer.querySelector('details')).not.toHaveAttribute('open');
    });
    mapContainer
      .querySelector<HTMLButtonElement>('.maplibregl-ctrl-attrib-button')
      ?.click();
    expect(mapContainer.querySelector('details')).toHaveAttribute('open');

    // These private methods are the MapLibre lifecycle behavior under regression.
    const mapLibreControl = control as unknown as AttributionControl & {
      _updateCompactMinimize: () => void;
    };
    mapLibreControl._updateCompactMinimize();
    await vi.waitFor(() => {
      expect(mapContainer.querySelector('details')).not.toHaveAttribute('open');
    });
    stop();
    control.onRemove();
  });

  it('collapses an already-mounted control when source credits arrive', async () => {
    const mapContainer = document.createElement('div');
    const tileManagers: Record<string, unknown> = {};
    const map = {
      _getUIString: () => 'Toggle attribution',
      getContainer: () => mapContainer,
      getCanvasContainer: () => mapContainer,
      on: vi.fn(),
      off: vi.fn(),
      style: { tileManagers, stylesheet: null },
    } as unknown as MapLibreMap;
    const control = new AttributionControl({ compact: true });
    mapContainer.append(control.onAdd(map));
    const stop = synchronizeMapAttributionDisclosure(map);

    tileManagers.provider = {
      used: true,
      usedForTerrain: false,
      getSource: () => ({ attribution: 'Late source credits' }),
    };
    // Exercise the real MapLibre source-attribution refresh rather than synthetic DOM.
    const mapLibreControl = control as unknown as AttributionControl & {
      _updateAttributions: () => void;
    };
    mapLibreControl._updateAttributions();

    await vi.waitFor(() => {
      expect(mapContainer.querySelector('.maplibregl-compact-show')).toBeNull();
      expect(mapContainer.querySelector('details')).not.toHaveAttribute('open');
      expect(mapContainer.textContent).toContain('Late source credits');
    });
    stop();
    control.onRemove();
  });
});
