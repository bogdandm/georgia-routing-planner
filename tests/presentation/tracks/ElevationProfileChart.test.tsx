import { ThemeProvider } from '@mui/material';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sampleElevationProfilePoints,
  type ElevationProfile,
  type ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import {
  CompactElevationProfile,
  ElevationPreparationChart,
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
  gradeSubsegments: [],
  minimumMeters: 1_000,
  maximumMeters: 1_120,
  algorithmVersion: 3,
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
  readonly trackGradeLegendDismissed?: boolean;
  readonly onActivePointChange?: (point: ElevationProfilePoint | null) => void;
  readonly onSegmentHoverChange?: (index: number | null) => void;
  readonly onSegmentSelectionChange?: (index: number | null) => void;
  readonly onTrackGradeLegendDismissedChange?: (dismissed: boolean) => void;
  readonly onPointClick?: (point: ElevationProfilePoint) => void;
}

function renderElevationProfileChart({
  profile: chartProfile = profile,
  activeSegmentIndex,
  selectedSegmentIndex,
  trackGradeLegendDismissed = false,
  onActivePointChange,
  onSegmentHoverChange,
  onSegmentSelectionChange,
  onTrackGradeLegendDismissedChange,
  onPointClick,
}: ElevationProfileChartCallbacks = {}) {
  const chartProps: {
    profile: ElevationProfile;
    activeSegmentIndex: number | null;
    selectedSegmentIndex: number | null;
    trackGradeLegendDismissed: boolean;
    onSegmentHoverChange: (index: number | null) => void;
    onSegmentSelectionChange: (index: number | null) => void;
    onTrackGradeLegendDismissedChange: (dismissed: boolean) => void;
    onActivePointChange?: (point: ElevationProfilePoint | null) => void;
    onPointClick?: (point: ElevationProfilePoint) => void;
  } = {
    profile: chartProfile,
    activeSegmentIndex: activeSegmentIndex ?? null,
    selectedSegmentIndex: selectedSegmentIndex ?? null,
    trackGradeLegendDismissed,
    onSegmentHoverChange: onSegmentHoverChange ?? vi.fn(),
    onSegmentSelectionChange: onSegmentSelectionChange ?? vi.fn(),
    onTrackGradeLegendDismissedChange: onTrackGradeLegendDismissedChange ?? vi.fn(),
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

describe('ElevationPreparationChart', () => {
  it('renders an indeterminate terrain preparation state before tile totals are known', () => {
    render(
      <ThemeProvider theme={createAppTheme()}>
        <ElevationPreparationChart progress={null} />
      </ThemeProvider>,
    );

    expect(screen.getByText('Preparing terrain and elevation…')).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Elevation profile loading' }),
    ).toBeVisible();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('renders neutral, determinate tile progress without profile interactions', () => {
    const { container } = render(
      <ThemeProvider theme={createAppTheme()}>
        <ElevationPreparationChart
          progress={{
            completedTiles: 1,
            totalTiles: 3,
            points: [
              { distanceMeters: 0, elevationMeters: 1_000 },
              { distanceMeters: 100, elevationMeters: null },
              { distanceMeters: 200, elevationMeters: 1_100 },
            ],
          }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('Loading elevation tiles: 1 of 3')).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Elevation profile loading: 1 of 3 tiles',
      }),
    ).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '33.33333333333333',
    );
    expect(container.querySelector('.recharts-area-curve')).toHaveAttribute(
      'stroke',
      '#667085',
    );
    expect(
      container.querySelector('.recharts-area-curve')?.getAttribute('d')?.match(/M/g),
    ).toHaveLength(2);
    expect(container.querySelectorAll('stop')).toHaveLength(0);
    expect(container.querySelectorAll('.recharts-tooltip-wrapper')).toHaveLength(0);
  });
});

