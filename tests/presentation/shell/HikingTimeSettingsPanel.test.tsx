import { screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import {
  DAY_HIKE_TIME_PRESET_ID,
  builtInHikingTimePresets,
  defaultHikingTimePresetSettings,
  resolveHikingTimePreset,
  type HikingTimePreset,
} from '@/domain/tracks/hikingTime';
import { activateAppLocale } from '@/presentation/localization/appI18n';
import { SettingsDialog } from '@/presentation/shell/SettingsDialog';
import { useUiStore } from '@/presentation/shell/uiStore';
import { createTestServices } from '@test/helpers/createTestServices';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

const fastPreset: HikingTimePreset = {
  id: 'custom:fast',
  name: 'Fast pace',
  parameters: {
    movement: {
      kind: 'din',
      horizontalKmh: 5,
      ascentMetersPerHour: 400,
      descentMetersPerHour: 600,
    },
    altitudeBands: [],
    breakMinutesPerMovingHour: 10,
    lunchMinutes: 30,
    lunchMinimumMovingHours: 3,
    movingHoursPerDay: 8,
  },
};

let services: RuntimeServices;

beforeEach(() => {
  activateAppLocale('en');
  services = createTestServices();
  useUiStore.setState({ hikingTimePresets: defaultHikingTimePresetSettings });
});

afterEach(() => {
  services.dispose();
});

async function openHikingTimeSettings(): Promise<UserEvent> {
  const user = userEvent.setup();
  renderWithI18n(
    <RuntimeServicesProvider services={services}>
      <SettingsDialog
        open
        developerMode={false}
        komootElevation="ask"
        locale="en"
        onClose={vi.fn()}
        onDeveloperModeChange={vi.fn()}
        onKomootElevationChange={vi.fn()}
        onLocaleChange={vi.fn()}
        storageUsage={services.storageUsage}
      />
    </RuntimeServicesProvider>,
  );
  await user.click(screen.getByRole('tab', { name: 'Hiking time' }));
  expect(screen.getByRole('tabpanel', { name: 'Hiking time settings' })).toBeVisible();
  return user;
}

async function replaceValue(user: UserEvent, name: string, value: string) {
  const field = screen.getByRole('spinbutton', { name });
  await user.clear(field);
  if (value !== '') await user.type(field, value);
}

describe('HikingTimeSettingsPanel', () => {
  it('stores the chosen default preset', async () => {
    const user = await openHikingTimeSettings();

    await user.click(screen.getByRole('combobox', { name: 'Default preset' }));
    await user.click(screen.getByRole('option', { name: 'Multi-day trek' }));

    expect(useUiStore.getState().hikingTimePresets.defaultPresetId).toBe('multi-day');
    expect(screen.getByRole('combobox', { name: 'Default preset' })).toHaveTextContent(
      'Multi-day trek',
    );
  });

  it('saves an edited built-in preset as a new custom preset', async () => {
    const user = await openHikingTimeSettings();

    expect(screen.getByRole('combobox', { name: 'Edit preset' })).toHaveTextContent(
      'Day hike',
    );
    expect(
      screen.getByText('Built-in presets can be copied, not changed.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await replaceValue(user, 'Lunch, min', '25');
    await user.click(screen.getByRole('button', { name: 'Save as new preset' }));
    const name = screen.getByRole('textbox', { name: 'Preset name' });
    expect(name).toHaveValue('Day hike copy');
    await user.clear(name);
    await user.type(name, '  Short lunch ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const settings = useUiStore.getState().hikingTimePresets;
    const dayHike = resolveHikingTimePreset(settings, DAY_HIKE_TIME_PRESET_ID);
    expect(settings.custom).toEqual([
      {
        id: expect.stringMatching(/^custom:/) as unknown,
        name: 'Short lunch',
        parameters: { ...dayHike.parameters, lunchMinutes: 25 },
      },
    ]);
    expect(dayHike.parameters.lunchMinutes).toBe(27);
    expect(builtInHikingTimePresets.find((preset) => preset.id === dayHike.id)).toBe(
      dayHike,
    );
    expect(screen.getByRole('combobox', { name: 'Edit preset' })).toHaveTextContent(
      'Short lunch',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('falls back to the day-hike preset after deleting the default custom preset', async () => {
    useUiStore.setState({
      hikingTimePresets: { defaultPresetId: fastPreset.id, custom: [fastPreset] },
    });
    const user = await openHikingTimeSettings();

    expect(screen.getByRole('combobox', { name: 'Edit preset' })).toHaveTextContent(
      'Fast pace',
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(useUiStore.getState().hikingTimePresets).toEqual({
      defaultPresetId: DAY_HIKE_TIME_PRESET_ID,
      custom: [],
    });
    expect(screen.getByRole('combobox', { name: 'Default preset' })).toHaveTextContent(
      'Day hike',
    );
  });

  it('disables saving while a value is invalid', async () => {
    useUiStore.setState({
      hikingTimePresets: { defaultPresetId: fastPreset.id, custom: [fastPreset] },
    });
    const user = await openHikingTimeSettings();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await replaceValue(user, 'Lunch, min', '45');
    expect(save).toBeEnabled();

    await replaceValue(user, 'Moving hours per day', '0');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Some values are missing or out of range.',
    );
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save as new preset' })).toBeDisabled();

    await replaceValue(user, 'Moving hours per day', '');
    expect(save).toBeDisabled();

    await replaceValue(user, 'Moving hours per day', '9');
    await user.click(save);
    expect(useUiStore.getState().hikingTimePresets.custom).toEqual([
      {
        ...fastPreset,
        parameters: {
          ...fastPreset.parameters,
          lunchMinutes: 45,
          movingHoursPerDay: 9,
        },
      },
    ]);
  });
});
