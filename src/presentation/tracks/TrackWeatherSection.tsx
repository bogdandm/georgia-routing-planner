import { Trans, useLingui } from '@lingui/react/macro';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Skeleton,
  Slider,
  Stack,
  TextField,
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
import { useStore } from 'zustand';

import type { PointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import {
  TRACK_WEATHER_DEFAULT_START_HOUR,
  TRACK_WEATHER_LATEST_START_HOUR,
  TRACK_WEATHER_MAXIMUM_PACE_FACTOR,
  TRACK_WEATHER_MINIMUM_PACE_FACTOR,
  TRACK_WEATHER_PACE_FACTOR_STEP,
  TRACK_WEATHER_START_HOUR_STEP,
  TRACK_WEATHER_TIMELINE_MAXIMUM_DISTANCE_METERS,
  defaultTrackWeatherDate,
  defaultTrackWeatherPreferences,
  localCalendarDate,
  planTrackWeatherTimeline,
  selectTrackElevationLocations,
  summarizeTrackWeatherCheckpoint,
  trackWeatherDates,
  trackWeatherLocalTime,
  trackWeatherWeekday,
  type TrackElevationLocations,
  type TrackTimingRoute,
  type TrackWeatherCheckpoint,
  type TrackWeatherLocation,
  type TrackWeatherPreferences,
  type TrackWeatherTimelineSettings,
} from '@/application/weather/TrackWeatherForecast';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { ElevationProfile } from '@/domain/tracks/elevationProfile';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { requestWeatherForecast } from '@/presentation/map/mapInteractionStore';
import { useUiStore } from '@/presentation/shell/uiStore';
import { TrackSectionHeading } from '@/presentation/tracks/TrackSectionHeading';
import { TrackLightingSummary } from '@/presentation/tracks/TrackLighting';
import {
  parseIsoDate,
  showHikeDateOnMap,
  type TrackLightingView,
} from '@/presentation/tracks/useTrackLighting';
import { workspaceHashForTab } from '@/presentation/shell/workspaceTabLocation';
import type { TrackStatsMetrics } from '@/presentation/tracks/TrackSummary';
import {
  formatTrackDistance,
  formatTrackDuration,
  formatTrackElevation,
} from '@/presentation/tracks/trackFormatters';
import {
  DailyPeriodRow,
  WeatherForecastCard,
} from '@/presentation/weather/WeatherPanel';
import { useWeatherRetryOnResume } from '@/presentation/weather/useWeatherRetryOnResume';

type ForecastState =
  | { readonly status: 'ready'; readonly forecast: PointWeatherForecast }
  | { readonly status: 'error' };

/** Fits "Highest"-style titles; checkpoint cards only need a time and an elevation. */
const cardHeaderWidth = 76;
const checkpointHeaderWidth = 62;

function locationKey(location: TrackWeatherLocation): string {
  const [longitude, latitude] = location.coordinate;
  const elevation = location.elevationMeters;
  return `${longitude.toFixed(5)},${latitude.toFixed(5)},${elevation === undefined ? '' : Math.round(elevation).toString()}`;
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

/** `HH:mm` for a fractional local hour of the day. */
function formatStartHour(hour: number): string {
  const minutes = Math.round(hour * 60);
  return [Math.floor(minutes / 60), minutes % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

interface TrackWeatherSectionProps {
  readonly profile: ElevationProfile;
  readonly metrics: TrackStatsMetrics;
  readonly timingRoute: TrackTimingRoute;
  /** Null while the stored preferences load; the section then stays collapsed. */
  readonly preferences: TrackWeatherPreferences | null;
  readonly onPreferencesChange: (preferences: TrackWeatherPreferences) => void;
  /** This track's route start and pace; the workspace decides where they are kept. */
  readonly timelineSettings: TrackWeatherTimelineSettings;
  readonly onTimelineSettingsChange: (settings: TrackWeatherTimelineSettings) => void;
  /** The hike's date, sun, and terrain light; null while the route cannot be timed. */
  readonly lighting: TrackLightingView | null;
}

/**
 * Independent route timing controls and forecasts at the track's elevation points
 * and day-hike checkpoints. Only the weather section gates forecast requests.
 */
export function TrackWeatherSection({
  profile,
  metrics,
  timingRoute,
  preferences,
  onPreferencesChange,
  timelineSettings,
  onTimelineSettingsChange,
  lighting,
}: TrackWeatherSectionProps): ReactElement {
  const { i18n, t } = useLingui();
  const { clock, mapLayers, pointWeatherForecast } = useRuntimeServices();
  const current = preferences ?? defaultTrackWeatherPreferences;
  const expanded = preferences?.expanded ?? false;
  const timingExpanded = useUiStore(
    (state) => state.trackSectionExpanded.timing ?? true,
  );
  const elevationExpanded = useUiStore(
    (state) => state.trackSectionExpanded['weather-elevation'] ?? true,
  );
  const routeExpanded = useUiStore(
    (state) => state.trackSectionExpanded['weather-route'] ?? true,
  );
  const setSectionExpanded = useUiStore((state) => state.setTrackSectionExpanded);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setMobileWorkspaceOpen = useUiStore((state) => state.setMobileWorkspaceOpen);
  const setNavigationCollapsed = useUiStore((state) => state.setNavigationCollapsed);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const detailsId = `track-weather-${useId().replaceAll(':', '')}`;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const timingDetailsId = `${detailsId}-timing`;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const elevationDetailsId = `${detailsId}-elevation`;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const routeDetailsId = `${detailsId}-route`;
  const dates = useMemo(
    () => trackWeatherDates(localCalendarDate(clock.now())),
    [clock],
  );
  const selectedDate = defaultTrackWeatherDate(dates, current.weekday);
  const elevationLocations = useMemo(
    () => selectTrackElevationLocations(profile),
    [profile],
  );
  const { paceFactor } = timelineSettings;
  const defaultTimeMarkers = useStore(mapLayerStore, (state) => state.trackTimeMarkers);
  // Drafts show slider positions while dragging; only released values are stored. The
  // start draft already moves the checkpoint times, since it only reselects loaded
  // hours, while the pace waits for release so it does not start forecast requests.
  const [startDraft, setStartDraft] = useState<number | null>(null);
  const [paceDraft, setPaceDraft] = useState<number | null>(null);
  const startHour = startDraft ?? timelineSettings.startHour;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const paceLabelId = `${detailsId}-pace`;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const startLabelId = `${detailsId}-start`;
  const timeline = useMemo(
    () =>
      planTrackWeatherTimeline(timingRoute, metrics, {
        paceFactor,
        ignoreRecordedTime: timelineSettings.ignoreRecordedTime,
      }),
    [metrics, paceFactor, timingRoute, timelineSettings.ignoreRecordedTime],
  );
  const timeMarkers = timelineSettings.timeMarkers ?? defaultTimeMarkers;
  const timelineCheckbox = (
    label: string,
    checked: boolean,
    change: (checked: boolean) => TrackWeatherTimelineSettings,
    disabled = false,
  ) => (
    <FormControlLabel
      sx={{ m: 0 }}
      slotProps={{ typography: { variant: 'body2' } }}
      disabled={disabled}
      control={
        <Checkbox
          size="small"
          sx={{ p: 0, mr: 1 }}
          checked={checked}
          onChange={(event) => {
            onTimelineSettingsChange(change(event.target.checked));
          }}
        />
      }
      label={label}
    />
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
  // Keys with a request in flight or a loaded forecast. Failed keys are released, so
  // the next expand or retry revision requests only them again.
  const requestedKeys = useRef(new Set<string>());
  const [retryRevision, setRetryRevision] = useState(0);

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
          location.elevationMeters === undefined
            ? { coordinate: { longitude, latitude } }
            : {
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
  }, [expanded, locations, pointWeatherForecast, retryRevision]);

  useWeatherRetryOnResume(
    expanded &&
      locations.some(
        (location) => forecasts.get(locationKey(location))?.status === 'error',
      ),
    () => {
      setRetryRevision((revision) => revision + 1);
    },
  );

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

  /** Loads the full forecast for this track location in the Weather tab. */
  const openInWeather = (location: TrackWeatherLocation, placeLabel: string) => {
    const [longitude, latitude] = location.coordinate;
    requestWeatherForecast(
      { longitude, latitude },
      placeLabel,
      location.elevationMeters,
    );
    setActiveTab('weather');
    setMobileWorkspaceOpen(true);
    setNavigationCollapsed(false);
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = workspaceHashForTab('weather');
    window.history.pushState(window.history.state, '', nextUrl);
  };

  const elevationCard = (
    title: string,
    location: TrackElevationLocations['highest'],
  ) => {
    const elevation = formatTrackElevation(location.elevationMeters, i18n);
    const state = forecastFor(location);
    const day =
      state?.status === 'ready'
        ? state.forecast.days.find((value) => value.date === selectedDate)
        : undefined;
    const label = [title, elevation].join(', ');
    return (
      <Box key={title} role="listitem">
        <WeatherForecastCard
          label={label}
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
              stacked
              openLabel={t`Open the forecast for ${label} in Weather`}
              onOpen={() => {
                openInWeather(location, title);
              }}
            />
          )}
        </WeatherForecastCard>
      </Box>
    );
  };

  const checkpointCard = (checkpoint: TrackWeatherCheckpoint) => {
    const time = trackWeatherLocalTime(
      selectedDate,
      startHour,
      checkpoint.elapsedSeconds,
    ).slice(11, 16);
    const state = forecastFor(checkpoint);
    const elevationMeters =
      checkpoint.elevationMeters ??
      (state?.status === 'ready' ? state.forecast.elevationMeters : undefined);
    const elevation =
      elevationMeters !== undefined
        ? formatTrackElevation(elevationMeters, i18n)
        : state === undefined
          ? t`Loading elevation…`
          : t`Elevation unavailable`;
    const distance = formatTrackDistance(checkpoint.distanceMeters, i18n);
    const place =
      checkpoint.kind === 'start'
        ? t`Start`
        : checkpoint.kind === 'finish'
          ? t`Finish`
          : t`At ${distance}`;
    const summary =
      state?.status === 'ready'
        ? summarizeTrackWeatherCheckpoint(
            state.forecast,
            selectedDate,
            startHour,
            checkpoint,
          )
        : null;
    const label = [time, place, elevation].join(', ');
    return (
      <Box key={checkpoint.elapsedSeconds} role="listitem">
        <WeatherForecastCard
          label={label}
          title={time}
          subtitle={elevation}
          headerWidth={checkpointHeaderWidth}
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
              stacked
              openLabel={t`Open the forecast for ${label} in Weather`}
              onOpen={() => {
                openInWeather(checkpoint, [time, place].join(', '));
              }}
            />
          )}
        </WeatherForecastCard>
      </Box>
    );
  };

  const startTime = formatStartHour(startHour);
  const maximumDistance = formatTrackDistance(
    TRACK_WEATHER_TIMELINE_MAXIMUM_DISTANCE_METERS,
    i18n,
  );
  const duration = formatTrackDuration(timeline.durationSeconds, i18n);
  const timelineCaption =
    paceFactor !== 1
      ? t`Starting at ${startTime} at the adjusted pace, about ${duration} in total.`
      : timeline.durationSource === 'recorded'
        ? t`Starting at ${startTime} at the recorded pace, ${duration} in total.`
        : t`Starting at ${startTime} at the estimated pace, about ${duration} in total.`;
  const paceFormat = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 2 });
  const formatPace = (value: number) => `×${paceFormat.format(value)}`;
  /**
   * A hike date within the forecast week selects that forecast date, so both stay in
   * step; any other date is stored as the track's own. The map shows its light.
   */
  const changeHikeDate = (date: string) => {
    if (lighting === null) return;
    const next = parseIsoDate(date) === null ? selectedDate : date;
    if (dates.includes(next)) {
      if (next !== selectedDate) {
        onPreferencesChange({ ...current, weekday: trackWeatherWeekday(next) });
      }
      if (timelineSettings.hikeDate !== null) {
        onTimelineSettingsChange({ ...timelineSettings, hikeDate: null });
      }
    } else {
      onTimelineSettingsChange({ ...timelineSettings, hikeDate: next });
    }
    showHikeDateOnMap(mapLayers, next, lighting.timeZone);
  };
  const today = dates[0];

  return (
    <>
      <Box component="section">
        <TrackSectionHeading
          title={t`Route timing`}
          detailsId={timingDetailsId}
          expanded={timingExpanded}
          onToggle={() => {
            setSectionExpanded('timing', !timingExpanded);
          }}
        />
        {timingExpanded ? (
          <Stack id={timingDetailsId} spacing={1} sx={{ px: 1, pb: 2 }}>
            {timelineCheckbox(t`Show times on the map`, timeMarkers, (checked) => ({
              ...timelineSettings,
              timeMarkers: checked,
            }))}
            {timelineCheckbox(
              t`Count map times from 00:00 at the start`,
              timelineSettings.relativeTimeMarkers,
              (checked) => ({ ...timelineSettings, relativeTimeMarkers: checked }),
              !timeMarkers,
            )}
            {timelineCheckbox(
              t`Ignore recorded time`,
              timelineSettings.ignoreRecordedTime,
              (checked) => ({ ...timelineSettings, ignoreRecordedTime: checked }),
              metrics.elapsedSeconds === undefined,
            )}
            {lighting === null ? null : (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pt: 1 }}>
                <TextField
                  label={t`Hike date`}
                  onChange={(event) => {
                    changeHikeDate(event.target.value);
                  }}
                  size="small"
                  sx={{ flex: 1 }}
                  type="date"
                  value={lighting.date}
                />
                <Button
                  disabled={today === undefined || lighting.date === today}
                  onClick={() => {
                    if (today !== undefined) changeHikeDate(today);
                  }}
                  size="small"
                  variant="outlined"
                >
                  {t`Today`}
                </Button>
                {lighting.recordedDate === null ? null : (
                  <Button
                    disabled={lighting.date === lighting.recordedDate}
                    onClick={() => {
                      if (lighting.recordedDate !== null) {
                        changeHikeDate(lighting.recordedDate);
                      }
                    }}
                    size="small"
                    variant="outlined"
                  >
                    {t`Recording date`}
                  </Button>
                )}
              </Stack>
            )}
            <Box>
              <Typography id={startLabelId} variant="caption" color="text.secondary">
                <Trans>Route start</Trans>
              </Typography>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', px: 0.5 }}
              >
                <Typography variant="caption" color="text.secondary">
                  {formatStartHour(0)}
                </Typography>
                <Slider
                  size="small"
                  aria-labelledby={startLabelId}
                  min={0}
                  max={TRACK_WEATHER_LATEST_START_HOUR}
                  step={TRACK_WEATHER_START_HOUR_STEP}
                  marks={[{ value: TRACK_WEATHER_DEFAULT_START_HOUR }]}
                  value={startHour}
                  valueLabelDisplay="auto"
                  valueLabelFormat={formatStartHour}
                  getAriaValueText={formatStartHour}
                  onChange={(_event, value) => {
                    setStartDraft(value);
                  }}
                  onChangeCommitted={(_event, value) => {
                    setStartDraft(null);
                    onTimelineSettingsChange({
                      ...timelineSettings,
                      startHour: value,
                    });
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {formatStartHour(TRACK_WEATHER_LATEST_START_HOUR)}
                </Typography>
              </Stack>
            </Box>
            <Box>
              <Typography id={paceLabelId} variant="caption" color="text.secondary">
                <Trans>Adjust pace</Trans>
              </Typography>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', px: 0.5 }}
              >
                <Typography variant="caption" color="text.secondary">
                  <Trans>Faster</Trans>
                </Typography>
                <Slider
                  size="small"
                  aria-labelledby={paceLabelId}
                  min={TRACK_WEATHER_MINIMUM_PACE_FACTOR}
                  max={TRACK_WEATHER_MAXIMUM_PACE_FACTOR}
                  step={TRACK_WEATHER_PACE_FACTOR_STEP}
                  marks={[{ value: 1 }]}
                  value={paceDraft ?? paceFactor}
                  valueLabelDisplay="auto"
                  valueLabelFormat={formatPace}
                  getAriaValueText={formatPace}
                  onChange={(_event, value) => {
                    setPaceDraft(value);
                  }}
                  onChangeCommitted={(_event, value) => {
                    setPaceDraft(null);
                    // Keyboard steps accumulate floating-point error (×0.5 plus ten
                    // steps is 1.0000000000000004); hundredths keep exact steps.
                    onTimelineSettingsChange({
                      ...timelineSettings,
                      paceFactor: Math.round(value * 100) / 100,
                    });
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  <Trans>Slower</Trans>
                </Typography>
              </Stack>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {timelineCaption}
            </Typography>
            {lighting === null ? null : <TrackLightingSummary lighting={lighting} />}
          </Stack>
        ) : null}
      </Box>
      <Box component="section" data-tour="track-weather">
        <TrackSectionHeading
          title={t`Weather forecast`}
          detailsId={detailsId}
          expanded={expanded}
          onToggle={() => {
            onPreferencesChange({ ...current, expanded: !expanded });
          }}
        />
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
              <TrackSectionHeading
                title={t`By elevation`}
                detailsId={elevationDetailsId}
                expanded={elevationExpanded}
                onToggle={() => {
                  setSectionExpanded('weather-elevation', !elevationExpanded);
                }}
                nested
              />
              {elevationExpanded ? (
                <Stack
                  id={elevationDetailsId}
                  role="list"
                  aria-label={t`Forecast by elevation`}
                  spacing={1}
                >
                  {elevationCard(t`Highest`, elevationLocations.highest)}
                  {elevationCard(t`Median`, elevationLocations.median)}
                  {elevationCard(t`Lowest`, elevationLocations.lowest)}
                </Stack>
              ) : null}
            </Stack>
            <Stack spacing={1}>
              <TrackSectionHeading
                title={t`Along the route`}
                detailsId={routeDetailsId}
                expanded={routeExpanded}
                onToggle={() => {
                  setSectionExpanded('weather-route', !routeExpanded);
                }}
                nested
              />
              {routeExpanded ? (
                <Box id={routeDetailsId}>
                  {timeline.status === 'available' ? (
                    <Stack
                      role="list"
                      aria-label={t`Forecast along the route`}
                      spacing={1}
                    >
                      {timeline.checkpoints.map(checkpointCard)}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      <Trans>
                        Available for day hikes shorter than {maximumDistance} and 12
                        hours.
                      </Trans>
                    </Typography>
                  )}
                </Box>
              ) : null}
            </Stack>
          </Stack>
        ) : null}
      </Box>
    </>
  );
}