describe('ElevationProfileChart', () => {
  it.each([420, 760])(
    'renders the accessible profile without axis labels at %i pixels wide',
    (width) => {
      observedWidth = width;
      renderElevationProfileChart();

      expect(screen.getByRole('heading', { name: 'Elevation profile' })).toBeVisible();
      const image = screen.getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      });
      expect(image).toBeVisible();
      expect(image).toHaveStyle({ height: '264px' });
      expect(image.querySelectorAll('.recharts-cartesian-axis')).toHaveLength(2);
      expect(image.querySelectorAll('.recharts-cartesian-axis-line')).toHaveLength(2);
      expect(
        image.querySelectorAll('.recharts-cartesian-axis-tick').length,
      ).toBeGreaterThan(0);
      expect(image.querySelector('.recharts-cartesian-grid')).not.toBeNull();
      expect(image.querySelector('.recharts-tooltip-wrapper')).not.toBeNull();
      const tickText = [
        ...image.querySelectorAll('.recharts-cartesian-axis-tick-value'),
      ].map((tick) => tick.textContent);
      expect(tickText.some((value) => value.endsWith('km'))).toBe(true);
      expect(tickText.some((value) => value.endsWith('m'))).toBe(true);
      expect(screen.queryByText('Distance (km)')).not.toBeInTheDocument();
      expect(screen.queryByText('Elevation (m)')).not.toBeInTheDocument();
    },
  );

  it('restores the track grade legend from the profile header', async () => {
    const user = userEvent.setup();
    const onTrackGradeLegendDismissedChange = vi.fn();
    renderElevationProfileChart({
      trackGradeLegendDismissed: true,
      onTrackGradeLegendDismissedChange,
    });

    await user.click(screen.getByRole('button', { name: 'Show track grade legend' }));
    expect(onTrackGradeLegendDismissedChange).toHaveBeenCalledWith(false);
  });
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
          trackGradeLegendDismissed={false}
          onTrackGradeLegendDismissedChange={vi.fn()}
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

  it('smooths only the hover grade and keeps its indicator direction aligned', async () => {
    const localGradePcts = [5, 5, 50, 5, 5];
    const smoothingProfile: ElevationProfile = {
      points: localGradePcts.map((localGradePct, sampleIndex) => ({
        sampleIndex,
        coordinate: [44 + sampleIndex / 100, 42],
        distanceMeters: sampleIndex * 50,
        rawElevationMeters: 1_000 + sampleIndex,
        elevationMeters: 1_000 + sampleIndex,
        trendElevationMeters: 1_000 + sampleIndex,
        localGradePct,
        sourceSegmentIndex: 0,
      })),
      segments: [
        {
          startSampleIndex: 0,
          endSampleIndex: 4,
          startDistanceMeters: 0,
          endDistanceMeters: 200,
          type: 'climb',
          distanceMeters: 200,
          netElevationChangeMeters: 4,
          ascentMeters: 4,
          descentMeters: 0,
          averageGradePct: 2,
          gradeSubsegments: [],
        },
      ],
      gradeSubsegments: [],
      minimumMeters: 1_000,
      maximumMeters: 1_004,
      algorithmVersion: 3,
    };
    const onActivePointChange = vi.fn();
    const { unmount } = renderElevationProfileChart({
      profile: smoothingProfile,
      onActivePointChange,
    });

    const positiveChartSurface = screen
      .getByRole('img', {
        name: 'Elevation profile from 1000 to 1004 metres',
      })
      .querySelector('svg');
    if (positiveChartSurface === null) {
      throw new Error('Expected the elevation chart surface to render.');
    }

    fireEvent.mouseEnter(positiveChartSurface, { clientX: 210, clientY: 80 });
    fireEvent.mouseMove(positiveChartSurface, { clientX: 210, clientY: 80 });

    const positiveCentralGrade = await screen.findByText('+20%');
    expect(onActivePointChange).toHaveBeenLastCalledWith(smoothingProfile.points[2]);
    expect(positiveCentralGrade.parentElement?.querySelector('svg')).not.toHaveStyle({
      transform: 'rotate(180deg)',
    });

    fireEvent.mouseMove(positiveChartSurface, { clientX: 300, clientY: 80 });

    const positiveRightGrade = await screen.findByText('+16%');
    expect(onActivePointChange).toHaveBeenLastCalledWith(smoothingProfile.points[3]);
    expect(positiveRightGrade.parentElement?.querySelector('svg')).not.toHaveStyle({
      transform: 'rotate(180deg)',
    });

    unmount();

    const negativeProfile: ElevationProfile = {
      ...smoothingProfile,
      points: smoothingProfile.points.map((point) => ({
        ...point,
        localGradePct: -point.localGradePct,
      })),
    };
    const onNegativeActivePointChange = vi.fn();
    renderElevationProfileChart({
      profile: negativeProfile,
      onActivePointChange: onNegativeActivePointChange,
    });

    const negativeChartSurface = screen
      .getByRole('img', {
        name: 'Elevation profile from 1000 to 1004 metres',
      })
      .querySelector('svg');
    if (negativeChartSurface === null) {
      throw new Error('Expected the elevation chart surface to render.');
    }

    fireEvent.mouseEnter(negativeChartSurface, { clientX: 210, clientY: 80 });
    fireEvent.mouseMove(negativeChartSurface, { clientX: 210, clientY: 80 });

    const negativeCentralGrade = await screen.findByText('-20%');
    expect(onNegativeActivePointChange).toHaveBeenLastCalledWith(
      negativeProfile.points[2],
    );
    expect(negativeCentralGrade.parentElement?.querySelector('svg')).toHaveStyle({
      transform: 'rotate(180deg)',
    });

    fireEvent.mouseMove(negativeChartSurface, { clientX: 300, clientY: 80 });

    const negativeRightGrade = await screen.findByText('-16%');
    expect(onNegativeActivePointChange).toHaveBeenLastCalledWith(
      negativeProfile.points[3],
    );
    expect(negativeRightGrade.parentElement?.querySelector('svg')).toHaveStyle({
      transform: 'rotate(180deg)',
    });
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
      gradeSubsegments: [],
      minimumMeters: 1_000,
      maximumMeters: 2_201,
      algorithmVersion: 3,
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
