import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { instantToZonedWallTime } from '@/domain/time/zonedWallTime';
import { activateAppLocale } from '@/presentation/localization/appI18n';
import { MapViewControls } from '@/presentation/map/MapViewControls';
import { MapViewportSnapshotStore } from '@/presentation/map/MapViewportSnapshotStore';
import type { SunShadowControlProps } from '@/presentation/map/SunShadowControl';
import { daylightWindow } from '@/presentation/map/sunShadowDaylight';
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

/** Daylight at the Tbilisi viewport center and a Tbilisi wall-minute reader. */
function tbilisiDay(instantMs: number) {
  const window = daylightWindow(
    instantMs,
    { latitude: 41.72, longitude: 44.79 },
    'Asia/Tbilisi',
  );
  if (window === null) throw new Error('Tbilisi has a sunrise and sunset every day.');
  const wallMinutes = (ms: number) => {
    const wall = instantToZonedWallTime(new Date(ms), 'Asia/Tbilisi');
    return wall.hour * 60 + wall.minute;
  };
  return { window, wallMinutes };
}

function renderSunShadowControls(sunShadow: Partial<SunShadowControlProps>) {
  const onChange = vi.fn();
  const onPlay = vi.fn();
  const onStop = vi.fn();
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
        playback: { status: 'idle' },
        mapViewport: tbilisiViewport(),
        onChange,
        onPlay,
        onStop,
        ...sunShadow,
      }}
    />,
  );
  return { onChange, onPlay, onStop };
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
    await user.keyboard('{End}');

    expect(onChange).toHaveBeenLastCalledWith({
      enabled: true,
      instantMs: tbilisiDay(tbilisiNoonMs).window.lastMinuteMs,
    });

    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-12-24' },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      enabled: true,
      instantMs: Date.UTC(2026, 11, 24, 8, 0),
    });
  });

  it('turns Now at night into 11:00 of that day at the map center', async () => {
    const user = userEvent.setup();
    // 23:15 in Tbilisi (UTC+4).
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 1, 19, 15));
    const { onChange } = renderSunShadowControls({ enabled: true });
    await user.click(screen.getByRole('button', { name: 'Sun shadows' }));

    await user.click(screen.getByRole('button', { name: 'Now' }));

    expect(onChange).toHaveBeenLastCalledWith({
      enabled: true,
      instantMs: Date.UTC(2026, 6, 1, 7, 0),
    });
    vi.restoreAllMocks();
  });

  it('offers times from two hours before sunrise to two hours after sunset', async () => {
    const user = userEvent.setup();
    renderSunShadowControls({});

    await user.click(screen.getByRole('button', { name: 'Sun shadows' }));

    const { window, wallMinutes } = tbilisiDay(tbilisiNoonMs);
    const slider = screen.getByRole('slider', { name: 'Time of day' });
    expect(slider).toHaveAttribute(
      'aria-valuemin',
      String(wallMinutes(Math.ceil(window.sunriseMs / 60_000) * 60_000) - 120),
    );
    expect(slider).toHaveAttribute(
      'aria-valuemax',
      String(wallMinutes(Math.floor(window.sunsetMs / 60_000) * 60_000) + 120),
    );
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

  it('asks to play the day from the Play button', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderSunShadowControls({ enabled: true });
    await user.click(screen.getByRole('button', { name: 'Sun shadows' }));

    await user.click(screen.getByRole('button', { name: 'Play the day' }));

    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('disables Play while shadows are off', async () => {
    const user = userEvent.setup();
    renderSunShadowControls({});
    await user.click(screen.getByRole('button', { name: 'Sun shadows' }));

    expect(screen.getByRole('button', { name: 'Play the day' })).toBeDisabled();
  });

  it('shows the precomputation progress and cancels it', async () => {
    const user = userEvent.setup();
    const { onStop } = renderSunShadowControls({
      enabled: true,
      playback: { status: 'loading', progress: 0.426 },
    });
    await user.click(screen.getByRole('button', { name: 'Sun shadows' }));

    expect(screen.getByText('Computing shadows for the day: 43%')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onStop).toHaveBeenCalledOnce();
  });
});
