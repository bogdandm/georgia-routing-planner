import AirOutlinedIcon from '@mui/icons-material/AirOutlined';

import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import WbCloudyOutlinedIcon from '@mui/icons-material/WbCloudyOutlined';
import {
  Box,
  Button,
  Divider,
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
  type PointWeatherForecastErrorCode,
} from '@/application/ports/WeatherForecastGateway';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { weatherProviderConfiguration } from '@/bootstrap/configuration/WeatherProviderConfiguration';
import {
  consumeWeatherForecastRequest,
  mapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import type { MapCoordinate } from '@/presentation/map/mapTypes';
import { appColors } from '@/presentation/theme/appColors';
import {
  WeatherPeriodIcon,
  WeatherIconTooltip,
} from '@/presentation/weather/WeatherConditionIcon';
import { HourlyForecastTable } from '@/presentation/weather/HourlyForecastTable';
import {
  formatWeatherMillimetres,
  formatWeatherWindMetresPerSecond,
} from '@/presentation/weather/weatherFormatters';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const fullWeekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
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

export interface WeatherHeaderPoint {
  readonly coordinate: MapCoordinate;
  readonly elevationMeters?: number;
}

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

interface WeatherPanelProps {
  readonly onSelectedPointChange: (point: WeatherHeaderPoint | null) => void;
  readonly sidebarCollapsed: boolean;
}

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

function currentPeriodDateTime(timestamp: string): string {
  const date = timestamp.slice(0, 10);
  const { year, month, day } = parseLocalDate(date);
  const weekday = fullWeekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  if (weekday === undefined) throw new RangeError('Invalid local forecast date.');
  return `${weekday}, ${localDateLabel(date)} · ${timestamp.slice(11, 16)}`;
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
  const minimum = formatWeatherWindMetresPerSecond(minimumKilometresPerHour / 3.6);
  const maximum = formatWeatherWindMetresPerSecond(maximumKilometresPerHour / 3.6);
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
  return (
    <Paper
      variant="outlined"
      aria-label="Loading current, day, and night summary"
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
            borderTop: 1,
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
  return (
    <Stack spacing={2}>
      <LoadingSummary />
      <Stack spacing={1}>
        <Skeleton variant="text" width={120} height={24} />
        <Skeleton
          variant="rounded"
          width="100%"
          height={272}
          aria-label="Loading hourly forecast"
        />
      </Stack>
      <Stack spacing={1}>
        <Skeleton variant="text" width={112} height={24} />
        <Stack spacing={1} aria-label="Loading seven-day forecast">
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
  readonly temperatureMinimum: string;
  readonly temperatureMaximum: string;
  readonly wind: string;
  readonly windMinimum: string;
  readonly windMaximum: string;
  readonly gusts: string;
  readonly gustMinimum: string;
  readonly gustMaximum: string;
  readonly precipitation: string;
}

function periodDisplayValues(period: PointWeatherForecastPeriod): PeriodDisplayValues {
  return {
    temperature: formatRange(
      period.temperatureMinCelsius,
      period.temperatureMaxCelsius,
      '°C',
    ),
    temperatureMinimum: Math.round(period.temperatureMinCelsius).toString(),
    temperatureMaximum: Math.round(period.temperatureMaxCelsius).toString(),
    wind: formatWindRange(period.windSpeedMinKmh, period.windSpeedMaxKmh),
    windMinimum: formatWeatherWindMetresPerSecond(period.windSpeedMinKmh / 3.6),
    windMaximum: formatWeatherWindMetresPerSecond(period.windSpeedMaxKmh / 3.6),
    gusts: formatWindRange(period.windGustsMinKmh, period.windGustsMaxKmh),
    gustMinimum: formatWeatherWindMetresPerSecond(period.windGustsMinKmh / 3.6),
    gustMaximum: formatWeatherWindMetresPerSecond(period.windGustsMaxKmh / 3.6),
    precipitation: formatWeatherMillimetres(period.precipitationMm),
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
  const color = kind === 'precipitation' ? 'info.main' : 'text.secondary';
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
        color="text.secondary"
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
        '@media (max-width: 239px)': {
          gridTemplateColumns: '16px minmax(0, 1fr)',
        },
      }}
    >
      <WeatherMetricIcon kind={kind} label={label} size={16} />
      <Typography
        variant="caption"
        color="text.secondary"
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
  return (
    <WeatherPeriodIcon
      icon={period.status.primary.icon}
      visibility={period.status.visibility}
      isDay={isDay}
      label={
        period.status.primary.icon.phenomenon === null &&
        period.status.visibility.label !== null
          ? period.status.visibility.label
          : `${label}: ${period.status.primary.label}`
      }
      size={size}
    />
  );
}

function CurrentSummary({ forecast }: { readonly forecast: PointWeatherForecast }) {
  const label = 'Now · next 3 h';
  const period = forecast.currentThreeHours;
  const values = periodDisplayValues(period);
  return (
    <Box
      component="article"
      aria-label={`${label} forecast`}
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
        {currentPeriodDateTime(forecast.current.time)}
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
          size={48}
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
            aria-label={`${label} temperature ${values.temperatureMinimum} to ${values.temperatureMaximum} degrees Celsius`}
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
          <Typography
            variant="body2"
            sx={{ minWidth: 0, fontWeight: 700, lineHeight: 1.25 }}
          >
            {period.status.primary.label}
          </Typography>
        </Stack>
      </Stack>
      <Stack spacing={0} sx={{ mt: 1 }}>
        <CurrentMetricRow
          kind="wind"
          label="Wind"
          value={values.wind}
          ariaLabel={`${label} wind ${values.windMinimum} to ${values.windMaximum} metres per second`}
        />
        <CurrentMetricRow
          kind="gusts"
          label="Gusts"
          value={values.gusts}
          ariaLabel={`${label} gusts ${values.gustMinimum} to ${values.gustMaximum} metres per second`}
        />
        <CurrentMetricRow
          kind="precipitation"
          label="Precipitation"
          value={values.precipitation}
          ariaLabel={`${label} precipitation ${period.precipitationMm.toString()} millimetres`}
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
  const values = periodDisplayValues(period);
  return (
    <Box
      component="article"
      aria-label={`${label} forecast`}
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
              '"label label precipitation" "graphic temperature metrics" "graphic condition metrics"',
            columnGap: 1,
            rowGap: 0.5,
            alignItems: 'center',
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
            aria-label={`${label} temperature ${values.temperatureMinimum} to ${values.temperatureMaximum} degrees Celsius`}
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
              '@media (max-width: 479px)': { display: 'block' },
            }}
          >
            {period.status.primary.label}
          </Typography>
          <Stack
            spacing={0}
            sx={{
              gridArea: 'metrics',
              minWidth: 0,
              mt: 0.5,
              '@media (max-width: 479px)': {
                mt: 0,
                alignSelf: 'start',
                justifySelf: 'end',
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
              label={`${label} wind`}
              value={values.wind}
              ariaLabel={`${label} wind ${values.windMinimum} to ${values.windMaximum} metres per second`}
            />
            <CompactMetricValue
              kind="gusts"
              label={`${label} gusts`}
              value={values.gusts}
              ariaLabel={`${label} gusts ${values.gustMinimum} to ${values.gustMaximum} metres per second`}
            />
          </Stack>
          <Box
            sx={{
              gridArea: 'precipitation',
              minWidth: 0,
              '@media (max-width: 479px)': {
                justifySelf: 'end',
              },
            }}
          >
            <CompactMetricValue
              kind="precipitation"
              label={`${label} precipitation`}
              value={values.precipitation}
              ariaLabel={`${label} precipitation ${period.precipitationMm.toString()} millimetres`}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function DailyPeriodRow({
  isDay,
  label,
  period,
}: {
  readonly isDay: boolean;
  readonly label: string;
  readonly period: PointWeatherForecastPeriod;
}) {
  const values = periodDisplayValues(period);
  return (
    <Box
      component="article"
      aria-label={`${label} forecast`}
      sx={{
        minWidth: 0,
        minHeight: 44,
        display: 'grid',
        gridTemplateColumns: '36px 58px minmax(0, 1fr) 52px 76px',
        gridTemplateAreas: '"icon temperature condition precipitation metrics"',
        alignItems: 'center',
        columnGap: 0.5,
        px: 1,
        py: 0.375,
        '@media (max-width: 479px)': {
          gridTemplateColumns: '36px minmax(0, 1fr) 52px 76px',
          gridTemplateAreas:
            '"icon temperature precipitation metrics" "icon condition precipitation metrics"',
          rowGap: 0,
        },
      }}
    >
      <Box sx={{ gridArea: 'icon', display: 'grid', placeItems: 'center' }}>
        <PeriodGraphic isDay={isDay} label={label} period={period} size={36} />
      </Box>
      <Typography
        variant="caption"
        aria-label={`${label} temperature ${values.temperatureMinimum} to ${values.temperatureMaximum} degrees Celsius`}
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
        {period.status.primary.label}
      </Typography>
      <Box sx={{ gridArea: 'precipitation', minWidth: 0 }}>
        <CompactMetricValue
          kind="precipitation"
          label={`${label} precipitation`}
          value={values.precipitation}
          ariaLabel={`${label} precipitation ${period.precipitationMm.toString()} millimetres`}
          compact
        />
      </Box>
      <Stack spacing={0} sx={{ gridArea: 'metrics', minWidth: 0 }}>
        <CompactMetricValue
          kind="wind"
          label={`${label} wind`}
          value={values.wind}
          ariaLabel={`${label} wind ${values.windMinimum} to ${values.windMaximum} metres per second`}
          compact
        />
        <CompactMetricValue
          kind="gusts"
          label={`${label} gusts`}
          value={values.gusts}
          ariaLabel={`${label} gusts ${values.gustMinimum} to ${values.gustMaximum} metres per second`}
          compact
        />
      </Stack>
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
      <CurrentSummary forecast={forecast} />
      <Stack
        sx={{
          minWidth: 0,
          borderLeft: 1,
          borderColor: 'divider',
          '@media (max-width: 479px)': {
            mx: 1,
            my: 0,
            borderTop: 1,
            borderLeft: 0,
          },
        }}
      >
        <SummaryPeriod label="Day" period={firstDay.day} isDay />
        <Divider sx={{ mx: 1 }} />
        <SummaryPeriod label="Night" period={firstDay.night} isDay={false} />
      </Stack>
    </Paper>
  );
}

function DayForecastRow({ day }: { readonly day: PointWeatherForecastDay }) {
  return (
    <Paper
      role="group"
      variant="outlined"
      aria-label={`${localWeekday(day.date)} ${localDateLabel(day.date)}`}
      sx={{
        minHeight: 80,
        display: 'grid',
        gridTemplateColumns: '52px minmax(0, 1fr)',
        borderRadius: 1.25,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          minWidth: 0,
          my: 1,
          px: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {localWeekday(day.date)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: 'nowrap' }}
        >
          {localDateLabel(day.date)}
        </Typography>
      </Box>
      <Stack sx={{ minWidth: 0, py: 0.25 }}>
        <DailyPeriodRow label="Day" period={day.day} isDay />
        <Divider sx={{ mx: 0.75 }} />
        <DailyPeriodRow label="Night" period={day.night} isDay={false} />
      </Stack>
    </Paper>
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
      <Stack role="list" aria-label="Seven-day forecast" spacing={1}>
        {days.map((day) => (
          <Box key={day.date} role="listitem">
            <DayForecastRow day={day} />
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
        Weather data by Open-Meteo
      </Link>
    </Box>
  );
}

export function WeatherPanel({
  onSelectedPointChange,
  sidebarCollapsed,
}: WeatherPanelProps) {
  const { pointWeatherForecast } = useRuntimeServices();
  const request = useStore(
    mapInteractionStore,
    (state) => state.weatherForecastRequest,
  );
  const [state, setState] = useState<WeatherPanelState>({ status: 'idle' });
  useEffect(() => {
    if (state.status === 'idle') {
      onSelectedPointChange(null);
      return;
    }
    if (state.status === 'ready') {
      onSelectedPointChange({
        coordinate: state.coordinate,
        elevationMeters: state.forecast.elevationMeters,
      });
      return;
    }
    onSelectedPointChange({ coordinate: state.coordinate });
  }, [onSelectedPointChange, state]);
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
        ) : (
          <Stack spacing={2}>
            <ForecastSummary forecast={state.forecast} />
            <HourlyForecastTable
              forecast={state.forecast}
              sidebarCollapsed={sidebarCollapsed}
            />
            <SevenDayForecast days={state.forecast.days} />
          </Stack>
        )}
      </Box>
      <ForecastFooter forecast={readyForecast} />
    </Box>
  );
}
