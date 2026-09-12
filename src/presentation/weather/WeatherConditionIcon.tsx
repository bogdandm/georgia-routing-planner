import { Box, ClickAwayListener, Tooltip } from '@mui/material';
import { useRef, useState, type ReactElement } from 'react';

import clearDay from '@meteocons/svg-static/monochrome/clear-day.svg?no-inline';
import clearNight from '@meteocons/svg-static/monochrome/clear-night.svg?no-inline';
import cloudy from '@meteocons/svg-static/monochrome/cloudy.svg?no-inline';
import extremeDayRain from '@meteocons/svg-static/monochrome/extreme-day-rain.svg?no-inline';
import extremeDaySleet from '@meteocons/svg-static/monochrome/extreme-day-sleet.svg?no-inline';
import extremeDaySnow from '@meteocons/svg-static/monochrome/extreme-day-snow.svg?no-inline';
import extremeNightRain from '@meteocons/svg-static/monochrome/extreme-night-rain.svg?no-inline';
import extremeNightSleet from '@meteocons/svg-static/monochrome/extreme-night-sleet.svg?no-inline';
import extremeNightSnow from '@meteocons/svg-static/monochrome/extreme-night-snow.svg?no-inline';
import extremeThunderstormsDayHail from '@meteocons/svg-static/monochrome/extreme-thunderstorms-day-hail.svg?no-inline';
import extremeThunderstormsNightHail from '@meteocons/svg-static/monochrome/extreme-thunderstorms-night-hail.svg?no-inline';
import fogDay from '@meteocons/svg-static/monochrome/fog-day.svg?no-inline';
import fogNight from '@meteocons/svg-static/monochrome/fog-night.svg?no-inline';
import mist from '@meteocons/svg-static/monochrome/mist.svg?no-inline';
import mostlyClearDay from '@meteocons/svg-static/monochrome/mostly-clear-day.svg?no-inline';
import mostlyClearDayFog from '@meteocons/svg-static/monochrome/mostly-clear-day-fog.svg?no-inline';
import mostlyClearDayHaze from '@meteocons/svg-static/monochrome/mostly-clear-day-haze.svg?no-inline';
import mostlyClearDayRain from '@meteocons/svg-static/monochrome/mostly-clear-day-rain.svg?no-inline';
import mostlyClearDaySleet from '@meteocons/svg-static/monochrome/mostly-clear-day-sleet.svg?no-inline';
import mostlyClearDaySnow from '@meteocons/svg-static/monochrome/mostly-clear-day-snow.svg?no-inline';
import mostlyClearNight from '@meteocons/svg-static/monochrome/mostly-clear-night.svg?no-inline';
import mostlyClearNightFog from '@meteocons/svg-static/monochrome/mostly-clear-night-fog.svg?no-inline';
import mostlyClearNightHaze from '@meteocons/svg-static/monochrome/mostly-clear-night-haze.svg?no-inline';
import mostlyClearNightRain from '@meteocons/svg-static/monochrome/mostly-clear-night-rain.svg?no-inline';
import mostlyClearNightSleet from '@meteocons/svg-static/monochrome/mostly-clear-night-sleet.svg?no-inline';
import mostlyClearNightSnow from '@meteocons/svg-static/monochrome/mostly-clear-night-snow.svg?no-inline';
import notAvailable from '@meteocons/svg-static/monochrome/not-available.svg?no-inline';
import overcastDay from '@meteocons/svg-static/monochrome/overcast-day.svg?no-inline';
import overcastDayFog from '@meteocons/svg-static/monochrome/overcast-day-fog.svg?no-inline';
import overcastDayHaze from '@meteocons/svg-static/monochrome/overcast-day-haze.svg?no-inline';
import overcastDayDrizzle from '@meteocons/svg-static/monochrome/overcast-day-drizzle.svg?no-inline';
import overcastDayRain from '@meteocons/svg-static/monochrome/overcast-day-rain.svg?no-inline';
import overcastDaySleet from '@meteocons/svg-static/monochrome/overcast-day-sleet.svg?no-inline';
import overcastDaySnow from '@meteocons/svg-static/monochrome/overcast-day-snow.svg?no-inline';
import overcastNight from '@meteocons/svg-static/monochrome/overcast-night.svg?no-inline';
import overcastNightFog from '@meteocons/svg-static/monochrome/overcast-night-fog.svg?no-inline';
import overcastNightHaze from '@meteocons/svg-static/monochrome/overcast-night-haze.svg?no-inline';
import overcastNightDrizzle from '@meteocons/svg-static/monochrome/overcast-night-drizzle.svg?no-inline';
import overcastNightRain from '@meteocons/svg-static/monochrome/overcast-night-rain.svg?no-inline';
import overcastNightSleet from '@meteocons/svg-static/monochrome/overcast-night-sleet.svg?no-inline';
import overcastNightSnow from '@meteocons/svg-static/monochrome/overcast-night-snow.svg?no-inline';
import partlyCloudyDay from '@meteocons/svg-static/monochrome/partly-cloudy-day.svg?no-inline';
import partlyCloudyDayFog from '@meteocons/svg-static/monochrome/partly-cloudy-day-fog.svg?no-inline';
import partlyCloudyDayHaze from '@meteocons/svg-static/monochrome/partly-cloudy-day-haze.svg?no-inline';
import partlyCloudyDayRain from '@meteocons/svg-static/monochrome/partly-cloudy-day-rain.svg?no-inline';
import partlyCloudyDaySleet from '@meteocons/svg-static/monochrome/partly-cloudy-day-sleet.svg?no-inline';
import partlyCloudyDaySnow from '@meteocons/svg-static/monochrome/partly-cloudy-day-snow.svg?no-inline';
import partlyCloudyNight from '@meteocons/svg-static/monochrome/partly-cloudy-night.svg?no-inline';
import partlyCloudyNightFog from '@meteocons/svg-static/monochrome/partly-cloudy-night-fog.svg?no-inline';
import partlyCloudyNightHaze from '@meteocons/svg-static/monochrome/partly-cloudy-night-haze.svg?no-inline';
import partlyCloudyNightRain from '@meteocons/svg-static/monochrome/partly-cloudy-night-rain.svg?no-inline';
import partlyCloudyNightSleet from '@meteocons/svg-static/monochrome/partly-cloudy-night-sleet.svg?no-inline';
import partlyCloudyNightSnow from '@meteocons/svg-static/monochrome/partly-cloudy-night-snow.svg?no-inline';
import thunderstormsDay from '@meteocons/svg-static/monochrome/thunderstorms-day.svg?no-inline';
import thunderstormsDayHail from '@meteocons/svg-static/monochrome/thunderstorms-day-hail.svg?no-inline';
import thunderstormsNight from '@meteocons/svg-static/monochrome/thunderstorms-night.svg?no-inline';
import thunderstormsNightHail from '@meteocons/svg-static/monochrome/thunderstorms-night-hail.svg?no-inline';

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

