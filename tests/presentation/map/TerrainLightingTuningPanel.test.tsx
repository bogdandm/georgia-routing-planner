import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';
import { TerrainLightingTuningPanel } from '@/presentation/map/TerrainLightingTuningPanel';
import {
  defaultTerrainLightingTuning,
  terrainLightingTuningStore,
} from '@/presentation/map/terrainLightingTuning';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

beforeEach(() => {
  activateAppLocale('en');
  terrainLightingTuningStore.setState({
    values: defaultTerrainLightingTuning,
    showDefaults: false,
    panelOpen: true,
  });
});

describe('TerrainLightingTuningPanel', () => {
  it('edits values beside their numbers and switches Before and After', async () => {
    const user = userEvent.setup();
    renderWithI18n(<TerrainLightingTuningPanel anchorEl={document.body} />);

    const opacity = screen.getByRole('slider', { name: 'sunShadowOpacity' });
    opacity.focus();
    await user.keyboard('{ArrowRight}');
    expect(terrainLightingTuningStore.getState().values.sunShadowOpacity).toBe(0.63);
    expect(screen.getByText('0.63')).toBeInTheDocument();

    for (const name of [
      'terrainShadeExposure',
      'terrainShadeShadowStrength',
      'terrainShadeHighlightRolloff',
    ]) {
      screen.getByRole('slider', { name }).focus();
      await user.keyboard('{ArrowRight}');
    }
    expect(terrainLightingTuningStore.getState().values).toMatchObject({
      terrainShadeExposure: 0.05,
      terrainShadeShadowStrength: 2.05,
      terrainShadeHighlightRolloff: 2.05,
    });

    // GPU values carry a marker and land in the store once the keyboard step commits.
    const share = screen.getByRole('slider', { name: 'terrainShadeSkyLightShare' });
    expect(screen.getAllByText('GPU').length).toBeGreaterThan(0);
    share.focus();
    await user.keyboard('{ArrowLeft}');
    expect(terrainLightingTuningStore.getState().values.terrainShadeSkyLightShare).toBe(
      0.44,
    );

    await user.click(screen.getByRole('button', { name: 'Before' }));
    expect(terrainLightingTuningStore.getState()).toMatchObject({
      showDefaults: true,
      values: { sunShadowOpacity: 0.63 },
    });
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(terrainLightingTuningStore.getState().showDefaults).toBe(false);
  });

  it('resets one item to its default on a double-click anywhere on its row', async () => {
    const user = userEvent.setup();
    renderWithI18n(<TerrainLightingTuningPanel anchorEl={document.body} />);
    act(() => {
      terrainLightingTuningStore.setState({
        values: {
          ...defaultTerrainLightingTuning,
          sunShadowOpacity: 0.9,
          terrainShadeSkyLightShare: 0.6,
        },
      });
    });

    await user.dblClick(screen.getByText('sunShadowOpacity'));
    expect(terrainLightingTuningStore.getState().values).toMatchObject({
      sunShadowOpacity: defaultTerrainLightingTuning.sunShadowOpacity,
      terrainShadeSkyLightShare: 0.6,
    });

    await user.click(screen.getByRole('button', { name: 'Colors' }));
    fireEvent.change(screen.getByLabelText('sunAlpenglow'), {
      target: { value: '#123456' },
    });
    await user.dblClick(screen.getByText('#123456'));
    expect(terrainLightingTuningStore.getState().values.sunAlpenglow).toBe(
      defaultTerrainLightingTuning.sunAlpenglow,
    );
  });

  it('edits colors, resets a section or everything, and copies the configuration', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderWithI18n(<TerrainLightingTuningPanel anchorEl={document.body} />);

    await user.click(screen.getByRole('button', { name: 'Colors' }));
    fireEvent.change(screen.getByLabelText('sunAlpenglow'), {
      target: { value: '#123456' },
    });
    expect(terrainLightingTuningStore.getState().values.sunAlpenglow).toBe('#123456');
    act(() => {
      terrainLightingTuningStore.setState({
        values: {
          ...terrainLightingTuningStore.getState().values,
          sunShadowOpacity: 0.9,
          terrainShadeExposure: -0.5,
          terrainShadeShadowStrength: 3,
          terrainShadeHighlightRolloff: 1.5,
        },
      });
    });

    await user.click(screen.getByRole('button', { name: 'Copy configuration' }));
    const copied: unknown = JSON.parse(String(writeText.mock.lastCall?.[0]));
    expect(copied).toMatchObject({
      sunAlpenglow: '#123456',
      sunShadowOpacity: 0.9,
      terrainShadeExposure: -0.5,
      terrainShadeShadowStrength: 3,
      terrainShadeHighlightRolloff: 1.5,
    });
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('region', { name: 'Colors' })).getByRole('button', {
        name: 'Reset section',
      }),
    );
    expect(terrainLightingTuningStore.getState().values).toMatchObject({
      sunAlpenglow: defaultTerrainLightingTuning.sunAlpenglow,
      sunShadowOpacity: 0.9,
    });
    // The label holds only for the values it copied.
    expect(
      screen.getByRole('button', { name: 'Copy configuration' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(terrainLightingTuningStore.getState().values).toEqual(
      defaultTerrainLightingTuning,
    );

    await user.click(screen.getByRole('button', { name: 'Close lighting tuning' }));
    expect(screen.queryByRole('region', { name: 'Lighting tuning' })).toBeNull();
  });
});
