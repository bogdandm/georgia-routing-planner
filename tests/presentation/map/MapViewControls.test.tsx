import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MapViewControls } from '@/presentation/map/MapViewControls';

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
      'NAPR Orthophoto 2025 Hybrid',
      'NAPR Orthophoto 2025',
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
      screen.getByRole('menuitemradio', { name: 'NAPR Orthophoto 2025 Hybrid' }),
    );
    await user.click(
      screen.getByRole('menuitemradio', { name: 'NAPR Orthophoto 2025' }),
    );

    expect(onLayerPresetChange).toHaveBeenNthCalledWith(
      1,
      'napr-orthophoto-2025-hybrid',
    );
    expect(onLayerPresetChange).toHaveBeenNthCalledWith(2, 'napr-orthophoto-2025');
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
});
