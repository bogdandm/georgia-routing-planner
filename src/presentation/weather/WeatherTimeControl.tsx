import {
  Box,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMemo, type MouseEvent } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';

interface ForecastDay {
  readonly key: string;
  readonly label: string;
  readonly buttonLabel: string;
  readonly indexes: readonly number[];
}

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const compactDayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});
const calendarRowCount = 2;

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
    const groups = new Map<
      string,
      { label: string; buttonLabel: string; indexes: number[] }
    >();
    weatherMap.validTimes.forEach((validTime, index) => {
      const date = new Date(validTime);
      const key = localDayKey(date);
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, {
          label: dayFormatter.format(date),
          buttonLabel: compactDayFormatter.format(date),
          indexes: [index],
        });
      } else {
        existing.indexes.push(index);
      }
    });
    return [...groups].map(([key, value]) => ({ key, ...value }));
  }, [weatherMap.validTimes]);

  if (
    !weatherMap.enabled ||
    weatherMap.status !== 'ready' ||
    weatherMap.selectedTimeIndex === null
  ) {
    return null;
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

  const calendarColumnCount = Math.max(1, Math.ceil(days.length / calendarRowCount));

  return (
    <Paper
      component="section"
      aria-label="Weather forecast time"
      elevation={4}
      sx={{
        position: 'absolute',
        top: 108,
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
        <ToggleButtonGroup
          exclusive
          size="small"
          value={selectedDayKey}
          onChange={selectDay}
          aria-label="Forecast day"
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${String(calendarColumnCount)}, minmax(0, 1fr))`,
            gap: 0.5,
            '& .MuiToggleButtonGroup-grouped': {
              minWidth: 0,
              m: 0,
              px: 0.75,
              py: 0.35,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              fontSize: '0.6875rem',
              '&:not(:first-of-type)': {
                ml: 0,
                borderLeft: 1,
                borderColor: 'divider',
                borderRadius: 1,
              },
              '&:first-of-type': { borderRadius: 1 },
            },
          }}
        >
          {days.map((day) => (
            <ToggleButton key={day.key} value={day.key} aria-label={day.label}>
              {day.buttonLabel}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
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
        <Stack
          direction="row"
          spacing={1.25}
          aria-label="Weather map legend"
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.25 }}
        >
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box
              aria-hidden
              sx={{
                width: 28,
                height: 6,
                borderRadius: 3,
                background:
                  'linear-gradient(90deg, rgba(66,72,78,0.08), rgba(66,72,78,0.95))',
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Clouds
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box
              aria-hidden
              sx={{
                width: 42,
                height: 6,
                borderRadius: 3,
                background:
                  'linear-gradient(90deg, #85ccfa, #0000ff, #42b608, #ffee00, #ff8800, #ff0000)',
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Precipitation
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box
              aria-hidden
              sx={{
                position: 'relative',
                width: 24,
                height: 8,
                borderTop: '1.5px solid #173941',
                transform: 'translateY(3px)',
                '&::after': {
                  position: 'absolute',
                  top: -4,
                  right: 0,
                  width: 6,
                  height: 6,
                  borderTop: '1.5px solid #173941',
                  borderRight: '1.5px solid #173941',
                  content: '""',
                  transform: 'rotate(45deg)',
                },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Wind
            </Typography>
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  );
}
