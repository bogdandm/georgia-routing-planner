import AirOutlinedIcon from '@mui/icons-material/AirOutlined';
import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlinedIcon from '@mui/icons-material/ChevronRightOutlined';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import WbCloudyOutlinedIcon from '@mui/icons-material/WbCloudyOutlined';
import {
  Box,
  Button,
  Divider,
  IconButton,
  Link,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import {
  DEFAULT_WEATHER_MODEL,
  type PointWeatherForecast,
  type PointWeatherForecastDay,
  type PointWeatherForecastPeriod,
} from '@/application/weather/GetPointWeatherForecast';
import {
  PointWeatherForecastError,
  type HourlyWeatherForecast,
  type PointWeatherForecastErrorCode,
} from '@/application/ports/WeatherForecastGateway';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { weatherProviderConfiguration } from '@/bootstrap/configuration/WeatherProviderConfiguration';
import {
  consumeWeatherForecastRequest,
  mapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import type { MapCoordinate } from '@/presentation/map/mapTypes';
import {
  WeatherPeriodIcon,
  VisibilityStatusIcon,
  WeatherConditionIcon,
  WeatherIconTooltip,
} from '@/presentation/weather/WeatherConditionIcon';
import { describeWmoWeatherCode } from '@/presentation/weather/weatherConditionLabels';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

type WeatherPanelState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly coordinate: MapCoordinate }
  | {
      readonly status: 'ready';
      readonly coordinate: MapCoordinate;
      readonly forecast: PointWeatherForecast;
    }
  | {
      readonly status: 'error';
      readonly coordinate: MapCoordinate;
      readonly code: PointWeatherForecastErrorCode;
    };

function parseLocalDate(value: string): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return { year, month, day };
}

function localWeekday(date: string): string {
  const { year, month, day } = parseLocalDate(date);
  const weekday = weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  if (weekday === undefined) throw new RangeError('Invalid local forecast date.');
  return weekday;
}

function localDateLabel(date: string): string {
  const { month, day } = parseLocalDate(date);
  const monthLabel = months[month - 1];
  if (monthLabel === undefined) throw new RangeError('Invalid local forecast month.');
  return `${day.toString()} ${monthLabel}`;
}

function fullLocalDateTime(timestamp: string): string {
  return `${localWeekday(timestamp.slice(0, 10))} ${localDateLabel(timestamp.slice(0, 10))} ${timestamp.slice(0, 4)}, ${timestamp.slice(11, 16)}`;
}

function formatMillimetres(value: number): string {
  if (value === 0) return '0 mm';
  return value < 10 ? `${value.toFixed(1)} mm` : `${Math.round(value).toString()} mm`;
}

function formatRange(minimum: number, maximum: number, unit: string): string {
  const low = Math.round(minimum).toString();
  const high = Math.round(maximum).toString();
  return low === high ? `${low} ${unit}` : `${low}…${high} ${unit}`;
}

function formatWindRange(
  minimumKilometresPerHour: number,
  maximumKilometresPerHour: number,
): string {
  const minimum = (minimumKilometresPerHour / 3.6).toFixed(1);
  const maximum = (maximumKilometresPerHour / 3.6).toFixed(1);
  return minimum === maximum ? `${minimum} m/s` : `${minimum}…${maximum} m/s`;
}

function errorMessage(code: PointWeatherForecastErrorCode): string {
  if (code === 'provider-rate-limited') {
    return 'Weather service is temporarily rate-limited. Try again shortly.';
  }
  if (code === 'provider-timeout' || code === 'provider-unavailable') {
    return 'Weather forecast could not be loaded. Check your connection and try again.';
  }
  return 'Weather data could not be read. Try another point or try again later.';
}

function SelectedPoint({
  coordinate,
  forecast,
}: {
  readonly coordinate: MapCoordinate;
  readonly forecast?: PointWeatherForecast;
}) {
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)}
      {forecast === undefined
        ? null
        : ` · ${Math.round(forecast.elevationMeters).toLocaleString('en-US')} m`}
    </Typography>
  );
}

function LoadingForecast({ coordinate }: { readonly coordinate: MapCoordinate }) {
  return (
    <Stack spacing={2}>
      <SelectedPoint coordinate={coordinate} />
      <Skeleton variant="rounded" height={196} />
      <Stack direction="row" spacing={1} aria-label="Loading hourly forecast">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} variant="rounded" width={72} height={116} />
        ))}
      </Stack>
      <Stack spacing={0.5} aria-label="Loading seven-day forecast">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} variant="rounded" height={72} />
        ))}
      </Stack>
    </Stack>
  );
}

