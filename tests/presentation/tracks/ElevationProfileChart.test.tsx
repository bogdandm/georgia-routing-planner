import { ThemeProvider } from '@mui/material';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sampleElevationProfilePoints,
  type ElevationProfile,
  type ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import {
  CompactElevationProfile,
  ElevationProfileChart,
} from '@/presentation/tracks/ElevationProfileChart';
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
      localGradePct: 0,
      sourceSegmentIndex: 0,
    },
    {
      sampleIndex: 1,
      coordinate: [44.01, 42.01],
      distanceMeters: 1_400,
      rawElevationMeters: 1_120,
      elevationMeters: 1_120,
      trendElevationMeters: 1_120,
      localGradePct: 8.6,
      sourceSegmentIndex: 0,
    },
    {
      sampleIndex: 2,
      coordinate: [44.02, 42.02],
      distanceMeters: 2_800,
      rawElevationMeters: 1_040,
      elevationMeters: 1_040,
      trendElevationMeters: 1_040,
      localGradePct: -5.7,
      sourceSegmentIndex: 0,
    },
  ],
  segments: [
    {
      startSampleIndex: 0,
      endSampleIndex: 2,
      startDistanceMeters: 0,
      endDistanceMeters: 2_800,
      type: 'climb',
      distanceMeters: 2_800,
      netElevationChangeMeters: 40,
      ascentMeters: 120,
      descentMeters: 80,
      averageGradePct: 1.4,
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
        {
          startSampleIndex: 1,
          endSampleIndex: 2,
          startDistanceMeters: 1_400,
          endDistanceMeters: 2_800,
          distanceMeters: 1_400,
          averageGradePct: -5.7,
          band: 'descent',
        },
      ],
    },
  ],
  minimumMeters: 1_000,
  maximumMeters: 1_120,
  algorithmVersion: 2,
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

interface ElevationProfileChartCallbacks {
  readonly activeSegmentIndex?: number | null;
  readonly selectedSegmentIndex?: number | null;
  readonly profile?: ElevationProfile;
  readonly onActivePointChange?: (point: ElevationProfilePoint | null) => void;
  readonly onSegmentHoverChange?: (index: number | null) => void;
  readonly onSegmentSelectionChange?: (index: number | null) => void;
  readonly onPointClick?: (point: ElevationProfilePoint) => void;
}

function renderElevationProfileChart({
  profile: chartProfile = profile,
  activeSegmentIndex,
  selectedSegmentIndex,
  onActivePointChange,
  onSegmentHoverChange,
  onSegmentSelectionChange,
  onPointClick,
}: ElevationProfileChartCallbacks = {}) {
  const chartProps: {
    profile: ElevationProfile;
    activeSegmentIndex: number | null;
    selectedSegmentIndex: number | null;
    onSegmentHoverChange: (index: number | null) => void;
    onSegmentSelectionChange: (index: number | null) => void;
    onActivePointChange?: (point: ElevationProfilePoint | null) => void;
    onPointClick?: (point: ElevationProfilePoint) => void;
  } = {
    profile: chartProfile,
    activeSegmentIndex: activeSegmentIndex ?? null,
    selectedSegmentIndex: selectedSegmentIndex ?? null,
    onSegmentHoverChange: onSegmentHoverChange ?? vi.fn(),
    onSegmentSelectionChange: onSegmentSelectionChange ?? vi.fn(),
  };
  if (onActivePointChange !== undefined) {
    chartProps.onActivePointChange = onActivePointChange;
  }
  if (onPointClick !== undefined) {
    chartProps.onPointClick = onPointClick;
  }
  return render(
    <ThemeProvider theme={createAppTheme()}>
      <ElevationProfileChart {...chartProps} />
    </ThemeProvider>,
  );
}

