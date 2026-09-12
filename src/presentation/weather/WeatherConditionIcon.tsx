import AirOutlinedIcon from '@mui/icons-material/AirOutlined';
import FoggyIcon from '@mui/icons-material/Foggy';
import { Box, ClickAwayListener, Tooltip } from '@mui/material';
import { useRef, useState, type ReactElement } from 'react';

import clearDay from '@meteocons/svg-static/flat/clear-day.svg?no-inline';
import clearNight from '@meteocons/svg-static/flat/clear-night.svg?no-inline';
import cloudy from '@meteocons/svg-static/flat/cloudy.svg?no-inline';
import extremeDayRain from '@meteocons/svg-static/flat/extreme-day-rain.svg?no-inline';
import extremeDaySleet from '@meteocons/svg-static/flat/extreme-day-sleet.svg?no-inline';
import extremeDaySnow from '@meteocons/svg-static/flat/extreme-day-snow.svg?no-inline';
import extremeNightRain from '@meteocons/svg-static/flat/extreme-night-rain.svg?no-inline';
import extremeNightSleet from '@meteocons/svg-static/flat/extreme-night-sleet.svg?no-inline';
import extremeNightSnow from '@meteocons/svg-static/flat/extreme-night-snow.svg?no-inline';
import extremeThunderstormsDayHail from '@meteocons/svg-static/flat/extreme-thunderstorms-day-hail.svg?no-inline';
import extremeThunderstormsNightHail from '@meteocons/svg-static/flat/extreme-thunderstorms-night-hail.svg?no-inline';
import fogDay from '@meteocons/svg-static/flat/fog-day.svg?no-inline';
import fogNight from '@meteocons/svg-static/flat/fog-night.svg?no-inline';
import mostlyClearDay from '@meteocons/svg-static/flat/mostly-clear-day.svg?no-inline';
import mostlyClearDayRain from '@meteocons/svg-static/flat/mostly-clear-day-rain.svg?no-inline';
import mostlyClearDaySleet from '@meteocons/svg-static/flat/mostly-clear-day-sleet.svg?no-inline';
import mostlyClearDaySnow from '@meteocons/svg-static/flat/mostly-clear-day-snow.svg?no-inline';
import mostlyClearNight from '@meteocons/svg-static/flat/mostly-clear-night.svg?no-inline';
import mostlyClearNightRain from '@meteocons/svg-static/flat/mostly-clear-night-rain.svg?no-inline';
import mostlyClearNightSleet from '@meteocons/svg-static/flat/mostly-clear-night-sleet.svg?no-inline';
import mostlyClearNightSnow from '@meteocons/svg-static/flat/mostly-clear-night-snow.svg?no-inline';
import notAvailable from '@meteocons/svg-static/flat/not-available.svg?no-inline';
import overcastDay from '@meteocons/svg-static/flat/overcast-day.svg?no-inline';
import overcastDayDrizzle from '@meteocons/svg-static/flat/overcast-day-drizzle.svg?no-inline';
import overcastDayRain from '@meteocons/svg-static/flat/overcast-day-rain.svg?no-inline';
import overcastDaySleet from '@meteocons/svg-static/flat/overcast-day-sleet.svg?no-inline';
import overcastDaySnow from '@meteocons/svg-static/flat/overcast-day-snow.svg?no-inline';
import overcastNight from '@meteocons/svg-static/flat/overcast-night.svg?no-inline';
import overcastNightDrizzle from '@meteocons/svg-static/flat/overcast-night-drizzle.svg?no-inline';
import overcastNightRain from '@meteocons/svg-static/flat/overcast-night-rain.svg?no-inline';
import overcastNightSleet from '@meteocons/svg-static/flat/overcast-night-sleet.svg?no-inline';
import overcastNightSnow from '@meteocons/svg-static/flat/overcast-night-snow.svg?no-inline';
import partlyCloudyDay from '@meteocons/svg-static/flat/partly-cloudy-day.svg?no-inline';
import partlyCloudyDayRain from '@meteocons/svg-static/flat/partly-cloudy-day-rain.svg?no-inline';
import partlyCloudyDaySleet from '@meteocons/svg-static/flat/partly-cloudy-day-sleet.svg?no-inline';
import partlyCloudyDaySnow from '@meteocons/svg-static/flat/partly-cloudy-day-snow.svg?no-inline';
import partlyCloudyNight from '@meteocons/svg-static/flat/partly-cloudy-night.svg?no-inline';
import partlyCloudyNightRain from '@meteocons/svg-static/flat/partly-cloudy-night-rain.svg?no-inline';
import partlyCloudyNightSleet from '@meteocons/svg-static/flat/partly-cloudy-night-sleet.svg?no-inline';
import partlyCloudyNightSnow from '@meteocons/svg-static/flat/partly-cloudy-night-snow.svg?no-inline';
import thunderstormsDay from '@meteocons/svg-static/flat/thunderstorms-day.svg?no-inline';
import thunderstormsDayHail from '@meteocons/svg-static/flat/thunderstorms-day-hail.svg?no-inline';
import thunderstormsNight from '@meteocons/svg-static/flat/thunderstorms-night.svg?no-inline';
import thunderstormsNightHail from '@meteocons/svg-static/flat/thunderstorms-night-hail.svg?no-inline';

