import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlinedIcon from '@mui/icons-material/ChevronRightOutlined';
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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import {
  DEFAULT_WEATHER_MODEL,
  type PointWeatherForecast,
  type PointWeatherForecastDay,
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
  DailyWeatherIcon,
  WeatherConditionIcon,
  describeWmoWeatherCode,
} from '@/presentation/weather/WeatherConditionIcon';

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
const compassDirections = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
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
  return weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] as string;
}

function localDateLabel(date: string): string {
  const { month, day } = parseLocalDate(date);
  return `${day} ${months[month - 1] as string}`;
}

function fullLocalDateTime(timestamp: string): string {
  return `${localWeekday(timestamp.slice(0, 10))} ${localDateLabel(timestamp.slice(0, 10))} ${timestamp.slice(0, 4)}, ${timestamp.slice(11, 16)}`;
}

function formatMillimetres(value: number): string {
  if (value === 0) return '0 mm';
  return value < 10 ? `${value.toFixed(1)} mm` : `${Math.round(value)} mm`;
}

function formatVisibility(value: number): string {
  return value < 1_000 ? `${Math.round(value)} m` : `${(value / 1_000).toFixed(1)} km`;
}

function compassDirection(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  return compassDirections[Math.round(normalized / 22.5) % 16] as string;
}

function formatRange(minimum: number, maximum: number, unit: string): string {
  const low = Math.round(minimum);
  const high = Math.round(maximum);
  return low === high ? `${low} ${unit}` : `${low}…${high} ${unit}`;
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
    <Stack spacing={0.25}>
      <Typography variant="overline" color="text.secondary">
        Selected point
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)}
      </Typography>
      {forecast === undefined ? null : (
        <>
          <Typography variant="caption" color="text.secondary">
            Forecast elevation{' '}
            {Math.round(forecast.elevationMeters).toLocaleString('en-US')} m ·{' '}
            {forecast.elevationSource === 'trail-planner-dem'
              ? 'Trail Planner terrain'
              : 'Open-Meteo terrain'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            All times: {forecast.timezone}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click another map point to update.
          </Typography>
        </>
      )}
    </Stack>
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

function CurrentForecast({ forecast }: { readonly forecast: PointWeatherForecast }) {
  const nextThreeHours = forecast.hourly
    .filter((hour) => hour.time > forecast.current.time)
    .slice(0, 3)
    .reduce((total, hour) => total + hour.precipitationMm, 0);
  const current = forecast.current;
  const metrics: readonly [string, ReactNode][] = [
    ['Feels like', `${Math.round(current.apparentTemperatureCelsius)} °C`],
    [
      'Wind',
      `${Math.round(current.windSpeedKmh)} km/h ${compassDirection(current.windDirectionDegrees)}`,
    ],
    ['Gusts', `${Math.round(current.windGustsKmh)} km/h`],
    ['Cloud', `${Math.round(current.cloudCoverPercent)}%`],
    ['Visibility', formatVisibility(current.visibilityMeters)],
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.25 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography
          aria-label={`${Math.round(current.temperatureCelsius)} degrees Celsius`}
          sx={{
            fontSize: 40,
            fontWeight: 750,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {Math.round(current.temperatureCelsius)}°
        </Typography>
        <WeatherConditionIcon
          code={current.weatherCode}
          isDay={current.isDay}
          size={56}
        />
        <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {describeWmoWeatherCode(current.weatherCode)}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <WaterDropOutlinedIcon
              aria-hidden="true"
              sx={{ fontSize: 16, color: 'info.main' }}
            />
            <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              Next 3 hours {formatMillimetres(nextThreeHours)}
            </Typography>
          </Stack>
        </Stack>
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          columnGap: 2,
          rowGap: 1,
        }}
      >
        {metrics.map(([label, value]) => (
          <Box key={label}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              {label}
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {value}
            </Typography>
          </Box>
        ))}
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
  const temperature = Math.round(hour.temperatureCelsius);
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
    if (region === null || globalThis.ResizeObserver === undefined) return undefined;
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(region);
    return () => observer.disconnect();
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
          onClick={() => scroll(-1)}
        >
          <ChevronLeftOutlinedIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Scroll hourly forecast forward"
          disabled={!canScrollForward}
          onClick={() => scroll(1)}
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
  const temperature = formatRange(
    day.daylightTemperatureMinCelsius,
    day.daylightTemperatureMaxCelsius,
    '°C',
  );
  const wind = formatRange(
    day.daylightWindSpeedMinKmh,
    day.daylightWindSpeedMaxKmh,
    'km/h',
  );
  const roundedTemperatureMin = Math.round(day.daylightTemperatureMinCelsius);
  const roundedTemperatureMax = Math.round(day.daylightTemperatureMaxCelsius);
  const roundedWindMin = Math.round(day.daylightWindSpeedMinKmh);
  const roundedWindMax = Math.round(day.daylightWindSpeedMaxKmh);
  const precipitation = formatMillimetres(day.daylightPrecipitationMm);

  return (
    <Box
      component="article"
      sx={{
        minHeight: 72,
        display: 'grid',
        gridTemplateColumns: '64px 36px minmax(0, 1fr) 96px',
        gap: 1,
        alignItems: 'center',
        py: 1,
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
      <DailyWeatherIcon icon={day.status.icon} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2">{day.status.label}</Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          aria-label={`Daytime temperature ${roundedTemperatureMin} to ${roundedTemperatureMax} degrees Celsius`}
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {temperature}
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right', minWidth: 96 }}>
        <Typography
          variant="caption"
          aria-label={`Daytime wind ${roundedWindMin} to ${roundedWindMax} kilometres per hour`}
          sx={{
            display: 'block',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          Wind {wind}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          aria-label={`Daylight precipitation ${day.daylightPrecipitationMm} millimetres`}
          sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {precipitation}
        </Typography>
      </Box>
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
    if (request === null) return;
    consumeWeatherForecastRequest(request.id);
    loadForecast(request.coordinate);
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
          <WbCloudyOutlinedIcon
            aria-hidden="true"
            sx={{ fontSize: 48, color: 'text.secondary' }}
          />
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
                  onClick={() => loadForecast(state.coordinate)}
                >
                  Retry
                </Button>
              </Stack>
            </Paper>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <SelectedPoint coordinate={state.coordinate} forecast={state.forecast} />
            <CurrentForecast forecast={state.forecast} />
            <HourlyForecast forecast={state.forecast} />
            <SevenDayForecast days={state.forecast.days} />
          </Stack>
        )}
      </Box>
      <ForecastFooter forecast={readyForecast} />
    </Box>
  );
}