interface IntervalWeatherWidgetProps {
  readonly isDay: boolean;
  readonly label: string;
  readonly period: PointWeatherForecastPeriod;
  readonly showLabel?: boolean;
}

function IntervalWeatherWidget({
  isDay,
  label,
  period,
  showLabel = false,
}: IntervalWeatherWidgetProps) {
  const temperature = formatRange(
    period.temperatureMinCelsius,
    period.temperatureMaxCelsius,
    '°C',
  );
  const wind = formatWindRange(period.windSpeedMinKmh, period.windSpeedMaxKmh);
  const gusts = formatWindRange(period.windGustsMinKmh, period.windGustsMaxKmh);
  const precipitation = formatMillimetres(period.precipitationMm);
  const temperatureMinimum = Math.round(period.temperatureMinCelsius).toString();
  const temperatureMaximum = Math.round(period.temperatureMaxCelsius).toString();
  const windMinimum = (period.windSpeedMinKmh / 3.6).toFixed(1);
  const windMaximum = (period.windSpeedMaxKmh / 3.6).toFixed(1);
  const gustMinimum = (period.windGustsMinKmh / 3.6).toFixed(1);
  const gustMaximum = (period.windGustsMaxKmh / 3.6).toFixed(1);

  return (
    <Box
      component="article"
      aria-label={`${label} forecast`}
      sx={{ minWidth: 0, px: 1, py: 0.75 }}
    >
      {showLabel ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}
        >
          {label}
        </Typography>
      ) : null}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '36px minmax(0, 1fr)',
          gap: 0.75,
          alignItems: 'center',
        }}
      >
        <Box sx={{ position: 'relative', width: 36, height: 36 }}>
          <WeatherPeriodIcon
            icon={period.status.primary.icon}
            isDay={isDay}
            label={`${label}: ${period.status.primary.label}`}
          />
          {period.status.visibility.label === null ? null : (
            <Box
              sx={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                display: 'grid',
                placeItems: 'center',
                width: 18,
                height: 18,
                borderRadius: '50%',
                bgcolor: 'background.paper',
              }}
            >
              <VisibilityStatusIcon status={period.status.visibility} />
            </Box>
          )}
        </Box>
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            aria-label={`${label} temperature ${temperatureMinimum} to ${temperatureMaximum} degrees Celsius`}
            sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
          >
            {temperature}
          </Typography>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}
          >
            <WeatherIconTooltip label={`${label} wind`}>
              <AirOutlinedIcon
                aria-hidden="true"
                sx={{ fontSize: 15, color: 'text.secondary' }}
              />
            </WeatherIconTooltip>
            <Typography
              variant="caption"
              aria-label={`${label} wind ${windMinimum} to ${windMaximum} metres per second`}
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {wind}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}
          >
            <WeatherIconTooltip label={`${label} gusts`}>
              <SpeedOutlinedIcon
                aria-hidden="true"
                sx={{ fontSize: 15, color: 'text.secondary' }}
              />
            </WeatherIconTooltip>
            <Typography
              variant="caption"
              aria-label={`${label} gusts ${gustMinimum} to ${gustMaximum} metres per second`}
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {gusts}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}
          >
            <WeatherIconTooltip label={`${label} precipitation`}>
              <WaterDropOutlinedIcon
                aria-hidden="true"
                sx={{ fontSize: 15, color: 'info.main' }}
              />
            </WeatherIconTooltip>
            <Typography
              variant="caption"
              color="text.secondary"
              aria-label={`${label} precipitation ${period.precipitationMm.toString()} millimetres`}
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {precipitation}
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}

function ForecastSummary({ forecast }: { readonly forecast: PointWeatherForecast }) {
  const firstDay = forecast.days[0];
  if (firstDay === undefined) {
    throw new RangeError('Forecast summary requires the current local day.');
  }
  return (
    <Paper
      variant="outlined"
      role="region"
      aria-label="Current, day, and night summary"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)',
        borderRadius: 1.25,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ display: 'grid', alignItems: 'center' }}>
        <IntervalWeatherWidget
          label="Now · 3 h"
          period={forecast.currentThreeHours}
          isDay={forecast.current.isDay}
          showLabel
        />
      </Box>
      <Box sx={{ borderLeft: 1, borderColor: 'divider' }}>
        <IntervalWeatherWidget label="Day" period={firstDay.day} isDay showLabel />
        <Divider />
        <IntervalWeatherWidget
          label="Night"
          period={firstDay.night}
          isDay={false}
          showLabel
        />
      </Box>
    </Paper>
  );
}

