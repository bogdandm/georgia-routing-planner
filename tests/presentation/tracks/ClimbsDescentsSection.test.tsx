import { ThemeProvider } from '@mui/material';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  MacroElevationSegment,
  MacroElevationSegmentType,
} from '@/domain/tracks/elevationProfile';
import { ClimbsDescentsSection } from '@/presentation/tracks/ClimbsDescentsSection';
import {
  formatTrackDistance,
  formatTrackElevation,
  formatTrackGrade,
} from '@/presentation/tracks/trackFormatters';
import { createAppTheme } from '@/presentation/theme/createAppTheme';

function segment(
  type: MacroElevationSegmentType,
  startSampleIndex: number,
  averageGradePct: number,
): MacroElevationSegment {
  return {
    startSampleIndex,
    endSampleIndex: startSampleIndex + 10,
    startDistanceMeters: startSampleIndex * 100,
    endDistanceMeters: startSampleIndex * 100 + 1_000,
    type,
    distanceMeters: 1_000,
    netElevationChangeMeters: averageGradePct * 10,
    ascentMeters: type === 'climb' ? 100 : 5,
    descentMeters: type === 'descent' ? 80 : 3,
    averageGradePct,
    gradeSubsegments: [],
  };
}

const segments = [
  segment('climb', 0, 10),
  segment('flat', 10, 0),
  segment('descent', 20, -8),
];

function renderSection(
  overrides: {
    readonly activeSegmentIndex?: number | null;
    readonly recalculating?: boolean;
    readonly onRecalculate?: () => void;
    readonly selectedSegmentIndex?: number | null;
    readonly onSegmentHoverChange?: (index: number | null) => void;
    readonly onSegmentSelectionChange?: (index: number | null) => void;
  } = {},
) {
  return render(
    <ThemeProvider theme={createAppTheme()}>
      <ClimbsDescentsSection
        recalculating={overrides.recalculating ?? false}
        onRecalculate={overrides.onRecalculate ?? vi.fn()}
        segments={segments}
        activeSegmentIndex={overrides.activeSegmentIndex ?? null}
        selectedSegmentIndex={overrides.selectedSegmentIndex ?? null}
        onSegmentHoverChange={overrides.onSegmentHoverChange ?? vi.fn()}
        onSegmentSelectionChange={overrides.onSegmentSelectionChange ?? vi.fn()}
      />
    </ThemeProvider>,
  );
}

describe('ClimbsDescentsSection', () => {
  it('starts collapsed and lists directional segments in route order without flats', async () => {
    const user = userEvent.setup();
    renderSection();

    const disclosure = screen.getByRole('button', { name: 'Climbs & Descents' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(disclosure);

    const rows = screen.getAllByRole('button', { pressed: false });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Climb 1, +10%, 1.0 km, 100 m, 3 m descent',
      'Descent 1, -8%, 1.0 km, 80 m, 5 m ascent',
    ]);
  });

  it('toggles from the title area with pointer, Enter, and Space', async () => {
    const user = userEvent.setup();
    renderSection();
    const disclosure = screen.getByRole('button', { name: 'Climbs & Descents' });
    expect(disclosure).toHaveAttribute('aria-controls');

    await user.click(screen.getByRole('heading', { name: 'Climbs & Descents' }));
    expect(disclosure).toHaveFocus();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Enter}');
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard(' ');
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  });

  it('labels every segment metric icon with a tooltip', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Climbs & Descents' }));
    const climb = screen.getByRole('button', { name: /^Climb 1/u });
    const icons = [...climb.querySelectorAll('svg')];
    expect(icons).toHaveLength(4);

    for (const [index, label] of [
      'Distance',
      'Elevation gain',
      'Elevation loss',
      'Average grade',
    ].entries()) {
      const icon = icons[index];
      if (icon === undefined) throw new Error(`Expected icon ${String(index)}.`);
      await user.hover(icon);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
      await user.unhover(icon);
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      });
    }
  });

  it('shares hover, focus, and persistent selection callbacks', async () => {
    const user = userEvent.setup();
    const onSegmentHoverChange = vi.fn();
    const onSegmentSelectionChange = vi.fn();
    renderSection({ onSegmentHoverChange, onSegmentSelectionChange });
    await user.click(screen.getByRole('button', { name: 'Climbs & Descents' }));
    const climb = screen.getByRole('button', { name: /^Climb 1/ });

    await user.hover(climb);
    expect(onSegmentHoverChange).toHaveBeenLastCalledWith(0);
    await user.unhover(climb);
    await user.tab();
    await user.tab();
    expect(climb).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSegmentSelectionChange).toHaveBeenCalledWith(0);
    expect(onSegmentHoverChange).toHaveBeenCalledWith(null);
  });

  it('recalculates without toggling the disclosure', async () => {
    const user = userEvent.setup();
    const onRecalculate = vi.fn();
    renderSection({ onRecalculate });
    const disclosure = screen.getByRole('button', { name: 'Climbs & Descents' });

    await user.click(screen.getByRole('button', { name: 'Recalculate elevation' }));

    expect(onRecalculate).toHaveBeenCalledOnce();
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  });

  it('recalculates without toggling an expanded disclosure', async () => {
    const user = userEvent.setup();
    const onRecalculate = vi.fn();
    renderSection({ onRecalculate });
    const disclosure = screen.getByRole('button', { name: 'Climbs & Descents' });
    await user.click(disclosure);

    await user.click(screen.getByRole('button', { name: 'Recalculate elevation' }));

    expect(onRecalculate).toHaveBeenCalledOnce();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  });

  it('formats signed grades, threshold distances, and rounded elevations', () => {
    expect([
      formatTrackGrade(-0),
      formatTrackGrade(0),
      formatTrackGrade(3.6),
      formatTrackGrade(-3.6),
    ]).toEqual(['0%', '0%', '+4%', '-4%']);
    expect([formatTrackDistance(9_999), formatTrackDistance(10_000)]).toEqual([
      '10.0 km',
      '10 km',
    ]);
    expect(formatTrackElevation(1_234.6)).toBe('1,235 m');
  });
});