// Weather-condition artwork must be one monochrome static Meteocon selected here. Do not compose it from MUI icons or icons from any other library; wind, gust, and precipitation remain separate UI indicators, while significant visibility selects one complete Meteocon instead of an overlaid badge.
const meteoconSources = {
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
  mist,
  'mostly-clear-day': mostlyClearDay,
  'mostly-clear-day-fog': mostlyClearDayFog,
  'mostly-clear-day-haze': mostlyClearDayHaze,
  'mostly-clear-day-rain': mostlyClearDayRain,
  'mostly-clear-day-sleet': mostlyClearDaySleet,
  'mostly-clear-day-snow': mostlyClearDaySnow,
  'mostly-clear-night': mostlyClearNight,
  'mostly-clear-night-fog': mostlyClearNightFog,
  'mostly-clear-night-haze': mostlyClearNightHaze,
  'mostly-clear-night-rain': mostlyClearNightRain,
  'mostly-clear-night-sleet': mostlyClearNightSleet,
  'mostly-clear-night-snow': mostlyClearNightSnow,
  'not-available': notAvailable,
  'overcast-day': overcastDay,
  'overcast-day-fog': overcastDayFog,
  'overcast-day-haze': overcastDayHaze,
  'overcast-day-drizzle': overcastDayDrizzle,
  'overcast-day-rain': overcastDayRain,
  'overcast-day-sleet': overcastDaySleet,
  'overcast-day-snow': overcastDaySnow,
  'overcast-night': overcastNight,
  'overcast-night-fog': overcastNightFog,
  'overcast-night-haze': overcastNightHaze,
  'overcast-night-drizzle': overcastNightDrizzle,
  'overcast-night-rain': overcastNightRain,
  'overcast-night-sleet': overcastNightSleet,
  'overcast-night-snow': overcastNightSnow,
  'partly-cloudy-day': partlyCloudyDay,
  'partly-cloudy-day-fog': partlyCloudyDayFog,
  'partly-cloudy-day-haze': partlyCloudyDayHaze,
  'partly-cloudy-day-rain': partlyCloudyDayRain,
  'partly-cloudy-day-sleet': partlyCloudyDaySleet,
  'partly-cloudy-day-snow': partlyCloudyDaySnow,
  'partly-cloudy-night': partlyCloudyNight,
  'partly-cloudy-night-fog': partlyCloudyNightFog,
  'partly-cloudy-night-haze': partlyCloudyNightHaze,
  'partly-cloudy-night-rain': partlyCloudyNightRain,
  'partly-cloudy-night-sleet': partlyCloudyNightSleet,
  'partly-cloudy-night-snow': partlyCloudyNightSnow,
  'thunderstorms-day': thunderstormsDay,
  'thunderstorms-day-hail': thunderstormsDayHail,
  'thunderstorms-night': thunderstormsNight,
  'thunderstorms-night-hail': thunderstormsNightHail,
} as const satisfies Readonly<Record<string, string>>;

