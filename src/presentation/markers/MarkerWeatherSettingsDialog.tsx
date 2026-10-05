import { Trans, useLingui } from '@lingui/react/macro';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
import BedtimeOutlinedIcon from '@mui/icons-material/BedtimeOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';

import type {
  MarkerWeatherPeriodSelection,
  WeatherIntervalPreferences,
  MarkerWeatherWeekday,
} from '@/application/weather/MarkerWeatherForecast';
import {
  createMarkerWeatherDateLabels,
  markerWeatherWeekdayOrder,
} from '@/presentation/markers/markerWeatherDateLabels';

const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, '0')}:00`,
}));

interface MarkerWeatherSettingsDialogProps {
  readonly open: boolean;
  readonly preferences: WeatherIntervalPreferences;
  readonly onClose: () => void;
  readonly onSave: (preferences: WeatherIntervalPreferences) => Promise<void>;
}

export function MarkerWeatherSettingsDialog({
  open,
  preferences,
  onClose,
  onSave,
}: MarkerWeatherSettingsDialogProps) {
  const { i18n, t } = useLingui();
  const dateLabels = useMemo(
    () => createMarkerWeatherDateLabels(i18n.locale),
    [i18n.locale],
  );
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const save = async (next: WeatherIntervalPreferences) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave(next);
      onClose();
    } catch {
      setSaveFailed(true);
    }
    setSaving(false);
  };

  const choosePeriod = (kind: MarkerWeatherPeriodSelection['kind'] | null) => {
    if (kind === null) return;
    setDraft((current) => {
      const period: MarkerWeatherPeriodSelection =
        kind === 'custom'
          ? current.period.kind === 'custom'
            ? current.period
            : { kind: 'custom', startHour: 8, endHour: 18 }
          : { kind };
      return { ...current, period };
    });
  };

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="xs"
      onClose={saving ? undefined : onClose}
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Element ID.
      aria-labelledby="marker-weather-settings-title"
    >
      <DialogTitle id="marker-weather-settings-title">
        <Trans>Marker weather</Trans>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          {saveFailed ? (
            <Alert severity="error">
              <Trans>Weather settings could not be saved.</Trans>
            </Alert>
          ) : null}
          <Stack spacing={1}>
            <Typography component="h3" variant="subtitle2">
              <Trans>Forecast days</Trans>
            </Typography>
            <ToggleButtonGroup
              fullWidth
              aria-label={t`Forecast weekdays`}
              value={draft.weekdays}
              onChange={(_, values: MarkerWeatherWeekday[]) => {
                if (values.length > 2) return;
                setDraft((current) => {
                  const retained = current.weekdays.filter((weekday) =>
                    values.includes(weekday),
                  );
                  const added = values.find(
                    (weekday) => !current.weekdays.includes(weekday),
                  );
                  return {
                    ...current,
                    weekdays: added === undefined ? retained : [...retained, added],
                  };
                });
              }}
              size="small"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                '& .MuiToggleButton-root': {
                  minWidth: 0,
                  px: 0.5,
                },
              }}
            >
              {markerWeatherWeekdayOrder.map((weekday) => {
                const label = dateLabels.weekday(weekday);
                return (
                  <ToggleButton key={weekday} value={weekday} aria-label={label}>
                    {label}
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              <Trans>
                Choose one or two weekdays. Clear all days to disable marker forecasts.
              </Trans>
            </Typography>
          </Stack>

          <Stack spacing={1}>
            <Typography component="h3" variant="subtitle2">
              <Trans>Hours</Trans>
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              aria-label={t`Forecast period`}
              value={draft.period.kind}
              onChange={(_, kind: MarkerWeatherPeriodSelection['kind'] | null) => {
                choosePeriod(kind);
              }}
            >
              <ToggleButton value="day" sx={{ gap: 0.75 }}>
                <WbSunnyOutlinedIcon fontSize="small" /> <Trans>Day</Trans>
              </ToggleButton>
              <ToggleButton value="night" sx={{ gap: 0.75 }}>
                <BedtimeOutlinedIcon fontSize="small" /> <Trans>Night</Trans>
              </ToggleButton>
              <ToggleButton value="custom" sx={{ gap: 0.75 }}>
                <ScheduleOutlinedIcon fontSize="small" /> <Trans>Custom</Trans>
              </ToggleButton>
            </ToggleButtonGroup>
            {draft.period.kind === 'custom' ? (
              <Stack direction="row" spacing={1}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={t`From`}
                  value={draft.period.startHour}
                  onChange={(event) => {
                    const startHour = Number(event.target.value);
                    setDraft((current) => ({
                      ...current,
                      period:
                        current.period.kind === 'custom'
                          ? { ...current.period, startHour }
                          : current.period,
                    }));
                  }}
                >
                  {hourOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={t`Until`}
                  value={draft.period.endHour}
                  error={draft.period.startHour === draft.period.endHour}
                  helperText={
                    draft.period.startHour === draft.period.endHour
                      ? t`Choose a different hour`
                      : ' '
                  }
                  onChange={(event) => {
                    const endHour = Number(event.target.value);
                    setDraft((current) => ({
                      ...current,
                      period:
                        current.period.kind === 'custom'
                          ? { ...current.period, endHour }
                          : current.period,
                    }));
                  }}
                >
                  {hourOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            ) : null}
          </Stack>

          <FormControlLabel
            sx={{ m: 0 }}
            control={
              <Switch
                checked={draft.showOnMap}
                onChange={(_, checked) => {
                  setDraft((current) => ({ ...current, showOnMap: checked }));
                }}
              />
            }
            label={t`Show forecasts on the map`}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button
          color="error"
          disabled={saving || draft.weekdays.length === 0}
          onClick={() => {
            void save({ ...draft, weekdays: [] });
          }}
        >
          <Trans>Clear forecast</Trans>
        </Button>
        <Stack direction="row" spacing={1}>
          <Button disabled={saving} onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="contained"
            disabled={
              saving ||
              (draft.period.kind === 'custom' &&
                draft.period.startHour === draft.period.endHour)
            }
            onClick={() => {
              void save(draft);
            }}
          >
            <Trans>Save</Trans>
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
