import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TrackTimingPoint } from '@/application/weather/TrackWeatherForecast';
import {
  builtInHikingTimePresets,
  defaultHikingTimePresetSettings,
  type HikingTimePreset,
} from '@/domain/tracks/hikingTime';
import { activateAppLocale } from '@/presentation/localization/appI18n';
import { useUiStore } from '@/presentation/shell/uiStore';
import { HikingTimeMatch } from '@/presentation/tracks/HikingTimeMatch';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

const METERS_PER_DEGREE_LATITUDE = 111_195;
const START_MILLISECONDS = Date.UTC(2026, 5, 1, 7);

/** An hour on the flat, a ten-minute stop, then an hour climbing at 12 %. */
function recordedRoute(): TrackTimingPoint[] {
  const points: TrackTimingPoint[] = [];
  let distance = 0;
  let elevation = 1_000;
  for (let seconds = 0; seconds <= 7_800; seconds += 10) {
    if (seconds > 0 && (seconds <= 3_600 || seconds > 4_200)) {
      distance += 12;
      if (seconds > 4_200) elevation += 1.44;
    }
    points.push({
      coordinate: [44, 42 + distance / METERS_PER_DEGREE_LATITUDE],
      recordedAt: new Date(START_MILLISECONDS + seconds * 1_000).toISOString(),
      elevationMeters: elevation,
      distanceMeters: distance,
      sourceSegmentIndex: 0,
    });
  }
  return points;
}

const route = { points: recordedRoute() };
const metrics = { elapsedSeconds: 7_800, ascentMeters: 518, descentMeters: 0 };

const dayHike = builtInHikingTimePresets.find((preset) => preset.id === 'day-hike');
if (dayHike === undefined) throw new Error('The day-hike preset is missing.');
const customPreset: HikingTimePreset = {
  id: 'custom-slow',
  name: 'Slow pace',
  parameters: { ...dayHike.parameters, breakMinutesPerMovingHour: 30 },
};

beforeEach(() => {
  activateAppLocale('en');
  useUiStore.setState({
    hikingTimePresets: { ...defaultHikingTimePresetSettings, custom: [customPreset] },
  });
});

afterEach(() => {
  useUiStore.setState({ hikingTimePresets: defaultHikingTimePresetSettings });
});

function timeTableRow(name: RegExp): HTMLElement {
  const table = screen.getByRole('table', { name: 'Recorded and estimated time' });
  return within(table).getByRole('row', { name });
}

describe('HikingTimeMatch', () => {
  it('shows the track preset estimate against the recorded time', () => {
    renderWithI18n(<HikingTimeMatch route={route} metrics={metrics} presetId={null} />);

    expect(
      screen.getByText(/^Day hike estimate: \d+h \d+m \([+-]\d+% vs recorded\)$/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show report' })).toBeInTheDocument();
  });

  it('compares every preset in the report without changing the track preset', async () => {
    const user = userEvent.setup();
    renderWithI18n(<HikingTimeMatch route={route} metrics={metrics} presetId={null} />);

    await user.click(screen.getByRole('button', { name: 'Show report' }));
    const dialog = screen.getByRole('dialog', { name: 'Hiking time report' });
    expect(within(dialog).getByRole('row', { name: /^Breaks/ })).toHaveTextContent(
      /^Breaks\s*\d+h \d+m/,
    );
    expect(
      within(dialog).getByRole('table', { name: 'Moving speed by grade' }),
    ).toHaveTextContent(/km\/h/);
    expect(within(dialog).getByRole('table', { name: 'Accuracy' })).toBeInTheDocument();
    const dayHikeMoving = timeTableRow(/^Moving/).textContent;

    await user.click(within(dialog).getByRole('combobox', { name: 'Preset' }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    for (const option of options) {
      expect(option).toHaveTextContent(/≈\d+h \d+m \([+-]?\d+%\)/);
    }
    await user.click(screen.getByRole('option', { name: /^DIN 33466 \(standard\)/ }));

    expect(timeTableRow(/^Moving/).textContent).not.toBe(dayHikeMoving);
    expect(screen.getByText(/^Day hike estimate:/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('combobox', { name: 'Preset' }));
    await user.click(screen.getByRole('option', { name: /^Slow pace/ }));

    expect(
      within(dialog).getByText(
        'No calibration statistics exist for this custom preset.',
      ),
    ).toBeInTheDocument();
  });
});