import type {
  VisibilityStatus,
  WeatherIcon,
} from '@/domain/weather/aggregateWeatherPeriodStatus';
import { describeWmoWeatherCode } from '@/presentation/weather/weatherConditionLabels';

interface WeatherConditionIconProps {
  readonly code: number;
  readonly isDay: boolean;
  readonly size?: number;
}

interface WeatherIconTooltipProps {
  readonly children: ReactElement;
  readonly label: string;
}

export function WeatherIconTooltip({ children, label }: WeatherIconTooltipProps) {
  const [open, setOpen] = useState(false);
  const touchPointer = useRef(false);

  return (
    <ClickAwayListener
      onClickAway={() => {
        setOpen(false);
      }}
    >
      <Tooltip
        title={label}
        arrow
        open={open}
        onOpen={() => {
          setOpen(true);
        }}
        onClose={() => {
          setOpen(false);
        }}
        disableFocusListener
        disableTouchListener
      >
        <Box
          component="span"
          aria-label={label}
          tabIndex={0}
          onFocus={() => {
            if (!touchPointer.current) setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onPointerDown={(event) => {
            touchPointer.current = event.pointerType === 'touch';
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== 'touch') return;
            setOpen((isOpen) => !isOpen);
            queueMicrotask(() => {
              touchPointer.current = false;
            });
          }}
          onPointerCancel={() => {
            touchPointer.current = false;
            setOpen(false);
          }}
          sx={{
            display: 'inline-grid',
            placeItems: 'center',
            flexShrink: 0,
            lineHeight: 0,
            cursor: 'help',
            outlineOffset: 2,
          }}
        >
          {children}
        </Box>
      </Tooltip>
    </ClickAwayListener>
  );
}

// Weather-condition artwork must be one flat static Meteocon selected here. Do not compose it from MUI icons or icons from any other library; wind, gust, precipitation, and visibility remain separate UI indicators.
const flatMeteoconSources = {
  'clear-day': clearDay,
  'clear-night': clearNight,
  cloudy,
  'extreme-day-rain': extremeDayRain,
  'extreme-day-sleet': extremeDaySleet,
  'extreme-day-snow': extremeDaySnow,
  'extreme-night-rain': extremeNightRain,
  'extreme-night-snow': extremeNightSnow,
  'extreme-night-sleet': extremeNightSleet,
  'extreme-thunderstorms-day-hail': extremeThunderstormsDayHail,
  'extreme-thunderstorms-night-hail': extremeThunderstormsNightHail,
  'fog-day': fogDay,
  'fog-night': fogNight,
  'mostly-clear-day': mostlyClearDay,
  'mostly-clear-day-rain': mostlyClearDayRain,
  'mostly-clear-day-sleet': mostlyClearDaySleet,
  'mostly-clear-day-snow': mostlyClearDaySnow,
  'mostly-clear-night': mostlyClearNight,
  'mostly-clear-night-rain': mostlyClearNightRain,
  'mostly-clear-night-sleet': mostlyClearNightSleet,
  'mostly-clear-night-snow': mostlyClearNightSnow,
  'not-available': notAvailable,
  'overcast-day': overcastDay,
  'overcast-day-drizzle': overcastDayDrizzle,
  'overcast-day-rain': overcastDayRain,
  'overcast-day-sleet': overcastDaySleet,
  'overcast-day-snow': overcastDaySnow,
  'overcast-night': overcastNight,
  'overcast-night-drizzle': overcastNightDrizzle,
  'overcast-night-rain': overcastNightRain,
  'overcast-night-sleet': overcastNightSleet,
  'overcast-night-snow': overcastNightSnow,
  'partly-cloudy-day': partlyCloudyDay,
  'partly-cloudy-day-rain': partlyCloudyDayRain,
  'partly-cloudy-day-sleet': partlyCloudyDaySleet,
  'partly-cloudy-day-snow': partlyCloudyDaySnow,
  'partly-cloudy-night': partlyCloudyNight,
  'partly-cloudy-night-rain': partlyCloudyNightRain,
  'partly-cloudy-night-sleet': partlyCloudyNightSleet,
  'partly-cloudy-night-snow': partlyCloudyNightSnow,
  'thunderstorms-day': thunderstormsDay,
  'thunderstorms-day-hail': thunderstormsDayHail,
  'thunderstorms-night': thunderstormsNight,
  'thunderstorms-night-hail': thunderstormsNightHail,
} as const satisfies Readonly<Record<string, string>>;

type FlatMeteoconName = keyof typeof flatMeteoconSources;
type DayNight = 'day' | 'night';
type PrecipitationSuffix = 'rain' | 'sleet' | 'snow';
type PrecipitationPrefix =
  `mostly-clear-${DayNight}` | `overcast-${DayNight}` | `partly-cloudy-${DayNight}`;

function iconForWmoCode(code: number, isDay: boolean): FlatMeteoconName {
  const dayNight = isDay ? 'day' : 'night';
  switch (code) {
    case 0:
      return `clear-${dayNight}`;
    case 1:
      return `mostly-clear-${dayNight}`;
    case 2:
      return `partly-cloudy-${dayNight}`;
    case 3:
      return `overcast-${dayNight}`;
    case 45:
    case 48:
      return `fog-${dayNight}`;
    case 51:
    case 53:
    case 55:
      return `overcast-${dayNight}-drizzle`;
    case 56:
    case 57:
    case 66:
      return `overcast-${dayNight}-sleet`;
    case 61:
    case 63:
      return `overcast-${dayNight}-rain`;
    case 65:
    case 82:
      return `extreme-${dayNight}-rain`;
    case 67:
      return `extreme-${dayNight}-sleet`;
    case 71:
    case 73:
    case 77:
      return `overcast-${dayNight}-snow`;
    case 75:
      return `extreme-${dayNight}-snow`;
    case 80:
    case 81:
      return `partly-cloudy-${dayNight}-rain`;
    case 85:
      return `partly-cloudy-${dayNight}-snow`;
    case 86:
      return `extreme-${dayNight}-snow`;
    case 95:
      return `thunderstorms-${dayNight}`;
    case 96:
      return `thunderstorms-${dayNight}-hail`;
    case 99:
      return `extreme-thunderstorms-${dayNight}-hail`;
    default:
      return 'not-available';
  }
}

function iconForPeriod(icon: WeatherIcon, isDay: boolean): FlatMeteoconName {
  const dayNight = isDay ? 'day' : 'night';
  if (icon.phenomenon === null) {
    switch (icon.sky) {
      case 'clear':
        return `clear-${dayNight}`;
      case 'mostly_clear':
        return `mostly-clear-${dayNight}`;
      case 'partly_cloudy':
        return `partly-cloudy-${dayNight}`;
      case 'mostly_cloudy':
        return 'cloudy';
      case 'overcast':
        return `overcast-${dayNight}`;
    }
  }
  if (icon.phenomenon === 'heavy_rain') return `extreme-${dayNight}-rain`;

  const suffix: PrecipitationSuffix =
    icon.phenomenon === 'isolated_showers' ||
    icon.phenomenon === 'showers' ||
    icon.phenomenon === 'occasional_rain' ||
    icon.phenomenon === 'rain'
      ? 'rain'
      : icon.phenomenon === 'snow_showers' ||
          icon.phenomenon === 'occasional_snow' ||
          icon.phenomenon === 'snow'
        ? 'snow'
        : 'sleet';
  const prefix: PrecipitationPrefix =
    icon.sky === 'clear' || icon.sky === 'mostly_clear'
      ? `mostly-clear-${dayNight}`
      : icon.sky === 'partly_cloudy'
        ? `partly-cloudy-${dayNight}`
        : `overcast-${dayNight}`;
  return `${prefix}-${suffix}`;
}

function StaticMeteocon({
  name,
  size,
}: {
  readonly name: FlatMeteoconName;
  readonly size: number;
}) {
  return (
    <Box
      component="img"
      src={flatMeteoconSources[name]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      sx={{ display: 'block', flexShrink: 0 }}
    />
  );
}

export function WeatherConditionIcon({
  code,
  isDay,
  size = 28,
}: WeatherConditionIconProps) {
  return (
    <WeatherIconTooltip label={describeWmoWeatherCode(code)}>
      <StaticMeteocon name={iconForWmoCode(code, isDay)} size={size} />
    </WeatherIconTooltip>
  );
}

export function WeatherPeriodIcon({
  icon,
  isDay,
  label,
  size = 36,
}: {
  readonly icon: WeatherIcon;
  readonly isDay: boolean;
  readonly label: string;
  readonly size?: number;
}) {
  return (
    <WeatherIconTooltip label={label}>
      <StaticMeteocon name={iconForPeriod(icon, isDay)} size={size} />
    </WeatherIconTooltip>
  );
}

export function VisibilityStatusIcon({
  status,
}: {
  readonly status: VisibilityStatus;
}) {
  if (status.icon === null || status.label === null) return null;

  return (
    <WeatherIconTooltip label={status.label}>
      <Box
        aria-hidden="true"
        sx={{ display: 'inline-grid', placeItems: 'center', width: 16, height: 16 }}
      >
        {status.icon === 'fog' ? (
          <FoggyIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        ) : (
          <AirOutlinedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
        )}
      </Box>
    </WeatherIconTooltip>
  );
}
