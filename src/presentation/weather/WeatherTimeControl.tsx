import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import {
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, type MouseEvent } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';

interface ForecastDay {
  readonly key: string;
  readonly label: string;
  readonly indexes: readonly number[];
}

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});
const zoneFormatter = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });

function localDayKey(date: Date): string {
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function localMinuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function WeatherTimeControl() {
  const { mapLayers } = useRuntimeServices();
  const weatherMap = useStore(mapLayerStore, (state) => state.weatherMap);
  const days = useMemo<readonly ForecastDay[]>(() => {
    const groups = new Map<string, { label: string; indexes: number[] }>();
    weatherMap.validTimes.forEach((validTime, index) => {
      const date = new Date(validTime);
      const key = localDayKey(date);
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, { label: dayFormatter.format(date), indexes: [index] });
      } else {
        existing.indexes.push(index);
      }
    });
    return [...groups].map(([key, value]) => ({ key, ...value }));
  }, [weatherMap.validTimes]);

  if (!weatherMap.enabled) return null;

  if (weatherMap.status !== 'ready' || weatherMap.selectedTimeIndex === null) {
    return (
      <Paper
        aria-live="polite"
        elevation={3}
        sx={{
          position: 'absolute',
          top: 62,
          right: { xs: 12, sm: 54 },
          zIndex: 3,
          px: 1.5,
          py: 1,
          borderRadius: 2,
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={16} />
          <Typography variant="caption">Loading ECMWF forecast frames…</Typography>
        </Stack>
      </Paper>
    );
  }
  const selectedTimeIndex = weatherMap.selectedTimeIndex;

  const selectedTime = new Date(weatherMap.validTimes[selectedTimeIndex] ?? '');
  const selectedDayKey = localDayKey(selectedTime);
  const selectedDay = days.find((day) => day.key === selectedDayKey);
  const selectFrame = (index: number) => {
    const validTime = weatherMap.validTimes[index];
    if (validTime !== undefined)
      mapLayers?.selectWeatherForecastTime(new Date(validTime));
  };
  const selectDay = (_event: MouseEvent<HTMLElement>, dayKey: string | null) => {
    if (dayKey === null) return;
    const day = days.find((candidate) => candidate.key === dayKey);
    if (day === undefined) return;
    const targetMinute = localMinuteOfDay(selectedTime);
    let nearestIndex = day.indexes[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const index of day.indexes) {
      const validTime = weatherMap.validTimes[index];
      if (validTime === undefined) continue;
      const distance = Math.abs(localMinuteOfDay(new Date(validTime)) - targetMinute);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    if (nearestIndex !== undefined) selectFrame(nearestIndex);
  };

  return (
    <Paper
      component="section"
      aria-label="Weather forecast time"
      elevation={4}
      sx={{
        position: 'absolute',
        top: 62,
        right: { xs: 12, sm: 54 },
        left: { xs: 12, sm: 'auto' },
        zIndex: 3,
        width: { sm: 520 },
        maxWidth: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 70px)' },
        p: 1,
        borderRadius: 2,
        bgcolor: 'rgba(255, 255, 255, 0.94)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
              ECMWF IFS 0.25°
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {dayFormatter.format(selectedTime)} · {timeFormatter.format(selectedTime)}{' '}
              {zoneFormatter
                .formatToParts(selectedTime)
                .find((part) => part.type === 'timeZoneName')?.value ?? ''}
            </Typography>
          </Box>
          <Tooltip title="Previous forecast frame">
            <span>
              <IconButton
                size="small"
                disabled={selectedTimeIndex === 0}
                aria-label="Previous forecast frame"
                onClick={() => {
                  selectFrame(selectedTimeIndex - 1);
                }}
              >
                <NavigateBeforeIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Next forecast frame">
            <span>
              <IconButton
                size="small"
                disabled={selectedTimeIndex === weatherMap.validTimes.length - 1}
                aria-label="Next forecast frame"
                onClick={() => {
                  selectFrame(selectedTimeIndex + 1);
                }}
              >
                <NavigateNextIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Box sx={{ overflowX: 'auto', pb: 0.25 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={selectedDayKey}
            onChange={selectDay}
            aria-label="Forecast day"
            sx={{
              whiteSpace: 'nowrap',
              '& .MuiToggleButton-root': { px: 1.25, py: 0.5 },
            }}
          >
            {days.map((day) => (
              <ToggleButton key={day.key} value={day.key} aria-label={day.label}>
                {day.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ overflowX: 'auto' }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={selectedTimeIndex}
            onChange={(_event, value: number | null) => {
              if (value !== null) selectFrame(value);
            }}
            aria-label="Forecast time"
            sx={{
              whiteSpace: 'nowrap',
              '& .MuiToggleButton-root': { px: 1.25, py: 0.35 },
            }}
          >
            {(selectedDay?.indexes ?? []).map((index) => {
              const validTime = weatherMap.validTimes[index];
              return validTime === undefined ? null : (
                <ToggleButton
                  key={validTime}
                  value={index}
                  aria-label={timeFormatter.format(new Date(validTime))}
                >
                  {timeFormatter.format(new Date(validTime))}
                </ToggleButton>
              );
            })}
          </ToggleButtonGroup>
        </Box>
      </Stack>
    </Paper>
  );
}
