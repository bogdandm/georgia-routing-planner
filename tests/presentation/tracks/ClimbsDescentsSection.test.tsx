import { ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  MacroElevationSegment,
  MacroElevationSegmentType,
} from '@/domain/tracks/elevationProfile';
import { ClimbsDescentsSection } from '@/presentation/tracks/ClimbsDescentsSection';
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

function renderSection(overrides: {
  readonly activeSegmentIndex?: number | null;
  readonly selectedSegmentIndex?: number | null;
  readonly onSegmentHoverChange?: (index: number | null) => void;
  readonly onSegmentSelectionChange?: (index: number | null) => void;
} = {}) {
  return render(
    <ThemeProvider theme={createAppTheme()}>
      <ClimbsDescentsSection
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
      '#1 Climb, +10%, 1.0 km, 100 m, 3 m descent',
      '#2 Descent, -8%, 1.0 km, 80 m, 5 m ascent',
    ]);
  });

  it('shares hover, focus, and persistent selection callbacks', async () => {
    const user = userEvent.setup();
    const onSegmentHoverChange = vi.fn();
    const onSegmentSelectionChange = vi.fn();
    renderSection({ onSegmentHoverChange, onSegmentSelectionChange });
    await user.click(screen.getByRole('button', { name: 'Climbs & Descents' }));
    const climb = screen.getByRole('button', { name: /^#1 Climb/ });

    await user.hover(climb);
    expect(onSegmentHoverChange).toHaveBeenLastCalledWith(0);
    await user.click(climb);
    expect(onSegmentSelectionChange).toHaveBeenCalledWith(0);
    await user.unhover(climb);
    expect(onSegmentHoverChange).toHaveBeenLastCalledWith(null);
  });
});
