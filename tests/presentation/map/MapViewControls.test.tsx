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
    const choices = screen.getAllByRole('menuitem');
    expect(choices.map((choice) => choice.textContent)).toEqual([
      'Vector OSM',
      'Google Satellite Hybrid',
      'Google Satellite',
      'Sentinel-2 Hybrid',
    ]);
    expect(menu.querySelectorAll('img')).toHaveLength(4);
    expect(
      screen.getByRole('menuitem', { name: 'Google Satellite Hybrid' }),
    ).toHaveAttribute('aria-current', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the chooser open on failure and closes it after a successful choice', async () => {
    const user = userEvent.setup();
    const onLayerPresetChange = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
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
    await user.click(screen.getByRole('menuitem', { name: 'Google Satellite' }));
    expect(onLayerPresetChange).toHaveBeenLastCalledWith('google-satellite');
    expect(screen.getByRole('menu')).toBeVisible();

    await user.click(screen.getByRole('menuitem', { name: 'Google Satellite' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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
