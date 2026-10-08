import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import AirOutlinedIcon from '@mui/icons-material/AirOutlined';

import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import WbCloudyOutlinedIcon from '@mui/icons-material/WbCloudyOutlined';
import {
  Box,
  Button,
  ButtonBase,
  Divider,
  Link,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';

import {
  DEFAULT_WEATHER_MODEL,
  type PointWeatherForecast,
  type PointWeatherForecastDay,
  type PointWeatherForecastPeriod,
} from '@/application/weather/GetPointWeatherForecast';
import {
  PointWeatherForecastError,
  type PointWeatherForecastErrorCode,
} from '@/application/ports/WeatherForecastGateway';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { weatherProviderConfiguration } from '@/bootstrap/configuration/WeatherProviderConfiguration';
import {
  consumeWeatherForecastRequest,
  mapInteractionStore,
  setWeatherMapForecastMarker,
} from '@/presentation/map/mapInteractionStore';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import type { MapCoordinate } from '@/presentation/map/mapTypes';
import { appColors } from '@/presentation/theme/appColors';
import {
  WeatherPeriodIcon,
  WeatherIconTooltip,
} from '@/presentation/weather/WeatherConditionIcon';
import {
  FloatingHourlyForecastPanel,
  HourlyForecastTable,
} from '@/presentation/weather/HourlyForecastTable';
import {
  describeWeatherPeriodCondition,
  describeWeatherVisibility,
} from '@/presentation/weather/weatherConditionLabels';
import {
  formatWeatherMillimetres,
  formatWeatherTemperatureRange,
  formatWeatherWindMetresPerSecond,
} from '@/presentation/weather/weatherFormatters';

interface ForecastDateLabels {
  readonly weekday: Intl.DateTimeFormat;
  readonly dayMonth: Intl.DateTimeFormat;
  readonly weekdayDayMonth: Intl.DateTimeFormat;
  readonly longWeekdayDayMonth: Intl.DateTimeFormat;
}

/* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
/** Display labels for local forecast dates in `locale`; dates are formatted in UTC. */
function createForecastDateLabels(locale: string): ForecastDateLabels {
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
    dayMonth: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
    weekdayDayMonth: new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
    longWeekdayDayMonth: new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
  };
}
/* eslint-enable lingui/no-unlocalized-strings */

export interface WeatherHeaderPoint {
  readonly coordinate: MapCoordinate;
  readonly elevationMeters?: number;
  readonly placeLabel?: string;
}

type WeatherPanelState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading';
      readonly coordinate: MapCoordinate;
      readonly elevationMeters: number | undefined;
    }
  | {
      readonly status: 'ready';
      readonly coordinate: MapCoordinate;
      readonly elevationMeters: number | undefined;
      readonly forecast: PointWeatherForecast;
    }
  | {
      readonly status: 'error';
      readonly coordinate: MapCoordinate;
      readonly elevationMeters: number | undefined;
      readonly code: PointWeatherForecastErrorCode;
    };

interface WeatherPanelProps {
  readonly onSelectedPointChange: (point: WeatherHeaderPoint | null) => void;
  readonly sidebarCollapsed: boolean;
}

interface FloatingHourlyForecastRequest {
  readonly anchorElement: HTMLElement;
  readonly startTime: string;
  readonly title: string;
  readonly triggerElement: HTMLElement;
}

type OpenDailyHourlyForecast = (
  day: PointWeatherForecastDay,
  isDay: boolean,
  triggerElement: HTMLElement,
) => void;

function floatingForecastRequest(
  forecast: PointWeatherForecast,
  day: PointWeatherForecastDay,
  isDay: boolean,
  title: string,
  triggerElement: HTMLElement,
): FloatingHourlyForecastRequest {
  let periodStartIndex = forecast.hourly.findIndex(
    (hour) => hour.time === `${day.date}T00:00`,
  );
  if (!isDay) {
    let foundDaylight = false;
    periodStartIndex = -1;
    for (const [index, hour] of forecast.hourly.entries()) {
      if (hour.time.slice(0, 10) !== day.date) continue;
      if (hour.isDay) {
        foundDaylight = true;
        continue;
      }
      if (foundDaylight) {
        periodStartIndex = index - 6;
        break;
      }
    }
  }
  if (periodStartIndex < 0) {
    throw new RangeError(`Forecast period ${day.date} has no hourly boundary.`);
  }
  const startHour = forecast.hourly[periodStartIndex];
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM selector.
  const anchorElement = triggerElement.closest('[data-weather-day-card]');
  if (startHour === undefined || !(anchorElement instanceof HTMLElement)) {
    throw new RangeError(`Forecast period ${day.date} has no hourly context.`);
  }
  return {
    anchorElement,
    startTime: startHour.time,
    title,
    triggerElement,
  };
}

function forecastDate(date: string): Date {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- ISO time suffix.
  return new Date(`${date}T00:00:00.000Z`);
}

function formatWindRange(
  minimumKilometresPerHour: number,
  maximumKilometresPerHour: number,
  i18n: I18n,
): string {
  const minimum = formatWeatherWindMetresPerSecond(
    minimumKilometresPerHour / 3.6,
    i18n,
  );
  const maximum = formatWeatherWindMetresPerSecond(
    maximumKilometresPerHour / 3.6,
    i18n,
  );
  return minimum === maximum
    ? i18n._(msg`${minimum} m/s`)
    : i18n._(msg`${minimum}…${maximum} m/s`);
}

