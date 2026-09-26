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
        terrainDisabled={false}
        layerPresetDisabled={false}
        hybridOverlayDisabled
        hybridOverlayEnabled
        onHybridOverlayChange={vi.fn()}
        weatherMapEnabled={false}
        weatherMapDisabled={false}
        onWeatherMapChange={vi.fn()}
        onOpenLayersTab={vi.fn()}
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
        terrainDisabled={false}
        layerPresetDisabled={false}
        hybridOverlayDisabled
        hybridOverlayEnabled
        onHybridOverlayChange={vi.fn()}
        weatherMapEnabled={false}
        weatherMapDisabled={false}
        onWeatherMapChange={vi.fn()}
        onOpenLayersTab={vi.fn()}
        onLayerPresetChange={() => true}
        onTerrainModeChange={vi.fn()}
        terrainState="enabling"
      />,
    );

    expect(screen.getByRole('button', { name: 'Show flat 2D map' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toBeDisabled();
  });

  it('opens compact map controls for overlays, weather, and the Layers tab', async () => {
    const user = userEvent.setup();
    const onHybridOverlayChange = vi.fn();
    const onOpenLayersTab = vi.fn();
    const onWeatherMapChange = vi.fn();
    render(
      <MapViewControls
        activeLayerPreset="google-satellite"
        hybridOverlayDisabled={false}
        hybridOverlayEnabled
        terrainDisabled={false}
        layerPresetDisabled={false}
        onHybridOverlayChange={onHybridOverlayChange}
        weatherMapEnabled={false}
        weatherMapDisabled={false}
        onWeatherMapChange={onWeatherMapChange}
        onLayerPresetChange={() => true}
        onOpenLayersTab={onOpenLayersTab}
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
      'Google Satellite',
      'Bing Aerial',
      'Esri World Imagery',
      'NAPR Orthophoto',
      'Sentinel-2',
    ]);
    expect(menu.querySelectorAll('img')).toHaveLength(0);
    expect(
      screen.getByRole('menuitemradio', { name: 'Google Satellite' }),
    ).toHaveAttribute('aria-checked', 'true');
    const hybridToggle = screen.getByRole('menuitemcheckbox', { name: 'OSM overlay' });
    await user.click(hybridToggle);
    expect(onHybridOverlayChange).toHaveBeenCalledWith(false);
    const weatherToggle = screen.getByRole('menuitemcheckbox', { name: /Weather/ });
    await user.click(weatherToggle);
    expect(onWeatherMapChange).toHaveBeenCalledWith(true);
    weatherToggle.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Sentinel-2' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    const layersAction = screen.getByRole('menuitem', { name: 'Layers tab' });
    expect(layersAction).toHaveFocus();
    await user.click(layersAction);
    expect(onOpenLayersTab).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps the chooser open after applying a preset', async () => {
    const user = userEvent.setup();
    const onLayerPresetChange = vi.fn().mockReturnValue(true);
    render(
      <MapViewControls
        activeLayerPreset={null}
        terrainDisabled={false}
        layerPresetDisabled={false}
        hybridOverlayDisabled={false}
        hybridOverlayEnabled={false}
        onHybridOverlayChange={vi.fn()}
        weatherMapEnabled={false}
        weatherMapDisabled={false}
        onWeatherMapChange={vi.fn()}
        onOpenLayersTab={vi.fn()}
        onLayerPresetChange={onLayerPresetChange}
        onTerrainModeChange={vi.fn()}
        terrainState="flat"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Choose map layer preset' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Sentinel-2' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'NAPR Orthophoto' }));

    expect(onLayerPresetChange).toHaveBeenNthCalledWith(1, 'sentinel-2');
    expect(onLayerPresetChange).toHaveBeenNthCalledWith(2, 'napr-orthophoto');
    expect(screen.getByRole('menu')).toBeVisible();
  });

  it('closes the chooser and restores button focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <MapViewControls
        activeLayerPreset={null}
        terrainDisabled={false}
        layerPresetDisabled={false}
        hybridOverlayDisabled
        hybridOverlayEnabled
        onHybridOverlayChange={vi.fn()}
        weatherMapEnabled={false}
        weatherMapDisabled={false}
        onWeatherMapChange={vi.fn()}
        onOpenLayersTab={vi.fn()}
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
  it('disables 3D terrain while Sentinel Mosaic is active', async () => {
    const user = userEvent.setup();
    render(
      <MapViewControls
        activeLayerPreset={null}
        terrainDisabled
        layerPresetDisabled={false}
        hybridOverlayDisabled
        hybridOverlayEnabled
        onHybridOverlayChange={vi.fn()}
        weatherMapEnabled={false}
        weatherMapDisabled={false}
        onWeatherMapChange={vi.fn()}
        onOpenLayersTab={vi.fn()}
        onLayerPresetChange={() => true}
        onTerrainModeChange={vi.fn()}
        terrainState="flat"
      />,
    );

    const terrainButton = screen.getByRole('button', {
      name: 'Show 3D terrain map',
    });
    expect(terrainButton).toBeDisabled();
    const tooltipTarget = terrainButton.parentElement;
    expect(tooltipTarget).not.toBeNull();
    if (tooltipTarget === null) return;
    await user.hover(tooltipTarget);
    expect(
      await screen.findByText(
        '3D terrain is unavailable while Sentinel Mosaic is active.',
      ),
    ).toBeVisible();
  });

  it('mounts the dimension and layer controls in the MapLibre rail', () => {
    document.body.append(mapControlHost);
    const { unmount } = render(
      <MapViewControlsControl
        activeLayerPreset={null}
        terrainDisabled={false}
        layerPresetDisabled={false}
        hybridOverlayDisabled
        hybridOverlayEnabled
        onHybridOverlayChange={vi.fn()}
        weatherMapEnabled={false}
        weatherMapDisabled={false}
        onWeatherMapChange={vi.fn()}
        onOpenLayersTab={vi.fn()}
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
