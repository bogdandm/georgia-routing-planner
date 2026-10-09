import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ElevationProfile } from '@/domain/tracks/elevationProfile';
import { activateAppLocale } from '@/presentation/localization/appI18n';
import { ElevationGradeLegend } from '@/presentation/map/ElevationGradeLegend';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

const profile: ElevationProfile = {
  algorithmVersion: 3,
  gradeSubsegments: [
    {
      startSampleIndex: 0,
      endSampleIndex: 1,
      startDistanceMeters: 0,
      endDistanceMeters: 100,
      distanceMeters: 100,
      averageGradePct: 8,
      band: 'climb',
    },
  ],
  maximumMeters: 1_200,
  minimumMeters: 1_000,
  points: [],
  segments: [],
};

describe('ElevationGradeLegend', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('hides the legend after it is dismissed', async () => {
    const user = userEvent.setup();
    const onDismissedChange = vi.fn();
    const { rerender } = renderWithI18n(
      <ElevationGradeLegend
        dismissed={false}
        onDismissedChange={onDismissedChange}
        profile={profile}
        visible
      />,
    );

    expect(screen.getByRole('heading', { name: 'Track grade (%)' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide track grade legend' }));
    expect(onDismissedChange).toHaveBeenCalledWith(true);

    rerender(
      <ElevationGradeLegend
        dismissed
        onDismissedChange={onDismissedChange}
        profile={profile}
        visible
      />,
    );

    expect(
      screen.queryByRole('heading', { name: 'Track grade (%)' }),
    ).not.toBeInTheDocument();
  });
});