function errorMessage(code: PointWeatherForecastErrorCode): MessageDescriptor {
  if (code === 'provider-rate-limited') {
    return msg`Weather service is temporarily rate-limited. Try again shortly.`;
  }
  if (code === 'provider-timeout' || code === 'provider-unavailable') {
    return msg`Weather forecast could not be loaded. Check your connection and try again.`;
  }
  return msg`Weather data could not be read. Try another point or try again later.`;
}

function LoadingSummaryPeriod() {
  return (
    <Box
      sx={{
        minWidth: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        px: 1,
        py: 0.75,
        '@media (max-width: 479px)': {
          px: 2,
          py: 1.5,
        },
      }}
    >
      <Box
        sx={{
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: '44px minmax(0, 1fr)',
          columnGap: 1,
          alignItems: 'start',
          '@media (max-width: 479px)': {
            gridTemplateColumns: '64px minmax(0, 1fr)',
            columnGap: 1.5,
          },
        }}
      >
        <Stack spacing={1} sx={{ minWidth: 0, alignItems: 'center' }}>
          <Skeleton variant="text" width={36} height={16} />
          <Skeleton variant="circular" width={36} height={36} />
        </Stack>
        <Box
          sx={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            '@media (max-width: 479px)': {
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) max-content',
              gridTemplateAreas:
                '"temperature precipitation" "condition precipitation" "metrics metrics"',
              columnGap: 1,
              rowGap: 0.5,
            },
          }}
        >
          <Skeleton
            variant="text"
            sx={{
              gridArea: 'temperature',
              width: '72%',
              height: 18,
              '@media (max-width: 479px)': { width: 104, maxWidth: '100%', height: 28 },
            }}
          />
          <Skeleton
            variant="text"
            width={96}
            height={18}
            sx={{
              gridArea: 'condition',
              display: 'none',
              '@media (max-width: 479px)': { display: 'block' },
            }}
          />
          <Box
            sx={{
              gridArea: 'metrics',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              mt: 0.5,
              '@media (max-width: 479px)': {
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                columnGap: 1,
                mt: 0.75,
              },
            }}
          >
            {[64, 72].map((valueWidth, index) => (
              <Stack
                key={valueWidth}
                direction="row"
                spacing={0.5}
                sx={{
                  minWidth: 0,
                  alignItems: 'center',
                  '@media (max-width: 479px)': {
                    minHeight: 36,
                    pl: index === 1 ? 1 : 0,
                    borderLeft: index === 1 ? 1 : 0,
                    borderColor: 'divider',
                  },
                }}
              >
                <Skeleton variant="circular" width={16} height={16} />
                <Stack spacing={0} sx={{ minWidth: 0 }}>
                  <Skeleton
                    variant="text"
                    width={40}
                    height={15}
                    sx={{
                      display: 'none',
                      '@media (max-width: 479px)': { display: 'block' },
                    }}
                  />
                  <Skeleton variant="text" width={valueWidth} height={15} />
                </Stack>
              </Stack>
            ))}
          </Box>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              gridArea: 'precipitation',
              alignItems: 'center',
              minWidth: 0,
              '@media (max-width: 479px)': { mt: 0.25 },
            }}
          >
            <Skeleton variant="circular" width={16} height={16} />
            <Skeleton variant="text" width={40} height={15} />
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}

function LoadingSummary() {
  const { t } = useLingui();
  return (
    <Paper
      variant="outlined"
      aria-label={t`Loading current, day, and night summary`}
      sx={{
        minHeight: 176,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.06fr) minmax(0, 0.94fr)',
        borderRadius: 1.25,
        overflow: 'hidden',
        '@media (max-width: 479px)': {
          gridTemplateColumns: 'minmax(0, 1fr)',
        },
      }}
    >
      <Box sx={{ px: 1.5, py: 1, bgcolor: appColors.surface.subtle }}>
        <Skeleton variant="text" width={108} height={20} />
        <Skeleton variant="text" width={148} height={20} />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mt: 1 }}>
          <Skeleton variant="circular" width={48} height={48} />
          <Stack spacing={0} sx={{ minWidth: 0, flex: 1 }}>
            <Skeleton variant="text" width={108} height={28} />
            <Skeleton variant="text" width="52%" height={18} />
          </Stack>
        </Stack>
        <Stack spacing={0} sx={{ mt: 1 }}>
          {[72, 64, 88].map((labelWidth) => (
            <Box
              key={labelWidth}
              sx={{
                minHeight: 16,
                display: 'grid',
                gridTemplateColumns: '16px minmax(0, 1fr) 52px',
                columnGap: 0.5,
                alignItems: 'center',
              }}
            >
              <Skeleton variant="circular" width={16} height={16} />
              <Skeleton variant="text" width={labelWidth} height={15} />
              <Skeleton variant="text" width={52} height={15} />
            </Box>
          ))}
        </Stack>
      </Box>
      <Stack
        sx={{
          minWidth: 0,
          borderLeft: 1,
          borderColor: 'divider',
          '@media (max-width: 479px)': {
            mx: 1,
            my: 0,
            borderLeft: 0,
          },
        }}
      >
        <LoadingSummaryPeriod />
        <Divider sx={{ mx: 1 }} />
        <LoadingSummaryPeriod />
      </Stack>
    </Paper>
  );
}

