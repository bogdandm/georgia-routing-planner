import { render, screen, within } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  MapViewControls,
  MapViewControlsControl,
} from '@/presentation/map/MapViewControls';

const mapControlHost = document.createElement('div');
mapControlHost.className = 'maplibregl-ctrl-top-right';

vi.mock('react-map-gl/maplibre', () => ({
  useControl: (
    createControl: () => {
      readonly onAdd: (map: MapLibreMap) => HTMLElement;
      readonly onRemove: () => void;
    },
  ) => {
    const [control] = useState(createControl);

    useEffect(() => {
      const element = control.onAdd({} as MapLibreMap);
      mapControlHost.append(element);
      return () => {
        control.onRemove();
      };
    }, [control]);

    return control;
  },
}));

describe('MapViewControls', () => {
  it('exposes an exclusive, accessible 2D/3D choice', async () => {
    const user = userEvent.setup();
    const onTerrainModeChange = vi.fn();
    render(
      <MapViewControls
        activeLayerPreset={null}
        layerPresetDisabled={false}
        onLayerPresetChange={() => true}
        onTerrainModeChange={onTerrainModeChange}
        terrainState="flat"
      />,
    );

    expect(screen.getByRole('group', { name: 'Map dimension' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show flat 2D map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Show 3D terrain map' }));

    expect(onTerrainModeChange).toHaveBeenCalledWith('terrain');
  });

  it('disables repeated mode changes while a transition is pending', () => {
    render(
      <MapViewControls
        activeLayerPreset={null}
        layerPresetDisabled={false}
        onLayerPresetChange={() => true}
        onTerrainModeChange={vi.fn()}
        terrainState="enabling"
      />,
    );

    expect(screen.getByRole('button', { name: 'Show flat 2D map' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toBeDisabled();
  });

  it('opens the ordered preset menu with decorative previews and its active choice', async () => {
    const user = userEvent.setup();
    render(
      <MapViewControls
        activeLayerPreset="google-satellite-hybrid"
        layerPresetDisabled={false}
        onLayerPresetChange={() => true}
        onTerrainModeChange={vi.fn()}
        terrainState="flat"
      />,
    );

    const button = screen.getByRole('button', { name: 'Choose map layer preset' });
    await user.click(button);

    const menu = await screen.findByRole('menu');
    const choices = screen.getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.textContent)).toEqual([
      'Vector OSM',
      'Google Satellite Hybrid',
      'Google Satellite',
      'NAPR Orthophoto Hybrid',
      'NAPR Orthophoto',
      'Sentinel-2 Hybrid',
    ]);
    expect(menu.querySelectorAll('img')).toHaveLength(6);
    expect(
      screen.getByRole('menuitemradio', { name: 'Google Satellite Hybrid' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the chooser open after applying a preset', async () => {
    const user = userEvent.setup();
    const onLayerPresetChange = vi.fn().mockReturnValue(true);
    render(
      <MapViewControls
        activeLayerPreset={null}
        layerPresetDisabled={false}
        onLayerPresetChange={onLayerPresetChange}
        onTerrainModeChange={vi.fn()}
        terrainState="flat"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Choose map layer preset' }));
    await user.click(
      screen.getByRole('menuitemradio', { name: 'NAPR Orthophoto Hybrid' }),
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'NAPR Orthophoto' }));

    expect(onLayerPresetChange).toHaveBeenNthCalledWith(1, 'napr-orthophoto-hybrid');
    expect(onLayerPresetChange).toHaveBeenNthCalledWith(2, 'napr-orthophoto');
    expect(screen.getByRole('menu')).toBeVisible();
  });

  it('closes the chooser and restores button focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <MapViewControls
        activeLayerPreset={null}
        layerPresetDisabled={false}
        onLayerPresetChange={() => true}
        onTerrainModeChange={vi.fn()}
        terrainState="flat"
      />,
    );

    const button = screen.getByRole('button', { name: 'Choose map layer preset' });
    await user.click(button);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
  it('mounts the dimension and layer controls in the MapLibre rail', () => {
    document.body.append(mapControlHost);
    const { unmount } = render(
      <MapViewControlsControl
        activeLayerPreset={null}
        layerPresetDisabled={false}
        onLayerPresetChange={() => true}
        onTerrainModeChange={() => undefined}
        terrainState="flat"
      />,
    );

    expect(
      within(mapControlHost)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Show flat 2D map', 'Show 3D terrain map', 'Choose map layer preset']);

    unmount();
    expect(mapControlHost.querySelector('.map-view-controls-control')).toBeNull();
    mapControlHost.remove();
  });
});
