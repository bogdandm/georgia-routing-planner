import { ThemeProvider } from '@mui/material';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ElevationProfile,
  ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import { ElevationProfileChart } from '@/presentation/tracks/ElevationProfileChart';
import { createAppTheme } from '@/presentation/theme/createAppTheme';

const profile: ElevationProfile = {
  points: [
    { coordinate: [44, 42], distanceMeters: 0, elevationMeters: 1_000 },
    {
      coordinate: [44.01, 42.01],
      distanceMeters: 1_400,
      elevationMeters: 1_120,
    },
    {
      coordinate: [44.02, 42.02],
      distanceMeters: 2_800,
      elevationMeters: 1_040,
    },
  ],
  minimumMeters: 1_000,
  maximumMeters: 1_120,
};

let observedWidth = 420;

class TestResizeObserver implements ResizeObserver {
  private observedTarget: Element | null = null;

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.observedTarget = target;
    const entry = {
      target,
      contentRect: new DOMRect(0, 0, observedWidth, 264),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    } satisfies ResizeObserverEntry;
    this.callback([entry], this);
  }

  unobserve(target: Element): void {
    if (this.observedTarget === target) {
      this.observedTarget = null;
    }
  }

  disconnect(): void {
    this.observedTarget = null;
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, observedWidth, 264),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderElevationProfileChart(
  onActivePointChange?: (point: ElevationProfilePoint | null) => void,
) {
  const chart =
    onActivePointChange === undefined ? (
      <ElevationProfileChart profile={profile} />
    ) : (
      <ElevationProfileChart
        profile={profile}
        onActivePointChange={onActivePointChange}
      />
    );
  return render(<ThemeProvider theme={createAppTheme()}>{chart}</ThemeProvider>);
}

describe('ElevationProfileChart', () => {
  it.each([420, 760])(
    'renders the accessible profile and axis labels at %i pixels wide',
    (width) => {
      observedWidth = width;
      renderElevationProfileChart();

      expect(screen.getByRole('heading', { name: 'Elevation profile' })).toBeVisible();
      expect(
        screen.getByRole('img', {
          name: 'Elevation profile from 1000 to 1120 metres',
        }),
      ).toBeVisible();
      expect(screen.getByText('Distance (km)')).toBeVisible();
      expect(screen.getByText('Elevation (m)')).toBeVisible();
    },
  );

  it('reports the source point and tooltip on hover, then clears it on leave', async () => {
    const onActivePointChange = vi.fn();
    observedWidth = 420;
    renderElevationProfileChart(onActivePointChange);

    const image = screen.getByRole('img', {
      name: 'Elevation profile from 1000 to 1120 metres',
    });
    const chartSurface = image.querySelector('svg');
    if (chartSurface === null) {
      throw new Error('Expected the elevation chart surface to render.');
    }

    fireEvent.mouseEnter(chartSurface, { clientX: 236, clientY: 80 });
    fireEvent.mouseMove(chartSurface, { clientX: 236, clientY: 80 });

    expect(await screen.findByText('1.4 km')).toBeVisible();
    expect(await screen.findByText('Elevation 1120 m')).toBeVisible();
    await waitFor(() => {
      expect(onActivePointChange).toHaveBeenLastCalledWith(profile.points[1]);
    });

    fireEvent.mouseLeave(chartSurface);

    expect(onActivePointChange).toHaveBeenLastCalledWith(null);
  });
});
