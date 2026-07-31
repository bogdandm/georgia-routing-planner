import { ThemeProvider } from '@mui/material';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ElevationProfile } from '@/domain/tracks/elevationProfile';
import type { TrackMetrics } from '@/domain/tracks/trackCalculations';
import { CompactTrackSummary } from '@/presentation/tracks/TrackSummary';
import { createAppTheme } from '@/presentation/theme/createAppTheme';

const profile: ElevationProfile = {
  points: [
    {
      sampleIndex: 0,
      coordinate: [44, 42],
      distanceMeters: 0,
      rawElevationMeters: 1_000,
      elevationMeters: 1_000,
      trendElevationMeters: 1_000,
      localGradePct: 8.6,
      sourceSegmentIndex: 0,
    },
    {
      sampleIndex: 1,
      coordinate: [44.01, 42.01],
      distanceMeters: 1_400,
      rawElevationMeters: 1_120,
      elevationMeters: 1_120,
      trendElevationMeters: 1_120,
      localGradePct: -5.7,
      sourceSegmentIndex: 0,
    },
  ],
  segments: [
    {
      startSampleIndex: 0,
      endSampleIndex: 1,
      startDistanceMeters: 0,
      endDistanceMeters: 1_400,
      type: 'climb',
      distanceMeters: 1_400,
      netElevationChangeMeters: 120,
      ascentMeters: 120,
      descentMeters: 0,
      averageGradePct: 8.6,
      gradeSubsegments: [
        {
          startSampleIndex: 0,
          endSampleIndex: 1,
          startDistanceMeters: 0,
          endDistanceMeters: 1_400,
          distanceMeters: 1_400,
          averageGradePct: 8.6,
          band: 'climb',
        },
      ],
    },
  ],
  minimumMeters: 1_000,
  maximumMeters: 1_120,
  algorithmVersion: 2,
};

const metrics: TrackMetrics = {
  distanceMeters: 1_400,
  distanceAlgorithmVersion: 1,
  startCoordinate: [44, 42],
  endCoordinate: [44.01, 42.01],
  bounds: {
    west: 44,
    south: 42,
    east: 44.01,
    north: 42.01,
    crossesAntimeridian: false,
  },
  center: [44.005, 42.005],
  ascentMeters: 120,
  descentMeters: 0,
};

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, 320, 56),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } satisfies ResizeObserverEntry,
      ],
      this,
    );
  }

  unobserve(): void {
    return undefined;
  }

  disconnect(): void {
    return undefined;
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 320, 56),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSummary(
  summaryMetrics: TrackMetrics | null = metrics,
  summaryProfile: ElevationProfile | null = profile,
) {
  return render(
    <ThemeProvider theme={createAppTheme()}>
      <CompactTrackSummary metrics={summaryMetrics} profile={summaryProfile} />
    </ThemeProvider>,
  );
}

describe('CompactTrackSummary', () => {
  it('overlays compact stats on a decorative grade-colored profile', () => {
    const { container } = renderSummary();

    const distance = screen.getByLabelText('Distance: 1.4 km');
    expect(distance).toBeVisible();
    expect(screen.getByLabelText('Elevation gain: 120 m')).toBeVisible();
    expect(screen.getByLabelText('Elevation loss: 0 m')).toBeVisible();
    expect(screen.getByTestId('compact-elevation-profile')).toBeVisible();
    expect(
      [...container.querySelectorAll('stop')].map((stop) =>
        stop.getAttribute('stop-color'),
      ),
    ).toEqual(['#D6A100', '#D6A100']);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(within(distance).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const renderedStyles = [...document.querySelectorAll('style')]
      .map((style) => style.textContent)
      .join('');
    expect(renderedStyles).toContain('background-color:rgba(255,255,255,0.78)');
    expect(renderedStyles).toContain('backdrop-filter:blur(2px)');
    expect(renderedStyles).toContain('border:1px solid rgba(255,255,255,0.88)');
  });

  it('keeps metrics on the paper surface without a profile', () => {
    renderSummary(metrics, null);

    expect(screen.getByLabelText('Distance: 1.4 km')).toBeVisible();
    expect(screen.getByLabelText('Elevation gain: 120 m')).toBeVisible();
    expect(screen.queryByTestId('compact-elevation-profile')).not.toBeInTheDocument();
  });

  it('keeps a decorative profile without fabricating metrics', () => {
    renderSummary(null, profile);

    expect(screen.getByTestId('compact-elevation-profile')).toBeVisible();
    expect(screen.queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Elevation gain:/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Elevation loss:/u)).not.toBeInTheDocument();
  });
});
