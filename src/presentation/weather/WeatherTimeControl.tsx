import {
  Box,
  Link,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import lookupTimeZone from '@photostructure/tz-lookup';
import { useMemo, type MouseEvent } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { mapInteractionStore } from '@/presentation/map/mapInteractionStore';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import {
  weatherCloudCoverColorScale,
  weatherCloudLegendStops,
  weatherPrecipitationColorScale,
  weatherPrecipitationLegendStops,
  weatherScaleGradient,
} from '@/presentation/weather/weatherMapStyle';

interface ForecastDay {
  readonly key: string;
  readonly label: string;
  readonly buttonLabel: string;
  readonly indexes: readonly number[];
}

interface ForecastDateParts {
  readonly dayKey: string;
  readonly minuteOfDay: number;
}

interface ForecastTimeFormatters {
  readonly day: Intl.DateTimeFormat;
  readonly compactDay: Intl.DateTimeFormat;
  readonly time: Intl.DateTimeFormat;
  readonly parts: Intl.DateTimeFormat;
}

function dateFormatter(
  options: Intl.DateTimeFormatOptions,
  timeZone: string | undefined,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(
    undefined,
    timeZone === undefined ? options : { ...options, timeZone },
  );
}

function createForecastTimeFormatters(
  timeZone: string | undefined,
): ForecastTimeFormatters {
  return {
    day: dateFormatter({ weekday: 'short', day: 'numeric', month: 'short' }, timeZone),
    compactDay: dateFormatter({ weekday: 'short', day: 'numeric' }, timeZone),
    time: dateFormatter({ hour: '2-digit', minute: '2-digit' }, timeZone),
    parts: dateFormatter(
      {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        numberingSystem: 'latn',
      },
      timeZone,
    ),
  };
}

function forecastDateParts(
  date: Date,
  formatter: Intl.DateTimeFormat,
): ForecastDateParts {
  let year = '';
  let month = '';
  let day = '';
  let hour = 0;
  let minute = 0;
  for (const part of formatter.formatToParts(date)) {
    switch (part.type) {
      case 'year':
        year = part.value;
        break;
      case 'month':
        month = part.value;
        break;
      case 'day':
        day = part.value;
        break;
      case 'hour':
        hour = Number(part.value);
        break;
      case 'minute':
        minute = Number(part.value);
        break;
    }
  }
  return {
    dayKey: `${year}-${month}-${day}`,
    minuteOfDay: hour * 60 + minute,
  };
}
const calendarRowCount = 2;
const cloudGradient = weatherScaleGradient(weatherCloudCoverColorScale);
const precipitationGradient = weatherScaleGradient(weatherPrecipitationColorScale);

function WeatherScaleLegend({
  gradient,
  label,
  stops,
  unit,
}: {
  readonly gradient: string;
  readonly label: string;
  readonly stops: readonly { readonly color: string; readonly value: number }[];
  readonly unit: string;
}) {
  return (
    <Box
      aria-label={`${label}: ${stops.map(({ value }) => `${value.toString()} ${unit}`).join(', ')}`}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {unit}
        </Typography>
      </Stack>
      <Box
        aria-hidden
        sx={{
          height: 16,
          mt: 0.25,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          backgroundColor: '#eef2f5',
          backgroundImage: gradient,
        }}
      />
      <Box
        aria-hidden
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${String(stops.length)}, minmax(0, 1fr))`,
          mt: 0.125,
        }}
      >
        {stops.map((stop) => (
          <Typography
            key={stop.value}
            component="span"
            variant="caption"
            sx={{
              minWidth: 0,
              color: 'text.secondary',
              fontSize: '0.625rem',
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
              borderTop: `2px solid ${stop.color}`,
            }}
          >
            {stop.value}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

export function WeatherTimeControl() {
  const { mapLayers } = useRuntimeServices();
  const weatherMap = useStore(mapLayerStore, (state) => state.weatherMap);
  const selectedPoint = useStore(
    mapInteractionStore,
    (state) => state.selectedWeatherForecastPoint,
  );
  const latitude = selectedPoint?.coordinate.latitude;
  const longitude = selectedPoint?.coordinate.longitude;
  const timeZone = useMemo(
    () =>
      latitude === undefined || longitude === undefined
        ? undefined
        : lookupTimeZone(latitude, longitude),
    [latitude, longitude],
  );
  const formatters = useMemo(() => createForecastTimeFormatters(timeZone), [timeZone]);
  const days = useMemo<readonly ForecastDay[]>(() => {
    const groups = new Map<
      string,
      { label: string; buttonLabel: string; indexes: number[] }
    >();
    weatherMap.validTimes.forEach((validTime, index) => {
      const date = new Date(validTime);
      const key = forecastDateParts(date, formatters.parts).dayKey;
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, {
          label: formatters.day.format(date),
          buttonLabel: formatters.compactDay.format(date),
          indexes: [index],
        });
      } else {
        existing.indexes.push(index);
      }
    });
    return [...groups].map(([key, value]) => ({ key, ...value }));
  }, [formatters, weatherMap.validTimes]);

  if (
    !weatherMap.enabled ||
    weatherMap.status !== 'ready' ||
    weatherMap.selectedTimeIndex === null
  ) {
    return null;
  }
  const selectedTimeIndex = weatherMap.selectedTimeIndex;

  const selectedTime = new Date(weatherMap.validTimes[selectedTimeIndex] ?? '');
  const selectedDateParts = forecastDateParts(selectedTime, formatters.parts);
  const selectedDayKey = selectedDateParts.dayKey;
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
    const targetMinute = selectedDateParts.minuteOfDay;
    let nearestIndex = day.indexes[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const index of day.indexes) {
      const validTime = weatherMap.validTimes[index];
      if (validTime === undefined) continue;
      const distance = Math.abs(
        forecastDateParts(new Date(validTime), formatters.parts).minuteOfDay -
          targetMinute,
      );
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
        width: { sm: 620 },
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
                  aria-label={formatters.time.format(new Date(validTime))}
                >
                  {formatters.time.format(new Date(validTime))}
                </ToggleButton>
              );
            })}
          </ToggleButtonGroup>
        </Box>
        <Box
          aria-label="Weather map legend"
          sx={{
            display: { xs: 'none', sm: 'grid' },
            gridTemplateColumns: '1fr 1.35fr',
            columnGap: 1.5,
            rowGap: 0.75,
          }}
        >
          <WeatherScaleLegend
            gradient={cloudGradient}
            label="Cloud cover · ≤30 transparent"
            stops={weatherCloudLegendStops}
            unit="%"
          />
          <WeatherScaleLegend
            gradient={precipitationGradient}
            label="Precipitation · ≤0.5 transparent"
            stops={weatherPrecipitationLegendStops}
            unit="mm"
          />
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Box
              aria-hidden
              sx={{
                position: 'relative',
                width: 32,
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
              Wind direction and speed
            </Typography>
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ alignSelf: 'center', justifySelf: 'end', textAlign: 'right' }}
          >
            Low-resolution data. Use{' '}
            <Link
              href="https://www.windy.com/"
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
            >
              Windy
            </Link>{' '}
            for a precise forecast.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