function HourlyCard({
  hour,
  currentTime,
}: {
  readonly hour: HourlyWeatherForecast;
  readonly currentTime: string;
}) {
  const condition = describeWmoWeatherCode(hour.weatherCode);
  const temperature = Math.round(hour.temperatureCelsius).toString();
  const precipitation = formatMillimetres(hour.precipitationMm);
  return (
    <Paper
      component="article"
      variant="outlined"
      aria-label={`${fullLocalDateTime(hour.time)}, ${condition}, ${temperature} degrees Celsius, ${precipitation} precipitation`}
      sx={{
        minWidth: 72,
        px: 1.25,
        py: 1,
        scrollSnapAlign: 'start',
        textAlign: 'center',
      }}
    >
      <Typography variant="caption" sx={{ display: 'block' }}>
        {hour.time === currentTime ? 'Now' : hour.time.slice(11, 16)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {localWeekday(hour.time.slice(0, 10))}
      </Typography>
      <Box sx={{ display: 'grid', placeItems: 'center', my: 0.5 }}>
        <WeatherConditionIcon code={hour.weatherCode} isDay={hour.isDay} size={28} />
      </Box>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {temperature}°
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {precipitation}
      </Typography>
    </Paper>
  );
}

function HourlyForecast({ forecast }: { readonly forecast: PointWeatherForecast }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollBackward, setCanScrollBackward] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);
  const hours = forecast.hourly
    .filter((hour) => hour.time >= forecast.current.time)
    .slice(0, 24);
  const updateScrollState = useCallback(() => {
    const region = scrollRef.current;
    if (region === null) return;
    setCanScrollBackward(region.scrollLeft > 0);
    setCanScrollForward(
      region.scrollLeft + region.clientWidth < region.scrollWidth - 1,
    );
  }, []);
  useEffect(() => {
    updateScrollState();
    const region = scrollRef.current;
    const ResizeObserverConstructor = (
      globalThis as unknown as {
        ResizeObserver?: typeof ResizeObserver;
      }
    ).ResizeObserver;
    if (region === null || ResizeObserverConstructor === undefined) return undefined;
    const observer = new ResizeObserverConstructor(updateScrollState);
    observer.observe(region);
    return () => {
      observer.disconnect();
    };
  }, [hours.length, updateScrollState]);
  const scroll = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 240, behavior: 'smooth' });
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography component="h2" variant="subtitle2" sx={{ flex: 1 }}>
          Next 24 hours
        </Typography>
        <IconButton
          size="small"
          aria-label="Scroll hourly forecast backward"
          disabled={!canScrollBackward}
          onClick={() => {
            scroll(-1);
          }}
        >
          <ChevronLeftOutlinedIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Scroll hourly forecast forward"
          disabled={!canScrollForward}
          onClick={() => {
            scroll(1);
          }}
        >
          <ChevronRightOutlinedIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Box
        ref={scrollRef}
        role="region"
        aria-label="Hourly forecast"
        onScroll={updateScrollState}
        sx={{
          display: 'flex',
          gap: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
          pb: 0.5,
          scrollSnapType: 'x mandatory',
        }}
      >
        {hours.map((hour) => (
          <HourlyCard key={hour.time} hour={hour} currentTime={forecast.current.time} />
        ))}
      </Box>
    </Stack>
  );
}

