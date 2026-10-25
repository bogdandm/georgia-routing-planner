import { AttributionControl, type Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import {
  collapseInitialMapAttribution,
  collapseInitialMapAttributionWhenAvailable,
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
    const stop = collapseInitialMapAttributionWhenAvailable(map);
    const control = new AttributionControl({
      compact: true,
      customAttribution: 'Deferred provider credits',
    });

    mapContainer.append(control.onAdd(map));

    await vi.waitFor(() => {
      expect(mapContainer.querySelector('.maplibregl-compact-show')).toBeNull();
      expect(mapContainer.querySelector('details')).not.toHaveAttribute('open');
    });
    stop();
    control.onRemove();
  });
});
