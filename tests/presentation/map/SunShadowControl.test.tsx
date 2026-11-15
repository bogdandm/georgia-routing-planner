import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';
import { MapViewControls } from '@/presentation/map/MapViewControls';
import { MapViewportSnapshotStore } from '@/presentation/map/MapViewportSnapshotStore';
import type { SunShadowControlProps } from '@/presentation/map/SunShadowControl';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

// 12:00 in Tbilisi (UTC+4 all year).
const tbilisiNoonMs = Date.UTC(2026, 6, 1, 8, 0);

function tbilisiViewport(): MapViewportSnapshotStore {
  const viewport = new MapViewportSnapshotStore();
  viewport.update({
    bounds: { west: 44.6, south: 41.6, east: 45, north: 41.8 },
    center: { longitude: 44.79, latitude: 41.72 },
  });
  return viewport;
}

function renderSunShadowControls(sunShadow: Partial<SunShadowControlProps>) {
  const onChange = vi.fn();
  renderWithI18n(
    <MapViewControls
      activeLayerPreset={null}
      terrainDisabled={false}
      layerPresetDisabled={false}
      hybridOverlayDisabled
      hybridOverlayEnabled={false}
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
      sunShadow={{
        enabled: false,
        instantMs: tbilisiNoonMs,
        availability: 'available',
        mapViewport: tbilisiViewport(),
        onChange,
        ...sunShadow,
      }}
    />,
  );
  return { onChange };
}

describe('SunShadowControl', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('opens the panel without enabling shadows and enables them from the switch', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSunShadowControls({});
    const button = screen.getByRole('button', { name: 'Sun shadows' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);

    expect(screen.getByRole('dialog', { name: 'Sun shadows' })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/GMT\+4/)).toBeVisible();
    expect(screen.getByText(/Sunrise \d{2}:\d{2}/)).toBeVisible();

    await user.click(screen.getByRole('switch', { name: 'Sun shadows' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      instantMs: tbilisiNoonMs,
    });
  });

  it('commits date and time of day as wall time at the map center', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSunShadowControls({ enabled: true });
    await user.click(screen.getByRole('button', { name: 'Sun shadows' }));

    const slider = screen.getByRole('slider', { name: 'Time of day' });
    expect(slider).toHaveAttribute('aria-valuetext', '12:00');
    slider.focus();
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenLastCalledWith({
      enabled: true,
      instantMs: Date.UTC(2026, 6, 1, 8, 10),
    });

    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-12-24' },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      enabled: true,
      instantMs: Date.UTC(2026, 11, 24, 8, 0),
    });
  });

  it('says when the sun is below the horizon at the map center', async () => {
    const user = userEvent.setup();
    renderSunShadowControls({ instantMs: Date.UTC(2026, 6, 1, 18, 0) });

    await user.click(screen.getByRole('button', { name: 'Sun shadows' }));

    expect(
      screen.getByText('The sun is below the horizon at the map center.'),
    ).toBeVisible();
  });

  it('disables the switch where the browser cannot compute shadows', async () => {
    const user = userEvent.setup();
    renderSunShadowControls({ availability: 'unavailable' });

    await user.click(screen.getByRole('button', { name: 'Sun shadows' }));

    expect(screen.getByRole('switch', { name: 'Sun shadows' })).toBeDisabled();
    expect(screen.getByText(/WebGL2 float rendering is unavailable/)).toBeVisible();
  });

  it('closes only the panel on Escape and restores button focus', async () => {
    const user = userEvent.setup();
    renderSunShadowControls({});
    const button = screen.getByRole('button', { name: 'Sun shadows' });
    await user.click(button);
    const windowEscape = vi.fn();
    window.addEventListener('keydown', windowEscape);

    await user.keyboard('{Escape}');
    window.removeEventListener('keydown', windowEscape);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(windowEscape).not.toHaveBeenCalled();
  });
});