function LoadingDailyPeriodRow() {
  return (
    <Box
      sx={{
        minWidth: 0,
        minHeight: 36,
        display: 'grid',
        gridTemplateColumns: '28px 58px minmax(0, 1fr) 52px 76px',
        gridTemplateAreas: '"icon temperature condition precipitation metrics"',
        alignItems: 'center',
        columnGap: 0.5,
        px: 1,
        py: 0.375,
        '@media (max-width: 479px)': {
          gridTemplateColumns: '28px minmax(0, 1fr) 52px 76px',
          gridTemplateAreas:
            '"icon temperature precipitation metrics" "icon condition precipitation metrics"',
          rowGap: 0,
        },
      }}
    >
      <Skeleton variant="circular" width={28} height={28} sx={{ gridArea: 'icon' }} />
      <Skeleton
        variant="text"
        width={52}
        height={16}
        sx={{ gridArea: 'temperature' }}
      />
      <Skeleton variant="text" width="80%" height={14} sx={{ gridArea: 'condition' }} />
      <Skeleton
        variant="text"
        width={40}
        height={14}
        sx={{ gridArea: 'precipitation' }}
      />
      <Stack spacing={0} sx={{ gridArea: 'metrics', minWidth: 0 }}>
        <Skeleton variant="text" width={68} height={12} />
        <Skeleton variant="text" width={68} height={12} />
      </Stack>
    </Box>
  );
}

