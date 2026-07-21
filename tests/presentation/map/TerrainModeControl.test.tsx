import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TerrainModeControl } from '@/presentation/map/TerrainModeControl';

describe('TerrainModeControl', () => {
  it('exposes an exclusive, accessible 2D/3D choice', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<TerrainModeControl state="flat" onModeChange={onModeChange} />);

    expect(screen.getByRole('group', { name: 'Map dimension' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show flat 2D map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Show 3D terrain map' }));

    expect(onModeChange).toHaveBeenCalledWith('terrain');
  });

  it('disables repeated mode changes while a transition is pending', () => {
    render(<TerrainModeControl state="enabling" onModeChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Show flat 2D map' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toBeDisabled();
  });
});