type MeteoconName = keyof typeof meteoconSources;
type DayNight = 'day' | 'night';
type PrecipitationSuffix = 'rain' | 'sleet' | 'snow';
type ConditionPrefix =
  `mostly-clear-${DayNight}` | `overcast-${DayNight}` | `partly-cloudy-${DayNight}`;

function iconForWmoCode(code: number, isDay: boolean): MeteoconName {
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

function periodConditionPrefix(icon: WeatherIcon, dayNight: DayNight): ConditionPrefix {
  if (icon.sky === 'clear' || icon.sky === 'mostly_clear') {
    return `mostly-clear-${dayNight}`;
  }
  if (icon.sky === 'partly_cloudy') return `partly-cloudy-${dayNight}`;
  return `overcast-${dayNight}`;
}

function iconForPeriod(
  icon: WeatherIcon,
  visibility: VisibilityStatus,
  isDay: boolean,
): MeteoconName {
  const dayNight = isDay ? 'day' : 'night';
  if (icon.phenomenon === null) {
    if (visibility.icon === 'poor') return 'mist';
    if (visibility.icon === 'fog' || visibility.icon === 'haze') {
      return `${periodConditionPrefix(icon, dayNight)}-${visibility.icon}`;
    }
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
  return `${periodConditionPrefix(icon, dayNight)}-${suffix}`;
}

function StaticMeteocon({
  name,
  size,
}: {
  readonly name: MeteoconName;
  readonly size: number;
}) {
  return (
    <Box
      component="img"
      src={meteoconSources[name]}
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
  visibility,
  isDay,
  label,
  size = 36,
}: {
  readonly icon: WeatherIcon;
  readonly visibility: VisibilityStatus;
  readonly isDay: boolean;
  readonly label: string;
  readonly size?: number;
}) {
  return (
    <WeatherIconTooltip label={label}>
      <StaticMeteocon name={iconForPeriod(icon, visibility, isDay)} size={size} />
    </WeatherIconTooltip>
  );
}