describe('ElevationProfileChart', () => {
  it.each([420, 760])(
    'renders the accessible profile without axis labels at %i pixels wide',
    (width) => {
      observedWidth = width;
      renderElevationProfileChart();

      expect(screen.getByRole('heading', { name: 'Elevation profile' })).toBeVisible();
      expect(
        screen.getByRole('img', {
          name: 'Elevation profile from 1000 to 1120 metres',
        }),
      ).toBeVisible();
      expect(screen.queryByText('Distance (km)')).not.toBeInTheDocument();
      expect(screen.queryByText('Elevation (m)')).not.toBeInTheDocument();
    },
  );

  it('colors local grades without a rectangular active overlay', () => {
    const { container } = renderElevationProfileChart({ activeSegmentIndex: 0 });

    const stops = [...container.querySelectorAll('stop')];
    expect(stops.map((stop) => stop.getAttribute('offset'))).toEqual([
      '0%',
      '50%',
      '50%',
      '100%',
    ]);
    expect(stops.map((stop) => stop.getAttribute('stop-color'))).toEqual([
      '#D6A100',
      '#D6A100',
      '#0F766E',
      '#0F766E',
    ]);
    expect(container.querySelector('.recharts-reference-area-rect')).toBeNull();
  });

  it('fades inactive macro ranges and draws their shared boundary', () => {
    const macro = profile.segments[0];
    const climbGrade = macro?.gradeSubsegments[0];
    const descentGrade = macro?.gradeSubsegments[1];
    if (macro === undefined || climbGrade === undefined || descentGrade === undefined) {
      throw new Error('Expected the profile segment fixture.');
    }
    const splitProfile: ElevationProfile = {
      ...profile,
      segments: [
        {
          ...macro,
          endSampleIndex: 1,
          endDistanceMeters: 1_400,
          distanceMeters: 1_400,
          netElevationChangeMeters: 120,
          ascentMeters: 120,
          descentMeters: 0,
          averageGradePct: 8.6,
          gradeSubsegments: [climbGrade],
        },
        {
          ...macro,
          startSampleIndex: 1,
          startDistanceMeters: 1_400,
          type: 'descent',
          distanceMeters: 1_400,
          netElevationChangeMeters: -80,
          ascentMeters: 0,
          descentMeters: 80,
          averageGradePct: -5.7,
          gradeSubsegments: [descentGrade],
        },
      ],
    };
    const { container } = render(
      <ThemeProvider theme={createAppTheme()}>
        <ElevationProfileChart
          profile={splitProfile}
          activeSegmentIndex={0}
          onSegmentHoverChange={vi.fn()}
          selectedSegmentIndex={null}
          onSegmentSelectionChange={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(
      [...container.querySelectorAll('stop')].map((stop) =>
        stop.getAttribute('stop-opacity'),
      ),
    ).toEqual(['1', '1', '0.22', '0.22']);
    expect(container.querySelectorAll('.recharts-reference-line-line')).toHaveLength(1);
  });

  it('keeps a negative local grade inside its macro climb on hover and click', async () => {
    const onActivePointChange = vi.fn();
    const onSegmentHoverChange = vi.fn();
    const onSegmentSelectionChange = vi.fn();
    const onPointClick = vi.fn();
    observedWidth = 420;
    renderElevationProfileChart({
      onActivePointChange,
      onSegmentHoverChange,
      onSegmentSelectionChange,
      onPointClick,
    });

    const image = screen.getByRole('img', {
      name: 'Elevation profile from 1000 to 1120 metres',
    });
    const chartSurface = image.querySelector('svg');
    if (chartSurface === null) {
      throw new Error('Expected the elevation chart surface to render.');
    }

    fireEvent.mouseEnter(chartSurface, { clientX: 390, clientY: 80 });
    fireEvent.mouseMove(chartSurface, { clientX: 390, clientY: 80 });

    const distances = await screen.findAllByText('2.8 km');
    expect(distances).toHaveLength(2);
    expect(await screen.findByText('1,040 m')).toBeVisible();
    expect(await screen.findByText('-6%')).toBeVisible();
    expect(await screen.findByText('Climb 1')).toBeVisible();
    expect(screen.queryByText(/Net|Average/u)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onActivePointChange).toHaveBeenLastCalledWith(profile.points[2]);
      expect(onSegmentHoverChange).toHaveBeenLastCalledWith(0);
    });

    fireEvent.click(chartSurface, { clientX: 390, clientY: 80 });
    await waitFor(() => {
      expect(onPointClick).toHaveBeenLastCalledWith(profile.points[2]);
      expect(onSegmentSelectionChange).toHaveBeenLastCalledWith(0);
    });

    fireEvent.mouseLeave(chartSurface);
    expect(onActivePointChange).toHaveBeenLastCalledWith(null);
    expect(onSegmentHoverChange).toHaveBeenLastCalledWith(null);
  });

  it('clears a selected macro range when that chart range is clicked again', async () => {
    const onSegmentSelectionChange = vi.fn();
    observedWidth = 420;
    renderElevationProfileChart({
      selectedSegmentIndex: 0,
      onSegmentSelectionChange,
    });
    const chartSurface = screen
      .getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      })
      .querySelector('svg');
    if (chartSurface === null) {
      throw new Error('Expected the elevation chart surface to render.');
    }

    fireEvent.mouseEnter(chartSurface, { clientX: 390, clientY: 80 });
    fireEvent.mouseMove(chartSurface, { clientX: 390, clientY: 80 });
    await screen.findByText('Climb 1');
    fireEvent.click(chartSurface, { clientX: 390, clientY: 80 });
    await waitFor(() => {
      expect(onSegmentSelectionChange).toHaveBeenLastCalledWith(null);
    });
  });

  it('clears a selected range when a flat chart range is clicked', async () => {
    const onSegmentHoverChange = vi.fn();
    const onSegmentSelectionChange = vi.fn();
    observedWidth = 420;
    renderElevationProfileChart({
      profile: {
        ...profile,
        segments: profile.segments.map((segment, index) =>
          index === 0 ? { ...segment, type: 'flat' } : segment,
        ),
      },
      selectedSegmentIndex: 0,
      onSegmentSelectionChange,
      onSegmentHoverChange,
    });
    const chartSurface = screen
      .getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      })
      .querySelector('svg');
    if (chartSurface === null) {
      throw new Error('Expected the elevation chart surface to render.');
    }
    fireEvent.mouseEnter(chartSurface, { clientX: 390, clientY: 80 });
    fireEvent.mouseMove(chartSurface, { clientX: 390, clientY: 80 });
    await waitFor(() => {
      expect(onSegmentHoverChange).toHaveBeenLastCalledWith(0);
    });
    fireEvent.click(chartSurface, { clientX: 390, clientY: 80 });
    await waitFor(() => {
      expect(onSegmentSelectionChange).toHaveBeenLastCalledWith(null);
    });
  });

  it('retains every grade boundary when mandatory points exceed the soft cap', () => {
    const points: ElevationProfilePoint[] = Array.from(
      { length: 1_202 },
      (_, sampleIndex) => ({
        sampleIndex,
        coordinate: [44 + sampleIndex / 100_000, 42],
        distanceMeters: sampleIndex * 10,
        rawElevationMeters: 1_000 + sampleIndex,
        elevationMeters: 1_000 + sampleIndex,
        trendElevationMeters: 1_000 + sampleIndex,
        localGradePct: sampleIndex % 2 === 0 ? 5 : -5,
        sourceSegmentIndex: 0,
      }),
    );
    const overflowProfile: ElevationProfile = {
      points,
      segments: [
        {
          startSampleIndex: 0,
          endSampleIndex: 1_201,
          startDistanceMeters: 0,
          endDistanceMeters: 12_010,
          type: 'climb',
          distanceMeters: 12_010,
          netElevationChangeMeters: 1_201,
          ascentMeters: 1_201,
          descentMeters: 0,
          averageGradePct: 10,
          gradeSubsegments: Array.from({ length: 1_201 }, (_, index) => ({
            startSampleIndex: index,
            endSampleIndex: index + 1,
            startDistanceMeters: index * 10,
            endDistanceMeters: (index + 1) * 10,
            distanceMeters: 10,
            averageGradePct: index % 2 === 0 ? 5 : -5,
            band: index % 2 === 0 ? ('climb' as const) : ('descent' as const),
          })),
        },
      ],
      minimumMeters: 1_000,
      maximumMeters: 2_201,
      algorithmVersion: 2,
    };

    expect(sampleElevationProfilePoints(overflowProfile)).toHaveLength(1_202);
  });

  it('renders the compact profile as a decorative non-interactive chart', () => {
    const { container } = render(
      <ThemeProvider theme={createAppTheme()}>
        <CompactElevationProfile profile={profile} />
      </ThemeProvider>,
    );

    const compactProfile = screen.getByTestId('compact-elevation-profile');
    expect(compactProfile).toHaveAttribute('aria-hidden', 'true');
    expect(compactProfile).toHaveStyle({ pointerEvents: 'none' });
    expect(
      [...container.querySelectorAll('stop')].map((stop) =>
        stop.getAttribute('stop-color'),
      ),
    ).toEqual(['#D6A100', '#D6A100', '#0F766E', '#0F766E']);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-cartesian-grid')).toBeNull();
    expect(container.querySelector('.recharts-tooltip-wrapper')).toBeNull();
    expect(container.querySelector('.recharts-reference-line')).toBeNull();
    expect(container.querySelector('.recharts-cartesian-axis-tick')).toBeNull();
    expect(container.querySelector('.recharts-cartesian-axis-line')).toBeNull();
  });
});
