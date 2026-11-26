import { useLingui } from '@lingui/react/macro';
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useId, type ReactElement } from 'react';

import {
  hikingTimePresets,
  resolveHikingTimePreset,
  type HikingTimePresetSettings,
} from '@/domain/tracks/hikingTime';
import {
  estimateDivergence,
  formatEstimateDivergence,
  hikingTimePresetName,
} from '@/presentation/tracks/hikingTimePresetFormat';
import { formatTrackDuration } from '@/presentation/tracks/trackFormatters';

/**
 * Select value of the entry that follows the default preset. MUI renders an empty value
 * as no selection, so it is a token no preset uses: built-in IDs are fixed and user
 * preset IDs start with `custom:`.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Select value token.
const followDefaultValue = 'follow-default';

interface HikingTimePresetSelectProps {
  readonly label: string;
  readonly settings: HikingTimePresetSettings;
  /** Null follows the default preset; an explicit choice is offered only when nullable. */
  readonly value: string | null;
  readonly onChange: (presetId: string | null) => void;
  /** Offer "Default (…)" for a track that should follow future default changes. */
  readonly allowDefault?: boolean;
  /** Each preset's estimated total seconds, shown beside its name. */
  readonly estimates?: ReadonlyMap<string, number>;
  /** Recorded total seconds; each option then also shows its signed divergence. */
  readonly recordedSeconds?: number;
  readonly disabled?: boolean;
}

/** Hiking time presets with their estimates, for a track or a report. */
export function HikingTimePresetSelect({
  label,
  settings,
  value,
  onChange,
  allowDefault = false,
  estimates,
  recordedSeconds,
  disabled = false,
}: HikingTimePresetSelectProps): ReactElement {
  const { i18n, t } = useLingui();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const labelId = `hiking-time-preset-${useId().replaceAll(':', '')}`;
  const presets = hikingTimePresets(settings);
  const defaultPreset = resolveHikingTimePreset(settings, null);
  const detail = (presetId: string): string | null => {
    const seconds = estimates?.get(presetId);
    if (seconds === undefined) return null;
    const duration = formatTrackDuration(seconds, i18n);
    if (recordedSeconds === undefined || recordedSeconds <= 0) return t`≈${duration}`;
    const divergence = formatEstimateDivergence(
      estimateDivergence(seconds, recordedSeconds),
      i18n,
    );
    return t`≈${duration} (${divergence})`;
  };
  const option = (key: string, optionValue: string, name: string, presetId: string) => {
    const text = detail(presetId);
    return (
      <MenuItem key={key} value={optionValue}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ width: '100%', minWidth: 0, justifyContent: 'space-between' }}
        >
          <Typography variant="body2" noWrap>
            {name}
          </Typography>
          {text === null ? null : (
            // The estimate is the option's point; the preset name truncates first.
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ flexShrink: 0 }}
            >
              {text}
            </Typography>
          )}
        </Stack>
      </MenuItem>
    );
  };
  const defaultName = hikingTimePresetName(defaultPreset, i18n);
  return (
    <FormControl size="small" fullWidth disabled={disabled}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select<string>
        labelId={labelId}
        label={label}
        value={
          // A preset unknown here, such as another device's user preset, times the
          // track with the default, so it shows as following the default.
          value !== null && presets.some((preset) => preset.id === value)
            ? value
            : allowDefault
              ? followDefaultValue
              : defaultPreset.id
        }
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === followDefaultValue ? null : next);
        }}
      >
        {allowDefault
          ? option(
              followDefaultValue,
              followDefaultValue,
              t`Default (${defaultName})`,
              defaultPreset.id,
            )
          : null}
        {presets.map((preset) =>
          option(preset.id, preset.id, hikingTimePresetName(preset, i18n), preset.id),
        )}
      </Select>
    </FormControl>
  );
}
