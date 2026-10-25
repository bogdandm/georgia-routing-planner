import { AttributionControl, type Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { collapseInitialMapAttribution } from '@/presentation/map/mapAttributionControl';

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
});
