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
import { useState } from 'react';

import type {
  MarkerWeatherPeriodSelection,
  WeatherIntervalPreferences,
  MarkerWeatherWeekday,
} from '@/application/weather/MarkerWeatherForecast';
import { markerWeatherWeekdayOptions } from '@/presentation/markers/markerWeatherWeekdayOptions';

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
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: WeatherIntervalPreferences) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      onClose();
    } catch {
      setError('Weather settings could not be saved.');
    } finally {
      setSaving(false);
    }
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
      aria-labelledby="marker-weather-settings-title"
    >
      <DialogTitle id="marker-weather-settings-title">Marker weather</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          {error === null ? null : <Alert severity="error">{error}</Alert>}
          <Stack spacing={1}>
            <Typography component="h3" variant="subtitle2">
              Forecast days
            </Typography>
            <ToggleButtonGroup
              aria-label="Forecast weekdays"
              value={draft.weekdays}
              onChange={(_, values: MarkerWeatherWeekday[]) => {
                if (values.length <= 2) {
                  setDraft((current) => ({ ...current, weekdays: values }));
                }
              }}
              size="small"
              sx={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}
            >
              {markerWeatherWeekdayOptions.map((option) => (
                <ToggleButton
                  key={option.value}
                  value={option.value}
                  aria-label={option.label}
                >
                  {option.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              Choose one or two weekdays. Clear all days to disable marker forecasts.
            </Typography>
          </Stack>

          <Stack spacing={1}>
            <Typography component="h3" variant="subtitle2">
              Hours
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              aria-label="Forecast period"
              value={draft.period.kind}
              onChange={(_, kind: MarkerWeatherPeriodSelection['kind'] | null) => {
                choosePeriod(kind);
              }}
            >
              <ToggleButton value="day">
                <WbSunnyOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} /> Day
              </ToggleButton>
              <ToggleButton value="night">
                <BedtimeOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} /> Night
              </ToggleButton>
              <ToggleButton value="custom">
                <ScheduleOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} /> Custom
              </ToggleButton>
            </ToggleButtonGroup>
            {draft.period.kind === 'custom' ? (
              <Stack direction="row" spacing={1}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="From"
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
                  label="Until"
                  value={draft.period.endHour}
                  error={draft.period.startHour === draft.period.endHour}
                  helperText={
                    draft.period.startHour === draft.period.endHour
                      ? 'Choose a different hour'
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
            control={
              <Switch
                checked={draft.showOnMap}
                onChange={(_, checked) => {
                  setDraft((current) => ({ ...current, showOnMap: checked }));
                }}
              />
            }
            label="Show forecasts on the map"
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
          Clear forecast
        </Button>
        <Stack direction="row" spacing={1}>
          <Button disabled={saving} onClick={onClose}>
            Cancel
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
            Save
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