function DayForecastRow({ day }: { readonly day: PointWeatherForecastDay }) {
  return (
    <Box
      role="group"
      aria-label={`${localWeekday(day.date)} ${localDateLabel(day.date)}`}
      sx={{
        minHeight: 112,
        display: 'grid',
        gridTemplateColumns: '56px repeat(2, minmax(0, 1fr))',
        gap: 0.5,
        alignItems: 'center',
        py: 0.5,
      }}
    >
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {localWeekday(day.date)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {localDateLabel(day.date)}
        </Typography>
      </Box>
      <IntervalWeatherWidget label="Day" period={day.day} isDay />
      <IntervalWeatherWidget label="Night" period={day.night} isDay={false} />
    </Box>
  );
}

function SevenDayForecast({
  days,
}: {
  readonly days: readonly PointWeatherForecastDay[];
}) {
  return (
    <Stack spacing={1}>
      <Typography component="h2" variant="subtitle2">
        7-day forecast
      </Typography>
      <Box
        aria-hidden="true"
        sx={{
          display: 'grid',
          gridTemplateColumns: '56px repeat(2, minmax(0, 1fr))',
          gap: 0.5,
          px: 1,
        }}
      >
        <Box />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Day
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Night
        </Typography>
      </Box>
      <Box role="list" aria-label="Seven-day forecast">
        {days.map((day, index) => (
          <Box key={day.date} role="listitem">
            {index === 0 ? null : <Divider />}
            <DayForecastRow day={day} />
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

function ForecastFooter({
  forecast,
}: {
  readonly forecast: PointWeatherForecast | null;
}) {
  const model = forecast?.model ?? DEFAULT_WEATHER_MODEL;
  const modelName = weatherProviderConfiguration.models[model].displayName;
  let updateText = 'Update time unavailable';
  if (forecast?.modelRunAt !== null && forecast?.modelRunAt !== undefined) {
    updateText = `Updated ${new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: forecast.timezone,
    }).format(new Date(forecast.modelRunAt))}`;
  }
  return (
    <Box
      sx={{
        flexShrink: 0,
        px: 2,
        py: 1.5,
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {modelName} · {updateText}
      </Typography>
      <Link
        variant="caption"
        href={weatherProviderConfiguration.attributionUrl}
        target="_blank"
        rel="noreferrer"
      >
        Weather data by Open-Meteo
      </Link>
    </Box>
  );
}

export function WeatherPanel() {
  const { pointWeatherForecast } = useRuntimeServices();
  const request = useStore(
    mapInteractionStore,
    (state) => state.weatherForecastRequest,
  );
  const [state, setState] = useState<WeatherPanelState>({ status: 'idle' });
  const activeController = useRef<AbortController | null>(null);

  const loadForecast = useCallback(
    (coordinate: MapCoordinate) => {
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;
      setState({ status: 'loading', coordinate: { ...coordinate } });
      void pointWeatherForecast
        .execute({ coordinate, model: DEFAULT_WEATHER_MODEL }, controller.signal)
        .then((forecast) => {
          if (controller.signal.aborted || activeController.current !== controller)
            return;
          activeController.current = null;
          setState({ status: 'ready', coordinate: { ...coordinate }, forecast });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || activeController.current !== controller)
            return;
          activeController.current = null;
          const code =
            error instanceof PointWeatherForecastError
              ? error.code
              : 'provider-unavailable';
          setState({ status: 'error', coordinate: { ...coordinate }, code });
        });
    },
    [pointWeatherForecast],
  );

  useEffect(() => {
    if (request === null) return undefined;
    let shouldStart = true;
    queueMicrotask(() => {
      if (!shouldStart) return;
      consumeWeatherForecastRequest(request.id);
      loadForecast(request.coordinate);
    });
    return () => {
      shouldStart = false;
    };
  }, [loadForecast, request]);

  useEffect(
    () => () => {
      activeController.current?.abort();
    },
    [],
  );

  if (state.status === 'idle') {
    return (
      <Box
        sx={{
          height: '100%',
          px: 2,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
        }}
      >
        <Stack spacing={1.5} sx={{ alignItems: 'center', maxWidth: 280 }}>
          <WeatherIconTooltip label="Weather forecast">
            <WbCloudyOutlinedIcon
              aria-hidden="true"
              sx={{ fontSize: 48, color: 'text.secondary' }}
            />
          </WeatherIconTooltip>
          <Typography variant="subtitle1">Select a forecast point</Typography>
          <Typography variant="body2" color="text.secondary">
            Click a point on the map to load its ECMWF IFS forecast.
          </Typography>
        </Stack>
      </Box>
    );
  }

  const readyForecast = state.status === 'ready' ? state.forecast : null;
  return (
    <Box
      sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <Box
        sx={{
          minHeight: 0,
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          px: 2,
          py: 2,
        }}
      >
        {state.status === 'loading' ? (
          <LoadingForecast coordinate={state.coordinate} />
        ) : state.status === 'error' ? (
          <Stack spacing={2}>
            <SelectedPoint coordinate={state.coordinate} />
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.25 }}>
              <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                <Typography variant="body2">{errorMessage(state.code)}</Typography>
                <Button
                  variant="outlined"
                  onClick={() => {
                    loadForecast(state.coordinate);
                  }}
                >
                  Retry
                </Button>
              </Stack>
            </Paper>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <SelectedPoint coordinate={state.coordinate} forecast={state.forecast} />
            <ForecastSummary forecast={state.forecast} />
            <HourlyForecast forecast={state.forecast} />
            <SevenDayForecast days={state.forecast.days} />
          </Stack>
        )}
      </Box>
      <ForecastFooter forecast={readyForecast} />
    </Box>
  );
}
