import { Trans, useLingui } from '@lingui/react/macro';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Box,
  ButtonBase,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { PointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import {
  TRACK_WEATHER_START_HOUR,
  TRACK_WEATHER_TIMELINE_MAXIMUM_DISTANCE_METERS,
  defaultTrackWeatherDate,
  defaultTrackWeatherPreferences,
  planTrackWeatherTimeline,
  selectTrackElevationLocations,
  summarizeTrackWeatherCheckpoint,
  trackWeatherDates,
  trackWeatherLocalTime,
  trackWeatherWeekday,
  type TrackWeatherCheckpoint,
  type TrackWeatherLocation,
  type TrackWeatherPreferences,
} from '@/application/weather/TrackWeatherForecast';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { ElevationProfile } from '@/domain/tracks/elevationProfile';
import {
  formatTrackDuration,
  type TrackStatsMetrics,
} from '@/presentation/tracks/TrackSummary';
import {
  formatTrackDistance,
  formatTrackElevation,
} from '@/presentation/tracks/trackFormatters';
import {
  DailyPeriodRow,
  WeatherForecastCard,
} from '@/presentation/weather/WeatherPanel';

type ForecastState =
  | { readonly status: 'ready'; readonly forecast: PointWeatherForecast }
  | { readonly status: 'error' };

const cardHeaderWidth = 76;

function locationKey(location: TrackWeatherLocation): string {
  const [longitude, latitude] = location.coordinate;
  return `${longitude.toFixed(5)},${latitude.toFixed(5)},${Math.round(location.elevationMeters).toString()}`;
}

/** Browser-local calendar date; forecast dates are labels in the track's timezone. */
function localDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear().toString()}-${month}-${day}`;
}

function utcDate(date: string): Date {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- ISO time suffix.
  return new Date(`${date}T00:00:00.000Z`);
}

function ForecastPlaceholder({ children }: { readonly children?: ReactNode }) {
  return children === undefined ? (
    <Skeleton variant="rounded" height={40} sx={{ mx: 1, my: 0.25 }} />
  ) : (
    <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 1.25 }}>
      {children}
    </Typography>
  );
}

interface TrackWeatherSectionProps {
  readonly profile: ElevationProfile;
  readonly metrics: TrackStatsMetrics;
  /** Null while the stored preferences load; the section then stays collapsed. */
  readonly preferences: TrackWeatherPreferences | null;
  readonly onPreferencesChange: (preferences: TrackWeatherPreferences) => void;
}

/**
 * Forecasts at the track's highest, median, and lowest elevations and, for day hikes,
 * where the hiker is expected every three hours. Forecasts load only while expanded.
 */
export function TrackWeatherSection({
  profile,
  metrics,
  preferences,
  onPreferencesChange,
}: TrackWeatherSectionProps): ReactElement {
  const { i18n, t } = useLingui();
  const { clock, pointWeatherForecast } = useRuntimeServices();
  const current = preferences ?? defaultTrackWeatherPreferences;
  const expanded = preferences?.expanded ?? false;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const detailsId = `track-weather-${useId().replaceAll(':', '')}`;
  const dates = useMemo(() => trackWeatherDates(localDate(clock.now())), [clock]);
  const selectedDate = defaultTrackWeatherDate(dates, current.weekday);
  const elevationLocations = useMemo(
    () => selectTrackElevationLocations(profile),
    [profile],
  );
  const timeline = useMemo(
    () => planTrackWeatherTimeline(profile, metrics),
    [metrics, profile],
  );
  const locations = useMemo(() => {
    const all: TrackWeatherLocation[] = [
      elevationLocations.highest,
      elevationLocations.median,
      elevationLocations.lowest,
    ];
    if (timeline.status === 'available') all.push(...timeline.checkpoints);
    return all;
  }, [elevationLocations, timeline]);
  const [forecasts, setForecasts] = useState<ReadonlyMap<string, ForecastState>>(
    () => new Map(),
  );
  // Keys with a request in flight or a loaded forecast; failures retry on next expand.
  const requestedKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!expanded) return undefined;
    const controller = new AbortController();
    const requested = requestedKeys.current;
    const inFlight = new Set<string>();
    const settle = (key: string, state: ForecastState) => {
      inFlight.delete(key);
      setForecasts((existing) => new Map(existing).set(key, state));
    };
    for (const location of locations) {
      const key = locationKey(location);
      if (requested.has(key)) continue;
      requested.add(key);
      inFlight.add(key);
      const [longitude, latitude] = location.coordinate;
      pointWeatherForecast
        .execute(
          {
            coordinate: { longitude, latitude },
            elevationMeters: location.elevationMeters,
          },
          controller.signal,
        )
        .then(
          (forecast) => {
            if (!controller.signal.aborted) settle(key, { status: 'ready', forecast });
          },
          () => {
            if (controller.signal.aborted) return;
            requested.delete(key);
            settle(key, { status: 'error' });
          },
        );
    }
    return () => {
      controller.abort();
      // Released synchronously so the next run, which starts before the aborted
      // promises settle, requests these locations again.
      for (const key of inFlight) requested.delete(key);
    };
  }, [expanded, locations, pointWeatherForecast]);

  const weekdayFormat = new Intl.DateTimeFormat(i18n.locale, {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    weekday: 'short',
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    timeZone: 'UTC',
  });
  const fullDateFormat = new Intl.DateTimeFormat(i18n.locale, {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    weekday: 'long',
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    day: 'numeric',
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    month: 'long',
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    timeZone: 'UTC',
  });
  const selectedDateLabel = fullDateFormat.format(utcDate(selectedDate));

  const forecastFor = (location: TrackWeatherLocation): ForecastState | undefined =>
    forecasts.get(locationKey(location));

  const elevationCard = (title: string, location: TrackWeatherLocation) => {
    const elevation = formatTrackElevation(location.elevationMeters, i18n);
    const state = forecastFor(location);
    const day =
      state?.status === 'ready'
        ? state.forecast.days.find((value) => value.date === selectedDate)
        : undefined;
    return (
      <Box key={title} role="listitem">
        <WeatherForecastCard
          label={[title, elevation].join(', ')}
          title={title}
          subtitle={elevation}
          headerWidth={cardHeaderWidth}
        >
          {state === undefined ? (
            <ForecastPlaceholder />
          ) : state.status === 'error' ? (
            <ForecastPlaceholder>
              <Trans>The forecast could not be loaded.</Trans>
            </ForecastPlaceholder>
          ) : day === undefined ? (
            <ForecastPlaceholder>
              <Trans>No forecast for this date.</Trans>
            </ForecastPlaceholder>
          ) : (
            <DailyPeriodRow
              dateLabel={selectedDateLabel}
              label={t`Day`}
              period={day.day}
              isDay
            />
          )}
        </WeatherForecastCard>
      </Box>
    );
  };

  const checkpointCard = (checkpoint: TrackWeatherCheckpoint) => {
    const time = trackWeatherLocalTime(selectedDate, checkpoint.elapsedSeconds).slice(
      11,
      16,
    );
    const elevation = formatTrackElevation(checkpoint.elevationMeters, i18n);
    const distance = formatTrackDistance(checkpoint.distanceMeters, i18n);
    const place =
      checkpoint.kind === 'start'
        ? t`Start`
        : checkpoint.kind === 'finish'
          ? t`Finish`
          : t`At ${distance}`;
    const state = forecastFor(checkpoint);
    const summary =
      state?.status === 'ready'
        ? summarizeTrackWeatherCheckpoint(state.forecast, selectedDate, checkpoint)
        : null;
    return (
      <Box key={checkpoint.elapsedSeconds} role="listitem">
        <WeatherForecastCard
          label={[time, place, elevation].join(', ')}
          title={time}
          subtitle={elevation}
          headerWidth={cardHeaderWidth}
        >
          {state === undefined ? (
            <ForecastPlaceholder />
          ) : state.status === 'error' ? (
            <ForecastPlaceholder>
              <Trans>The forecast could not be loaded.</Trans>
            </ForecastPlaceholder>
          ) : summary === null ? (
            <ForecastPlaceholder>
              <Trans>No forecast for this date.</Trans>
            </ForecastPlaceholder>
          ) : (
            <DailyPeriodRow
              dateLabel={selectedDateLabel}
              label={place}
              period={summary.period}
              isDay={summary.isDay}
            />
          )}
        </WeatherForecastCard>
      </Box>
    );
  };

  const startTime = `${String(TRACK_WEATHER_START_HOUR).padStart(2, '0')}:00`;
  const maximumDistance = formatTrackDistance(
    TRACK_WEATHER_TIMELINE_MAXIMUM_DISTANCE_METERS,
    i18n,
  );
  const duration = formatTrackDuration(timeline.durationSeconds, i18n);
  const timelineCaption =
    timeline.status === 'too-long'
      ? t`Available for day hikes shorter than ${maximumDistance} and 10 hours.`
      : timeline.durationSource === 'recorded'
        ? t`Starting at ${startTime} at the recorded pace, ${duration} in total.`
        : t`Starting at ${startTime} at the estimated pace, about ${duration} in total.`;

  return (
    <Box component="section">
      <ButtonBase
        aria-label={t`Weather forecast`}
        aria-controls={detailsId}
        aria-expanded={expanded}
        onClick={() => {
          onPreferencesChange({ ...current, expanded: !expanded });
        }}
        sx={{
          width: '100%',
          minHeight: 44,
          justifyContent: 'space-between',
          px: 1,
          textAlign: 'left',
        }}
      >
        <Typography component="h3" variant="subtitle2">
          <Trans>Weather forecast</Trans>
        </Typography>
        <ExpandMoreIcon
          aria-hidden
          fontSize="small"
          sx={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: (theme) =>
              theme.transitions.create('transform', {
                duration: theme.transitions.duration.shortest,
              }),
          }}
        />
      </ButtonBase>
      {expanded ? (
        <Stack id={detailsId} spacing={1.5} sx={{ px: 1, pb: 1 }}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            aria-label={t`Forecast date`}
            value={selectedDate}
            onChange={(_event, value: string | null) => {
              if (value !== null) {
                onPreferencesChange({
                  ...current,
                  weekday: trackWeatherWeekday(value),
                });
              }
            }}
          >
            {dates.map((date) => (
              <ToggleButton
                key={date}
                value={date}
                aria-label={fullDateFormat.format(utcDate(date))}
                sx={{ flexDirection: 'column', px: 0, py: 0.5, lineHeight: 1.2 }}
              >
                <Box component="span" sx={{ fontWeight: 700 }}>
                  {weekdayFormat.format(utcDate(date))}
                </Box>
                <Box component="span">{Number(date.slice(8, 10))}</Box>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Stack spacing={1}>
            <Typography component="h4" variant="subtitle2">
              <Trans>By elevation</Trans>
            </Typography>
            <Stack role="list" aria-label={t`Forecast by elevation`} spacing={1}>
              {elevationCard(t`Highest`, elevationLocations.highest)}
              {elevationCard(t`Median`, elevationLocations.median)}
              {elevationCard(t`Lowest`, elevationLocations.lowest)}
            </Stack>
          </Stack>
          <Stack spacing={1}>
            <Typography component="h4" variant="subtitle2">
              <Trans>Along the route</Trans>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {timelineCaption}
            </Typography>
            {timeline.status === 'available' ? (
              <Stack role="list" aria-label={t`Forecast along the route`} spacing={1}>
                {timeline.checkpoints.map(checkpointCard)}
              </Stack>
            ) : null}
          </Stack>
        </Stack>
      ) : null}
    </Box>
  );
}