function LoadingDayForecastRow() {
  return (
    <Paper
      variant="outlined"
      sx={{
        minHeight: 80,
        display: 'grid',
        gridTemplateColumns: '52px minmax(0, 1fr)',
        borderRadius: 1.25,
        overflow: 'hidden',
      }}
    >
      <Stack
        spacing={0.25}
        sx={{
          my: 1,
          px: 1,
          justifyContent: 'center',
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        <Skeleton variant="text" width={30} height={20} />
        <Skeleton variant="text" width={36} height={18} />
      </Stack>
      <Stack sx={{ minWidth: 0, py: 0.25 }}>
        <LoadingDailyPeriodRow />
        <Divider sx={{ mx: 0.75 }} />
        <LoadingDailyPeriodRow />
      </Stack>
    </Paper>
  );
}

function LoadingForecast() {
  const { t } = useLingui();
  return (
    <Stack spacing={2}>
      <LoadingSummary />
      <Stack spacing={1}>
        <Skeleton variant="text" width={120} height={24} />
        <Skeleton
          variant="rounded"
          width="100%"
          height={344}
          aria-label={t`Loading hourly forecast`}
        />
      </Stack>
      <Stack spacing={1}>
        <Skeleton variant="text" width={112} height={24} />
        <Stack spacing={1} aria-label={t`Loading seven-day forecast`}>
          {Array.from({ length: 7 }, (_, index) => (
            <LoadingDayForecastRow key={index} />
          ))}
        </Stack>
      </Stack>
    </Stack>
  );
}

type WeatherMetricKind = 'wind' | 'gusts' | 'precipitation';

interface PeriodDisplayValues {
  readonly temperature: string;
  readonly temperatureLabel: string;
  readonly wind: string;
  readonly windLabel: string;
  readonly gusts: string;
  readonly gustsLabel: string;
  readonly precipitation: string;
  readonly precipitationLabel: string;
  readonly condition: string;
}

/** Visible period values and their spoken labels, prefixed with the period `label`. */
function periodDisplayValues(
  period: PointWeatherForecastPeriod,
  label: string,
  i18n: I18n,
): PeriodDisplayValues {
  const minimumTemperature = Math.round(period.temperatureMinCelsius).toString();
  const maximumTemperature = Math.round(period.temperatureMaxCelsius).toString();
  const minimumWind = formatWeatherWindMetresPerSecond(
    period.windSpeedMinKmh / 3.6,
    i18n,
  );
  const maximumWind = formatWeatherWindMetresPerSecond(
    period.windSpeedMaxKmh / 3.6,
    i18n,
  );
  const minimumGusts = formatWeatherWindMetresPerSecond(
    period.windGustsMinKmh / 3.6,
    i18n,
  );
  const maximumGusts = formatWeatherWindMetresPerSecond(
    period.windGustsMaxKmh / 3.6,
    i18n,
  );
  const millimetres = new Intl.NumberFormat(i18n.locale).format(period.precipitationMm);
  return {
    temperature: formatWeatherTemperatureRange(
      period.temperatureMinCelsius,
      period.temperatureMaxCelsius,
      i18n,
    ),
    temperatureLabel: i18n._(
      msg`${label} temperature ${minimumTemperature} to ${maximumTemperature} degrees Celsius`,
    ),
    wind: formatWindRange(period.windSpeedMinKmh, period.windSpeedMaxKmh, i18n),
    windLabel: i18n._(
      msg`${label} wind ${minimumWind} to ${maximumWind} metres per second`,
    ),
    gusts: formatWindRange(period.windGustsMinKmh, period.windGustsMaxKmh, i18n),
    gustsLabel: i18n._(
      msg`${label} gusts ${minimumGusts} to ${maximumGusts} metres per second`,
    ),
    precipitation: formatWeatherMillimetres(period.precipitationMm, i18n),
    precipitationLabel: i18n._(msg`${label} precipitation ${millimetres} millimetres`),
    condition: i18n._(describeWeatherPeriodCondition(period.status.primary)),
  };
}

function WeatherMetricIcon({
  kind,
  label,
  size = 15,
}: {
  readonly kind: WeatherMetricKind;
  readonly label: string;
  readonly size?: number;
}) {
  const color = kind === 'precipitation' ? 'info.dark' : 'text.secondary';
  const icon =
    kind === 'wind' ? (
      <AirOutlinedIcon aria-hidden="true" sx={{ fontSize: size, color }} />
    ) : kind === 'gusts' ? (
      <SpeedOutlinedIcon aria-hidden="true" sx={{ fontSize: size, color }} />
    ) : (
      <WaterDropOutlinedIcon aria-hidden="true" sx={{ fontSize: size, color }} />
    );
  return <WeatherIconTooltip label={label}>{icon}</WeatherIconTooltip>;
}

function CompactMetricValue({
  kind,
  label,
  value,
  ariaLabel,
  compact = false,
}: {
  readonly kind: WeatherMetricKind;
  readonly label: string;
  readonly value: string;
  readonly ariaLabel: string;
  readonly compact?: boolean;
}) {
  return (
    <Stack
      direction="row"
      spacing={compact ? 0.25 : 0.5}
      sx={{ alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}
    >
      <WeatherMetricIcon kind={kind} label={label} size={compact ? 12 : 16} />
      <Typography
        variant="caption"
        color={kind === 'precipitation' ? 'info.dark' : 'text.secondary'}
        aria-label={ariaLabel}
        sx={{
          minWidth: 0,
          fontSize: compact ? '0.6rem' : undefined,
          lineHeight: compact ? 1.3 : 1.25,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function CurrentMetricRow({
  kind,
  label,
  value,
  ariaLabel,
}: {
  readonly kind: WeatherMetricKind;
  readonly label: string;
  readonly value: string;
  readonly ariaLabel: string;
}) {
  return (
    <Box
      sx={{
        minHeight: 16,
        display: 'grid',
        gridTemplateColumns: '16px minmax(0, 1fr) max-content',
        columnGap: 0.5,
        alignItems: 'center',
        color: kind === 'precipitation' ? 'info.dark' : 'text.primary',
        '@media (max-width: 239px)': {
          gridTemplateColumns: '16px minmax(0, 1fr)',
        },
      }}
    >
      <WeatherMetricIcon kind={kind} label={label} size={16} />
      <Typography
        variant="caption"
        color={kind === 'precipitation' ? 'inherit' : 'text.secondary'}
        sx={{
          lineHeight: 1.25,
          '@media (max-width: 239px)': {
            display: 'none',
          },
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="caption"
        aria-label={ariaLabel}
        sx={{
          color: 'inherit',
          justifySelf: 'end',
          fontWeight: 500,
          lineHeight: 1.25,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function PeriodGraphic({
  isDay,
  label,
  period,
  size,
}: {
  readonly isDay: boolean;
  readonly label: string;
  readonly period: PointWeatherForecastPeriod;
  readonly size: number;
}) {
  const { i18n } = useLingui();
  const visibility = describeWeatherVisibility(period.status);
  const condition = i18n._(describeWeatherPeriodCondition(period.status.primary));
  return (
    <WeatherPeriodIcon
      icon={period.status.primary.icon}
      visibility={period.status.visibility}
      isDay={isDay}
      label={
        period.status.primary.icon.phenomenon === null && visibility !== null
          ? i18n._(visibility)
          : `${label}: ${condition}`
      }
      size={size}
    />
  );
}

function CurrentSummary({
  dateLabels,
  forecast,
}: {
  readonly dateLabels: ForecastDateLabels;
  readonly forecast: PointWeatherForecast;
}) {
  const { i18n, t } = useLingui();
  const label = t`Now · next 3 h`;
  const period = forecast.currentThreeHours;
  const values = periodDisplayValues(period, label, i18n);
  const currentDate = dateLabels.longWeekdayDayMonth.format(
    forecastDate(forecast.current.time.slice(0, 10)),
  );
  return (
    <Box
      component="article"
      aria-label={t`${label} forecast`}
      sx={{
        height: '100%',
        px: 1.5,
        py: 1,
        bgcolor: appColors.surface.subtle,
        '@media (max-width: 319px)': {
          px: 1,
        },
      }}
    >
      <Typography variant="subtitle2">{label}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {`${currentDate} · ${forecast.current.time.slice(11, 16)}`}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'flex-start',
          minWidth: 0,
          mt: 1,
          '@media (max-width: 319px)': {
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
          },
        }}
      >
        <PeriodGraphic
          isDay={forecast.current.isDay}
          label={label}
          period={period}
          size={64}
        />
        <Stack
          spacing={0}
          sx={{
            minWidth: 0,
            flex: 1,
            '@media (max-width: 319px)': {
              flex: 'initial',
              alignItems: 'center',
              textAlign: 'center',
            },
          }}
        >
          <Typography
            aria-label={values.temperatureLabel}
            sx={{
              fontSize: '1.5rem',
              fontWeight: 750,
              lineHeight: 1.15,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              '@media (max-width: 239px)': {
                fontSize: '1.25rem',
              },
            }}
          >
            {values.temperature}
          </Typography>
          <Typography variant="body2" sx={{ minWidth: 0, lineHeight: 1.25 }}>
            {values.condition}
          </Typography>
        </Stack>
      </Stack>
      <Stack spacing={0} sx={{ mt: 1 }}>
        <CurrentMetricRow
          kind="wind"
          label={t`Wind`}
          value={values.wind}
          ariaLabel={values.windLabel}
        />
        <CurrentMetricRow
          kind="gusts"
          label={t`Gusts`}
          value={values.gusts}
          ariaLabel={values.gustsLabel}
        />
        <CurrentMetricRow
          kind="precipitation"
          label={t`Precipitation`}
          value={values.precipitation}
          ariaLabel={values.precipitationLabel}
        />
      </Stack>
    </Box>
  );
}

function SummaryPeriod({
  isDay,
  label,
  period,
}: {
  readonly isDay: boolean;
  readonly label: string;
  readonly period: PointWeatherForecastPeriod;
}) {
  const { i18n, t } = useLingui();
  const values = periodDisplayValues(period, label, i18n);
  return (
    <Box
      component="article"
      aria-label={t`${label} forecast`}
      sx={{
        minWidth: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        px: 1,
        py: 0.75,
        '@media (max-width: 479px)': {
          px: 2,
          py: 1.5,
        },
        '@media (max-width: 279px)': {
          px: 1,
        },
      }}
    >
      <Box
        sx={{
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: '44px minmax(0, 1fr)',
          columnGap: 1,
          alignItems: 'start',
          '@media (max-width: 479px)': {
            gridTemplateColumns: '44px minmax(0, 1fr) max-content',
            gridTemplateAreas:
              '"label label ." "graphic temperature metrics" "graphic condition metrics"',
            columnGap: 1,
            rowGap: 0.5,
            alignItems: 'start',
          },
        }}
      >
        <Stack
          spacing={1}
          sx={{
            minWidth: 0,
            alignItems: 'center',
            '@media (max-width: 479px)': {
              display: 'contents',
              '& > :nth-child(2)': {
                gridArea: 'graphic',
                justifySelf: 'start',
                alignSelf: 'center',
              },
            },
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              fontWeight: 700,
              lineHeight: 1.25,
              '@media (max-width: 479px)': {
                gridArea: 'label',
                justifySelf: 'start',
                color: 'text.primary',
                fontSize: '0.95rem',
              },
            }}
          >
            {label}
          </Typography>
          <PeriodGraphic isDay={isDay} label={label} period={period} size={44} />
        </Stack>
        <Box
          sx={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            '@media (max-width: 479px)': {
              display: 'contents',
            },
          }}
        >
          <Typography
            variant="body2"
            aria-label={values.temperatureLabel}
            sx={{
              gridArea: 'temperature',
              fontWeight: 700,
              lineHeight: 1.25,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              '@media (max-width: 479px)': {
                fontSize: '1.35rem',
                lineHeight: 1.15,
              },
              '@media (max-width: 239px)': {
                fontSize: '1.15rem',
              },
            }}
          >
            {values.temperature}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              gridArea: 'condition',
              display: 'none',
              minWidth: 0,
              lineHeight: 1.25,
              '@media (max-width: 479px)': {
                display: 'block',
                alignSelf: 'start',
              },
            }}
          >
            {values.condition}
          </Typography>
          <Box
            sx={{
              display: 'contents',
              '@media (max-width: 479px)': {
                gridArea: 'metrics',
                display: 'flex',
                flexDirection: 'column',
                alignSelf: 'start',
                justifySelf: 'end',
              },
            }}
          >
            <Stack
              spacing={0}
              sx={{
                minWidth: 0,
                mt: 0.5,
                '@media (max-width: 479px)': {
                  mt: 0,
                },
                '@media (max-width: 239px)': {
                  '& .MuiSvgIcon-root': {
                    fontSize: 12,
                  },
                  '& .MuiTypography-root': {
                    fontSize: '0.7rem',
                  },
                  '& .MuiStack-root': {
                    columnGap: 0.25,
                  },
                },
              }}
            >
              <CompactMetricValue
                kind="wind"
                label={t`${label} wind`}
                value={values.wind}
                ariaLabel={values.windLabel}
              />
              <CompactMetricValue
                kind="gusts"
                label={t`${label} gusts`}
                value={values.gusts}
                ariaLabel={values.gustsLabel}
              />
            </Stack>
            <Box
              sx={{
                minWidth: 0,
                '@media (max-width: 479px)': {
                  order: -1,
                },
              }}
            >
              <CompactMetricValue
                kind="precipitation"
                label={t`${label} precipitation`}
                value={values.precipitation}
                ariaLabel={values.precipitationLabel}
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * One forecast period row. With `onOpen` it is a button; `openLabel` names its action
 * and defaults to opening the 24-hour table. `stacked` always places the condition under
 * the temperature, the layout narrow viewports use, for rows in narrow containers.
 */
export function DailyPeriodRow({
  dateLabel,
  isDay,
  label,
  onOpen,
  openLabel,
  period,
  stacked = false,
}: {
  readonly dateLabel: string;
  readonly isDay: boolean;
  readonly label: string;
  readonly onOpen?: (triggerElement: HTMLElement) => void;
  readonly openLabel?: string;
  readonly period: PointWeatherForecastPeriod;
  readonly stacked?: boolean;
}) {
  const { i18n, t } = useLingui();
  const values = periodDisplayValues(period, label, i18n);
  /* eslint-disable lingui/no-unlocalized-strings -- CSS tokens. */
  const stackedGrid = {
    gridTemplateColumns: '36px minmax(0, 1fr) 52px 76px',
    gridTemplateAreas:
      '"icon temperature precipitation metrics" "icon condition precipitation metrics"',
    rowGap: 0,
  } as const;
  const rowSx = {
    width: '100%',
    minWidth: 0,
    minHeight: 44,
    display: 'grid',
    gridTemplateColumns: '36px 58px minmax(0, 1fr) 52px 76px',
    gridTemplateAreas: '"icon temperature condition precipitation metrics"',
    alignItems: 'center',
    columnGap: 0.5,
    px: 1,
    py: 0.375,
    color: 'text.primary',
    textAlign: 'left',
    ...(stacked ? stackedGrid : {}),
    '@media (max-width: 479px)': stackedGrid,
  } as const;
  /* eslint-enable lingui/no-unlocalized-strings */
  const content = (
    <>
      <Box sx={{ gridArea: 'icon', display: 'grid', placeItems: 'center' }}>
        <PeriodGraphic isDay={isDay} label={label} period={period} size={36} />
      </Box>
      <Typography
        variant="caption"
        aria-label={values.temperatureLabel}
        sx={{
          gridArea: 'temperature',
          fontSize: '0.75rem',
          fontWeight: 700,
          lineHeight: 1.25,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {values.temperature}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          gridArea: 'condition',
          minWidth: 0,
          whiteSpace: 'normal',
          overflowWrap: 'anywhere',
          fontSize: '0.68rem',
          lineHeight: 1.2,
        }}
      >
        {values.condition}
      </Typography>
      <Box sx={{ gridArea: 'precipitation', minWidth: 0 }}>
        <CompactMetricValue
          kind="precipitation"
          label={t`${label} precipitation`}
          value={values.precipitation}
          ariaLabel={values.precipitationLabel}
          compact
        />
      </Box>
      <Stack spacing={0} sx={{ gridArea: 'metrics', minWidth: 0 }}>
        <CompactMetricValue
          kind="wind"
          label={t`${label} wind`}
          value={values.wind}
          ariaLabel={values.windLabel}
          compact
        />
        <CompactMetricValue
          kind="gusts"
          label={t`${label} gusts`}
          value={values.gusts}
          ariaLabel={values.gustsLabel}
          compact
        />
      </Stack>
    </>
  );
  return (
    <Box component="article" aria-label={t`${label} forecast`}>
      {onOpen === undefined ? (
        <Box sx={rowSx}>{content}</Box>
      ) : (
        <ButtonBase
          type="button"
          aria-label={openLabel ?? t`Open 24-hour forecast for ${label}, ${dateLabel}`}
          onClick={(event) => {
            onOpen(event.currentTarget);
          }}
          sx={{
            ...rowSx,
            '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-focusVisible': {
              boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
            },
          }}
        >
          {content}
        </ButtonBase>
      )}
    </Box>
  );
}

function ForecastSummary({
  dateLabels,
  forecast,
}: {
  readonly dateLabels: ForecastDateLabels;
  readonly forecast: PointWeatherForecast;
}) {
  const { t } = useLingui();
  const firstDay = forecast.days[0];
  if (firstDay === undefined) {
    throw new RangeError('Forecast summary requires the current local day.');
  }
  return (
    <Paper
      variant="outlined"
      role="region"
      aria-label={t`Current, day, and night summary`}
      sx={{
        minHeight: 176,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.06fr) minmax(0, 0.94fr)',
        borderRadius: 1.25,
        overflow: 'hidden',
        '@media (max-width: 479px)': {
          gridTemplateColumns: 'minmax(0, 1fr)',
        },
      }}
    >
      <CurrentSummary dateLabels={dateLabels} forecast={forecast} />
      <Stack
        sx={{
          minWidth: 0,
          borderLeft: 1,
          borderColor: 'divider',
          '@media (max-width: 479px)': {
            mx: 1,
            my: 0,
            borderLeft: 0,
          },
        }}
      >
        <SummaryPeriod label={t`Day`} period={firstDay.day} isDay />
        <Divider sx={{ mx: 1 }} />
        <SummaryPeriod label={t`Night`} period={firstDay.night} isDay={false} />
      </Stack>
    </Paper>
  );
}

/** Outlined forecast card with a labelled left column, as in the 7-day forecast. */
export function WeatherForecastCard({
  children,
  headerWidth = 52,
  highlighted = false,
  label,
  subtitle,
  title,
}: {
  readonly children: ReactNode;
  readonly headerWidth?: number;
  readonly highlighted?: boolean;
  readonly label: string;
  readonly subtitle: string;
  readonly title: string;
}) {
  return (
    <Paper
      data-weather-day-card
      role="group"
      variant="outlined"
      aria-label={label}
      sx={{
        display: 'grid',
        gridTemplateColumns: `${headerWidth.toString()}px minmax(0, 1fr)`,
        borderColor: 'divider',
        borderRadius: 1.25,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          minWidth: 0,
          my: highlighted ? 0 : 1,
          px: 1,
          py: highlighted ? 1 : 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          bgcolor: highlighted ? appColors.tag.orange.background : 'transparent',
          color: highlighted ? appColors.tag.orange.foreground : 'text.primary',
          borderRight: highlighted ? 0 : 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="body2" sx={{ color: 'inherit', fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography
          variant="caption"
          color={highlighted ? 'inherit' : 'text.secondary'}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {subtitle}
        </Typography>
      </Box>
      <Stack sx={{ minWidth: 0, py: 0.25, justifyContent: 'center' }}>{children}</Stack>
    </Paper>
  );
}

function DayForecastRow({
  dateLabels,
  day,
  onOpenHourly,
}: {
  readonly dateLabels: ForecastDateLabels;
  readonly day: PointWeatherForecastDay;
  readonly onOpenHourly: OpenDailyHourlyForecast;
}) {
  const { t } = useLingui();
  const date = forecastDate(day.date);
  const weekdayIndex = date.getUTCDay();
  const dateLabel = dateLabels.weekdayDayMonth.format(date);
  return (
    <WeatherForecastCard
      label={dateLabel}
      title={dateLabels.weekday.format(date)}
      subtitle={dateLabels.dayMonth.format(date)}
      highlighted={weekdayIndex === 0 || weekdayIndex === 6}
    >
      <DailyPeriodRow
        dateLabel={dateLabel}
        label={t`Day`}
        period={day.day}
        isDay
        onOpen={(triggerElement) => {
          onOpenHourly(day, true, triggerElement);
        }}
      />
      <Divider sx={{ mx: 0.75 }} />
      <DailyPeriodRow
        dateLabel={dateLabel}
        label={t`Night`}
        period={day.night}
        isDay={false}
        onOpen={(triggerElement) => {
          onOpenHourly(day, false, triggerElement);
        }}
      />
    </WeatherForecastCard>
  );
}

function SevenDayForecast({
  dateLabels,
  forecast,
  onOpenHourly,
}: {
  readonly dateLabels: ForecastDateLabels;
  readonly forecast: PointWeatherForecast;
  readonly onOpenHourly: OpenDailyHourlyForecast;
}) {
  const { t } = useLingui();
  return (
    <Stack spacing={1}>
      <Typography component="h2" variant="subtitle2">
        <Trans>7-day forecast</Trans>
      </Typography>
      <Stack role="list" aria-label={t`Seven-day forecast`} spacing={1}>
        {forecast.days.map((day) => (
          <Box key={day.date} role="listitem">
            <DayForecastRow
              dateLabels={dateLabels}
              day={day}
              onOpenHourly={onOpenHourly}
            />
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

function ForecastFooter({
  forecast,
}: {
  readonly forecast: PointWeatherForecast | null;
}) {
  const { i18n, t } = useLingui();
  const model = forecast?.model ?? DEFAULT_WEATHER_MODEL;
  const modelName = weatherProviderConfiguration.models[model].displayName;
  let updateText = t`Update time unavailable`;
  if (forecast?.modelRunAt !== null && forecast?.modelRunAt !== undefined) {
    /* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
    const updatedAt = new Intl.DateTimeFormat(i18n.locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: forecast.timezone,
    }).format(new Date(forecast.modelRunAt));
    /* eslint-enable lingui/no-unlocalized-strings */
    updateText = t`Updated ${updatedAt}`;
  }
  return (
    <Box
      sx={{
        flexShrink: 0,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 0.5,
        px: 2,
        py: 1.25,
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: appColors.surface.subtle,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {modelName} · {updateText}
      </Typography>
      <Link
        variant="caption"
        href={weatherProviderConfiguration.attributionUrl}
        target="_blank"
        rel="noreferrer"
        sx={{ whiteSpace: 'nowrap' }}
      >
        <Trans>Weather data by Open-Meteo</Trans>
      </Link>
    </Box>
  );
}

export function WeatherPanel({
  onSelectedPointChange,
  sidebarCollapsed,
}: WeatherPanelProps) {
  const { i18n, t } = useLingui();
  const { pointWeatherForecast } = useRuntimeServices();
  const dateLabels = useMemo(
    () => createForecastDateLabels(i18n.locale),
    [i18n.locale],
  );
  const request = useStore(
    mapInteractionStore,
    (state) => state.weatherForecastRequest,
  );
  const weatherMapEnabled = useStore(
    mapLayerStore,
    (mapState) => mapState.weatherMap.enabled,
  );
  const [state, setState] = useState<WeatherPanelState>({ status: 'idle' });
  const [hourlyPanelRequest, setHourlyPanelRequest] =
    useState<FloatingHourlyForecastRequest | null>(null);
  const [nearbyPlaceLabel, setNearbyPlaceLabel] = useState<string | null>(null);
  useEffect(() => {
    if (state.status === 'idle') {
      onSelectedPointChange(null);
      return;
    }
    const point: {
      coordinate: MapCoordinate;
      elevationMeters?: number;
      placeLabel?: string;
    } = { coordinate: state.coordinate };
    if (state.status === 'ready') {
      point.elevationMeters = state.forecast.elevationMeters;
    }
    if (nearbyPlaceLabel !== null) point.placeLabel = nearbyPlaceLabel;
    onSelectedPointChange(point);
  }, [nearbyPlaceLabel, onSelectedPointChange, state]);
  const activeController = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!sidebarCollapsed) return undefined;
    const frame = window.requestAnimationFrame(() => {
      setHourlyPanelRequest(null);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [sidebarCollapsed]);

  const loadForecast = useCallback(
    (coordinate: MapCoordinate, placeLabel?: string, elevationMeters?: number) => {
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;
      setHourlyPanelRequest(null);
      setNearbyPlaceLabel(placeLabel ?? null);
      setWeatherMapForecastMarker(null);
      setState({ status: 'loading', coordinate: { ...coordinate }, elevationMeters });
      void pointWeatherForecast
        .execute(
          elevationMeters === undefined
            ? { coordinate, model: DEFAULT_WEATHER_MODEL }
            : { coordinate, model: DEFAULT_WEATHER_MODEL, elevationMeters },
          controller.signal,
        )
        .then((forecast) => {
          if (controller.signal.aborted || activeController.current !== controller)
            return;
          setWeatherMapForecastMarker({
            coordinate,
            isDay: forecast.current.isDay,
            period: forecast.currentThreeHours,
          });
          setState({
            status: 'ready',
            coordinate: { ...coordinate },
            elevationMeters,
            forecast,
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || activeController.current !== controller)
            return;
          setWeatherMapForecastMarker(null);
          const code =
            error instanceof PointWeatherForecastError
              ? error.code
              : // eslint-disable-next-line lingui/no-unlocalized-strings -- Error code.
                'provider-unavailable';
          setState({
            status: 'error',
            coordinate: { ...coordinate },
            elevationMeters,
            code,
          });
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
      loadForecast(request.coordinate, request.placeLabel, request.elevationMeters);
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
          <WeatherIconTooltip label={t`Weather forecast`}>
            <WbCloudyOutlinedIcon
              aria-hidden="true"
              sx={{ fontSize: 48, color: 'text.secondary' }}
            />
          </WeatherIconTooltip>
          <Typography variant="subtitle1">
            <Trans>Select a forecast point</Trans>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {weatherMapEnabled ? (
              <Trans>Click the map to load its ECMWF IFS forecast.</Trans>
            ) : (
              <Trans>
                Use the header action, then click the map to load its ECMWF IFS
                forecast.
              </Trans>
            )}
          </Typography>
        </Stack>
      </Box>
    );
  }

  const readyForecast = state.status === 'ready' ? state.forecast : null;
  return (
    <>
      <Box
        sx={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: appColors.surface.subtle,
        }}
      >
        <Box
          data-weather-scroll-region
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
            <LoadingForecast />
          ) : state.status === 'error' ? (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.25 }}>
              <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                <Typography variant="body2">
                  {i18n._(errorMessage(state.code))}
                </Typography>
                <Button
                  variant="outlined"
                  onClick={() => {
                    loadForecast(
                      state.coordinate,
                      nearbyPlaceLabel ?? undefined,
                      state.elevationMeters,
                    );
                  }}
                >
                  <Trans>Retry</Trans>
                </Button>
              </Stack>
            </Paper>
          ) : (
            <Stack spacing={2}>
              <ForecastSummary dateLabels={dateLabels} forecast={state.forecast} />
              <HourlyForecastTable
                forecast={state.forecast}
                sidebarCollapsed={sidebarCollapsed}
              />
              <SevenDayForecast
                dateLabels={dateLabels}
                forecast={state.forecast}
                onOpenHourly={(day, isDay, triggerElement) => {
                  const date = dateLabels.weekdayDayMonth.format(
                    forecastDate(day.date),
                  );
                  const title = isDay
                    ? t`24-hour forecast · Day · ${date}`
                    : t`24-hour forecast · Night · ${date}`;
                  setHourlyPanelRequest(
                    floatingForecastRequest(
                      state.forecast,
                      day,
                      isDay,
                      title,
                      triggerElement,
                    ),
                  );
                }}
              />
            </Stack>
          )}
        </Box>
        <ForecastFooter forecast={readyForecast} />
      </Box>
      {state.status === 'ready' && !sidebarCollapsed && hourlyPanelRequest !== null ? (
        <FloatingHourlyForecastPanel
          key={hourlyPanelRequest.startTime}
          anchorElement={hourlyPanelRequest.anchorElement}
          forecast={state.forecast}
          startTime={hourlyPanelRequest.startTime}
          title={hourlyPanelRequest.title}
          triggerElement={hourlyPanelRequest.triggerElement}
          onClose={() => {
            setHourlyPanelRequest(null);
          }}
        />
      ) : null}
    </>
  );
}
