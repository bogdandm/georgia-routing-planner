import { screen, within } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';
import {
  MapViewControls,
  MapViewControlsControl,
} from '@/presentation/map/MapViewControls';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

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
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('exposes an exclusive, accessible 2D/3D choice', async () => {
    const user = userEvent.setup();
    const onTerrainModeChange = vi.fn();
    renderWithI18n(
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
        onOpenComparison={null}
        measurementActive={false}
        onMeasurementActiveChange={vi.fn()}
        onLayerPresetChange={() => 'map'}
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
    renderWithI18n(
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
        onOpenComparison={null}
        measurementActive={false}
        onMeasurementActiveChange={vi.fn()}
        onLayerPresetChange={() => 'map'}
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
    renderWithI18n(
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
        onLayerPresetChange={() => 'map'}
        onOpenLayersTab={onOpenLayersTab}
        onOpenComparison={null}
        measurementActive={false}
        onMeasurementActiveChange={vi.fn()}
        onTerrainModeChange={vi.fn()}
        terrainState="flat"
      />,
    );

    const button = screen.getByRole('button', { name: 'Choose map layer preset' });
    await user.click(button);

    const menu = await screen.findByRole('menu');
    const choices = screen.getAllByRole('menuitemradio');
    // Each label is followed by the keycap of its digit shortcut.
    expect(choices.map((choice) => choice.textContent)).toEqual([
      'Vector OSM1',
      'Google Satellite2',
      'Bing Aerial3',
      'Esri World Imagery4',
      'NAPR Orthophoto5',
      'Soviet Topographic6',
      'Sentinel-27',
    ]);
    expect(menu.querySelectorAll('img')).toHaveLength(0);
    expect(
      screen.getByRole('menuitemradio', { name: 'Google Satellite' }),
    ).toHaveAttribute('aria-checked', 'true');
    const legendLink = screen.getByRole('menuitem', {
      name: 'Open topographic map symbols (PDF)',
    });
    expect(legendLink).toHaveAttribute(
      'href',
      'https://www.planinite.info/Maps/pdf/%D0%A3%D1%81%D0%BB%D0%BE%D0%B2%D0%BD%D1%8B%D0%B5_%D0%B7%D0%BD%D0%B0%D0%BA%D0%B8_%D1%82%D0%BE%D0%BF%D0%BE%D0%B3%D1%80%D0%B0%D1%84%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D1%85_%D0%BA%D0%B0%D1%80%D1%82_%D0%A1%D0%A1%D0%A1%D0%A0-1966.pdf',
    );
    expect(legendLink).toHaveAttribute('target', '_blank');
    screen.getByRole('menuitemradio', { name: 'Soviet Topographic' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(legendLink).toHaveFocus();
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
    const onLayerPresetChange = vi.fn().mockReturnValue('map');
    renderWithI18n(
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
        onOpenComparison={null}
        measurementActive={false}
        onMeasurementActiveChange={vi.fn()}
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

  it('closes the chooser when Sentinel-2 opens the Satellite panel instead', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <MapViewControls
        activeLayerPreset="vector-osm"
        terrainDisabled={false}
        layerPresetDisabled={false}
        hybridOverlayDisabled
        hybridOverlayEnabled
        onHybridOverlayChange={vi.fn()}
        weatherMapEnabled={false}
        weatherMapDisabled={false}
        onWeatherMapChange={vi.fn()}
        onOpenLayersTab={vi.fn()}
        onOpenComparison={null}
        measurementActive={false}
        onMeasurementActiveChange={vi.fn()}
        onLayerPresetChange={() => 'navigated'}
        onTerrainModeChange={vi.fn()}
        terrainState="flat"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Choose map layer preset' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Sentinel-2' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lets a press outside the open chooser reach its target and closes it', async () => {
    const user = userEvent.setup();
    const onMapPress = vi.fn();
    renderWithI18n(
      <>
        <button type="button" onClick={onMapPress}>
          Map surface
        </button>
        <MapViewControls
          activeLayerPreset="vector-osm"
          terrainDisabled={false}
          layerPresetDisabled={false}
          hybridOverlayDisabled
          hybridOverlayEnabled
          onHybridOverlayChange={vi.fn()}
          weatherMapEnabled={false}
          weatherMapDisabled={false}
          onWeatherMapChange={vi.fn()}
          onOpenLayersTab={vi.fn()}
          onOpenComparison={null}
          measurementActive={false}
          onMeasurementActiveChange={vi.fn()}
          onLayerPresetChange={() => 'map'}
          onTerrainModeChange={vi.fn()}
          terrainState="flat"
        />
      </>,
    );
    const layerButton = screen.getByRole('button', { name: 'Choose map layer preset' });

    await user.click(layerButton);
    await user.click(screen.getByRole('button', { name: 'Map surface' }));
    expect(onMapPress).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(layerButton);
    expect(screen.getByRole('menu')).toBeVisible();
    await user.click(layerButton);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes only the chooser on Escape and restores button focus', async () => {
    const user = userEvent.setup();
    renderWithI18n(
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
        onOpenComparison={null}
        measurementActive={false}
        onMeasurementActiveChange={vi.fn()}
        onLayerPresetChange={() => 'map'}
        onTerrainModeChange={vi.fn()}
        terrainState="flat"
      />,
    );

    const button = screen.getByRole('button', { name: 'Choose map layer preset' });
    await user.click(button);
    await screen.findByRole('menu');
    // MapWorkspace cancels marker placement and weather point picking on window Escape.
    const windowEscape = vi.fn();
    window.addEventListener('keydown', windowEscape);
    await user.keyboard('{Escape}');
    window.removeEventListener('keydown', windowEscape);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(windowEscape).not.toHaveBeenCalled();
  });
  it('disables 3D terrain while Sentinel Mosaic is active', async () => {
    const user = userEvent.setup();
    renderWithI18n(
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
        onOpenComparison={null}
        measurementActive={false}
        onMeasurementActiveChange={vi.fn()}
        onLayerPresetChange={() => 'map'}
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

  it('mounts the dimension, layer, and ruler controls in the MapLibre rail', () => {
    document.body.append(mapControlHost);
    const { unmount } = renderWithI18n(
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
        onOpenComparison={null}
        measurementActive={false}
        onMeasurementActiveChange={vi.fn()}
        onLayerPresetChange={() => 'map'}
        onTerrainModeChange={() => undefined}
        terrainState="flat"
      />,
    );

    expect(
      within(mapControlHost)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Show flat 2D map',
      'Show 3D terrain map',
      'Choose map layer preset',
      'Measure distance',
    ]);

    unmount();
    expect(mapControlHost.querySelector('.map-view-controls-control')).toBeNull();
    mapControlHost.remove();
  });
});
