import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import ChangeHistoryOutlinedIcon from '@mui/icons-material/ChangeHistoryOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import TerrainOutlinedIcon from '@mui/icons-material/TerrainOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import {
  Box,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip as MuiTooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { useCallback, useId, useMemo, useState, type ReactElement } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type MouseHandlerDataParam,
  type TooltipContentProps,
} from 'recharts';

import {
  elevationSegmentIndexForSample,
  sampleElevationProfilePoints,
  type ElevationProfile,
  type ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import {
  recordedElapsedSeconds,
  smoothSpeed,
  smoothedSpeedAt,
  type SmoothedSpeed,
} from '@/domain/tracks/profileTiming';
import type { TrackElevationPreparationProgress } from '@/application/tracks/prepareImportedTrack';
import { appColors } from '@/presentation/theme/appColors';
import {
  formatTrackDistance,
  formatTrackDuration,
  formatTrackElevation,
  formatTrackGrade,
  formatTrackSpeed,
} from '@/presentation/tracks/trackFormatters';

const HOVER_GRADE_SMOOTHING_RADIUS_METERS = 150;
const MAXIMUM_TIME_TICK_INTERVALS = 6;
const TIME_TICK_STEPS_SECONDS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800, 3_600, 7_200, 10_800, 21_600,
  43_200, 86_400,
];

type ProfileMetric = 'elevation' | 'speed';
type ProfileAxis = 'distance' | 'time';

/** Recorded time per profile point and the smoothed speed derived from it. */
interface ProfileTimeline {
  readonly elapsedSeconds: readonly number[];
  readonly speed: SmoothedSpeed;
}

function profileTimeline(profile: ElevationProfile): ProfileTimeline | null {
  const elapsedSeconds = recordedElapsedSeconds(profile.points);
  if (elapsedSeconds === null) return null;
  return { elapsedSeconds, speed: smoothSpeed(profile.points, elapsedSeconds) };
}

/**
 * One plotted vertex. Speed rows inside a recording gap, such as an auto-paused stop,
 * stay pinned to the fix before the gap so hover and click still reach a real point.
 */
interface ProfileChartRow {
  readonly point: ElevationProfilePoint;
  readonly distanceMeters: number;
  readonly elevationMeters: number;
  readonly elapsedSeconds: number | null;
  readonly speedKilometersPerHour: number | null;
}

function profileChartRows(
  sampledPoints: readonly ElevationProfilePoint[],
  timeline: ProfileTimeline | null,
  fillRecordingGaps: boolean,
): readonly ProfileChartRow[] {
  const rows: ProfileChartRow[] = [];
  let previous: { point: ElevationProfilePoint; elapsedSeconds: number } | undefined;
  for (const point of sampledPoints) {
    const elapsedSeconds = timeline?.elapsedSeconds[point.sampleIndex] ?? null;
    if (timeline === null || elapsedSeconds === null) {
      rows.push({
        point,
        distanceMeters: point.distanceMeters,
        elevationMeters: point.elevationMeters,
        elapsedSeconds: null,
        speedKilometersPerHour: null,
      });
      continue;
    }
    const step = timeline.speed.cellSeconds;
    if (
      fillRecordingGaps &&
      previous !== undefined &&
      elapsedSeconds - previous.elapsedSeconds > 2 * step
    ) {
      const gapStart = previous.elapsedSeconds;
      const gapDistance = point.distanceMeters - previous.point.distanceMeters;
      for (
        let seconds = gapStart + step;
        seconds < elapsedSeconds - step / 2;
        seconds += step
      ) {
        rows.push({
          point: previous.point,
          distanceMeters:
            previous.point.distanceMeters +
            (gapDistance * (seconds - gapStart)) / (elapsedSeconds - gapStart),
          elevationMeters: previous.point.elevationMeters,
          elapsedSeconds: seconds,
          speedKilometersPerHour: smoothedSpeedAt(timeline.speed, seconds) * 3.6,
        });
      }
    }
    rows.push({
      point,
      distanceMeters: point.distanceMeters,
      elevationMeters: point.elevationMeters,
      elapsedSeconds,
      speedKilometersPerHour: smoothedSpeedAt(timeline.speed, elapsedSeconds) * 3.6,
    });
    previous = { point, elapsedSeconds };
  }
  return rows;
}

/** Round elapsed-time ticks such as 0:30, 1:00, 1:30 instead of arbitrary seconds. */
function timeAxisTicks(totalSeconds: number): {
  readonly values: readonly number[];
  readonly stepSeconds: number;
} {
  const stepSeconds =
    TIME_TICK_STEPS_SECONDS.find(
      (step) => totalSeconds / step <= MAXIMUM_TIME_TICK_INTERVALS,
    ) ?? Math.ceil(totalSeconds / MAXIMUM_TIME_TICK_INTERVALS / 86_400) * 86_400;
  const values: number[] = [];
  for (let seconds = 0; seconds <= totalSeconds; seconds += stepSeconds) {
    values.push(seconds);
  }
  return { values, stepSeconds };
}

/** `h:mm`, or `m:ss` when ticks are less than a minute apart. */
function formatElapsedTick(seconds: number, stepSeconds: number): string {
  const [major, minor] =
    stepSeconds < 60
      ? [Math.floor(seconds / 60), Math.round(seconds % 60)]
      : [Math.floor(seconds / 3_600), Math.round((seconds % 3_600) / 60)];
  return `${String(major)}:${String(minor).padStart(2, '0')}`;
}

interface ElevationProfileChartProps {
  readonly profile: ElevationProfile;
  readonly showHeading?: boolean;
  readonly activeSegmentIndex: number | null;
  readonly selectedSegmentIndex: number | null;
  readonly trackGradeLegendDismissed: boolean;
  readonly onActivePointChange?: (point: ElevationProfilePoint | null) => void;
  readonly onSegmentHoverChange: (index: number | null) => void;
  readonly onSegmentSelectionChange: (index: number | null) => void;
  readonly onTrackGradeLegendDismissedChange: (dismissed: boolean) => void;
  readonly onPointClick?: (point: ElevationProfilePoint) => void;
}

function activeChartRow(
  activeIndex: unknown,
  rows: readonly ProfileChartRow[],
): ProfileChartRow | null {
  const rowIndex = Number(activeIndex);
  if (!Number.isInteger(rowIndex)) return null;
  return rows[rowIndex] ?? null;
}

function activeProfilePoint(
  { activeIndex, isTooltipActive }: MouseHandlerDataParam,
  rows: readonly ProfileChartRow[],
): ElevationProfilePoint | null {
  if (!isTooltipActive) return null;
  return activeChartRow(activeIndex, rows)?.point ?? null;
}

function smoothedHoverGradePct(
  profile: ElevationProfile,
  point: ElevationProfilePoint,
): number {
  const target = profile.points[point.sampleIndex];
  if (target?.sampleIndex !== point.sampleIndex) {
    return point.localGradePct;
  }

  let weightedGradeSum = target.localGradePct;
  let weightSum = 1;
  for (
    let candidateIndex = point.sampleIndex - 1;
    candidateIndex >= 0;
    candidateIndex -= 1
  ) {
    const candidate = profile.points[candidateIndex];
    if (candidate?.sourceSegmentIndex !== target.sourceSegmentIndex) {
      break;
    }
    const distanceMeters = Math.abs(candidate.distanceMeters - target.distanceMeters);
    if (distanceMeters > HOVER_GRADE_SMOOTHING_RADIUS_METERS) {
      break;
    }
    const weight = 1 - distanceMeters / HOVER_GRADE_SMOOTHING_RADIUS_METERS;
    weightedGradeSum += candidate.localGradePct * weight;
    weightSum += weight;
  }
  for (
    let candidateIndex = point.sampleIndex + 1;
    candidateIndex < profile.points.length;
    candidateIndex += 1
  ) {
    const candidate = profile.points[candidateIndex];
    if (candidate?.sourceSegmentIndex !== target.sourceSegmentIndex) {
      break;
    }
    const distanceMeters = Math.abs(candidate.distanceMeters - target.distanceMeters);
    if (distanceMeters > HOVER_GRADE_SMOOTHING_RADIUS_METERS) {
      break;
    }
    const weight = 1 - distanceMeters / HOVER_GRADE_SMOOTHING_RADIUS_METERS;
    weightedGradeSum += candidate.localGradePct * weight;
    weightSum += weight;
  }

  return weightSum === 0 ? point.localGradePct : weightedGradeSum / weightSum;
}

interface ElevationTooltipProps extends TooltipContentProps {
  readonly profile: ElevationProfile;
  readonly rows: readonly ProfileChartRow[];
  readonly metric: ProfileMetric;
}

function ElevationTooltip({
  active,
  activeIndex,
  profile,
  rows,
  metric,
}: ElevationTooltipProps): ReactElement | null {
  const { i18n, t } = useLingui();
  const row = active ? activeChartRow(activeIndex, rows) : null;
  if (row === null) return null;
  const { point, elapsedSeconds, speedKilometersPerHour } = row;
  const segmentIndex = elevationSegmentIndexForSample(profile, point.sampleIndex);
  const segment = segmentIndex === null ? undefined : profile.segments[segmentIndex];
  if (segment === undefined) return null;
  const hoverGradePct = smoothedHoverGradePct(profile, point);
  let typeLabel: string;
  if (segment.type === 'flat') {
    typeLabel = t`Flat`;
  } else {
    const typeNumber = profile.segments
      .slice(0, (segmentIndex ?? 0) + 1)
      .filter((candidate) => candidate.type === segment.type).length;
    typeLabel =
      segment.type === 'climb' ? t`Climb ${typeNumber}` : t`Descent ${typeNumber}`;
  }

  const pointRowSx = {
    alignItems: 'center',
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value.
    flexWrap: 'wrap',
    columnGap: 1.5,
    rowGap: 0.25,
  } as const;
  const distance = (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <SwapHorizIcon aria-hidden sx={{ fontSize: 16 }} />
      <Typography variant="caption">
        {formatTrackDistance(row.distanceMeters, i18n)}
      </Typography>
    </Stack>
  );
  const elevationAndGrade = (
    <>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <TerrainOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
        <Typography variant={metric === 'elevation' ? 'body2' : 'caption'}>
          {formatTrackElevation(row.elevationMeters, i18n)}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <ChangeHistoryOutlinedIcon
          aria-hidden
          sx={{
            fontSize: 16,
            transform: hoverGradePct < 0 ? 'rotate(180deg)' : undefined,
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {formatTrackGrade(hoverGradePct, i18n)}
        </Typography>
      </Stack>
    </>
  );

  return (
    <Paper elevation={3} sx={{ p: 1, minWidth: 210 }}>
      <Stack spacing={0.4}>
        {elapsedSeconds === null || speedKilometersPerHour === null ? (
          <Stack direction="row" sx={pointRowSx}>
            {distance}
            {elevationAndGrade}
          </Stack>
        ) : (
          // Timed tracks add two values, so elevation and grade move to a second line.
          <>
            <Stack direction="row" sx={pointRowSx}>
              {distance}
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <TimerOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
                <Typography variant="caption">
                  {formatTrackDuration(elapsedSeconds, i18n)}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <SpeedOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
                <Typography variant={metric === 'speed' ? 'body2' : 'caption'}>
                  {formatTrackSpeed(speedKilometersPerHour, i18n)}
                </Typography>
              </Stack>
            </Stack>
            <Stack direction="row" sx={pointRowSx}>
              {elevationAndGrade}
            </Stack>
          </>
        )}
        <Typography variant="body2" sx={{ pt: 0.35, fontWeight: 600 }}>
          {typeLabel}
        </Typography>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1.5,
            rowGap: 0.25,
          }}
        >
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <SwapHorizIcon aria-hidden sx={{ fontSize: 16 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {formatTrackDistance(segment.distanceMeters, i18n)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <NorthEastIcon aria-hidden sx={{ fontSize: 16 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {formatTrackElevation(segment.ascentMeters, i18n)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <SouthEastIcon aria-hidden sx={{ fontSize: 16 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {formatTrackElevation(segment.descentMeters, i18n)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <ChangeHistoryOutlinedIcon
              aria-hidden
              sx={{
                fontSize: 16,
                transform: segment.averageGradePct < 0 ? 'rotate(180deg)' : undefined,
              }}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {formatTrackGrade(segment.averageGradePct, i18n)}
            </Typography>
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  );
}

interface ElevationProfileAreaProps {
  readonly profile: ElevationProfile;
  readonly gradientId: string;
  readonly activeSegmentIndex: number | null;
  readonly metric: ProfileMetric;
  /** Horizontal position of a profile sample; the axis starts at zero. */
  readonly xOfSample: (sampleIndex: number) => number;
}

function ElevationProfileArea({
  profile,
  gradientId,
  activeSegmentIndex,
  metric,
  xOfSample,
}: ElevationProfileAreaProps): ReactElement {
  const { t } = useLingui();
  const maximumX = xOfSample(profile.points.length - 1);

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          {profile.segments.flatMap((segment, segmentIndex) =>
            segment.gradeSubsegments.flatMap((gradeSegment) => {
              const startOffset =
                maximumX <= 0
                  ? 0
                  : (xOfSample(gradeSegment.startSampleIndex) / maximumX) * 100;
              const endOffset =
                maximumX <= 0
                  ? 0
                  : (xOfSample(gradeSegment.endSampleIndex) / maximumX) * 100;
              const color = appColors.elevationGrade[gradeSegment.band];
              const opacity =
                activeSegmentIndex === null || activeSegmentIndex === segmentIndex
                  ? 1
                  : 0.22;
              const key = `${String(segmentIndex)}:${String(gradeSegment.startSampleIndex)}`;
              return [
                <stop
                  key={`${key}:start`}
                  offset={`${String(startOffset)}%`}
                  stopColor={color}
                  stopOpacity={opacity}
                />,
                <stop
                  key={`${key}:end`}
                  offset={`${String(endOffset)}%`}
                  stopColor={color}
                  stopOpacity={opacity}
                />,
              ];
            }),
          )}
        </linearGradient>
      </defs>
      <Area
        type="linear"
        /* eslint-disable lingui/no-unlocalized-strings -- Recharts data keys and domain token. */
        dataKey={metric === 'speed' ? 'speedKilometersPerHour' : 'elevationMeters'}
        name={metric === 'speed' ? t`Speed` : t`Elevation`}
        baseValue={metric === 'speed' ? 0 : 'dataMin'}
        /* eslint-enable lingui/no-unlocalized-strings */
        dot={false}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG paint reference.
        stroke={`url(#${gradientId})`}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG paint reference.
        fill={`url(#${gradientId})`}
        fillOpacity={0.2}
        isAnimationActive={false}
      />
    </>
  );
}

export function ElevationPreparationChart({
  progress,
  showProgressStatus = true,
}: {
  readonly progress: TrackElevationPreparationProgress | null;
  readonly showProgressStatus?: boolean;
}): ReactElement {
  const { i18n, t } = useLingui();
  const theme = useTheme();
  const totalSamples = progress?.totalSamples ?? 0;
  const completedFraction =
    totalSamples > 0 ? (progress?.completedSamples ?? 0) / totalSamples : null;
  const percent =
    completedFraction === null
      ? null
      : new Intl.NumberFormat(i18n.locale, {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option token.
          style: 'percent',
        }).format(Math.floor(completedFraction * 100) / 100);
  const label =
    percent === null ? t`Preparing elevation…` : t`Loading elevation: ${percent}`;
  const accessibilityLabel =
    percent === null
      ? t`Elevation profile loading`
      : t`Elevation profile loading: ${percent}`;

  return (
    <Stack spacing={1.5}>
      <Typography component="h3" variant="subtitle2">
        <Trans>Elevation profile</Trans>
      </Typography>
      {showProgressStatus ? (
        <Stack spacing={0.75}>
          <LinearProgress
            variant={completedFraction === null ? 'indeterminate' : 'determinate'}
            value={completedFraction === null ? undefined : completedFraction * 100}
          />
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        </Stack>
      ) : null}
      <Box role="img" aria-label={accessibilityLabel} sx={{ height: 264, mx: -1 }}>
        <AreaChart<TrackElevationPreparationProgress['points'][number]>
          aria-hidden
          accessibilityLayer={false}
          responsive
          data={progress?.points ?? []}
          margin={{ top: 12, right: 16, bottom: 6, left: 4 }}
          style={{ width: '100%', height: '100%' }}
        >
          <CartesianGrid stroke={theme.palette.divider} />
          <XAxis
            hide
            type="number"
            /* eslint-disable lingui/no-unlocalized-strings -- Recharts data key and domain tokens. */
            dataKey="distanceMeters"
            domain={['dataMin', 'dataMax']}
            /* eslint-enable lingui/no-unlocalized-strings */
          />
          <YAxis
            hide
            type="number"
            /* eslint-disable lingui/no-unlocalized-strings -- Recharts data key and domain tokens. */
            dataKey="elevationMeters"
            domain={['auto', 'auto']}
            /* eslint-enable lingui/no-unlocalized-strings */
          />
          <Area
            type="linear"
            // eslint-disable-next-line lingui/no-unlocalized-strings -- Recharts data key.
            dataKey="elevationMeters"
            name={t`Elevation`}
            // eslint-disable-next-line lingui/no-unlocalized-strings -- Recharts domain token.
            baseValue="dataMin"
            dot={false}
            stroke={appColors.elevationGrade.flat}
            fill={appColors.elevationGrade.flat}
            fillOpacity={0.2}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </Box>
    </Stack>
  );
}

export function ElevationProfileChart({
  profile,
  showHeading = true,
  activeSegmentIndex,
  selectedSegmentIndex,
  trackGradeLegendDismissed,
  onActivePointChange,
  onSegmentHoverChange,
  onSegmentSelectionChange,
  onTrackGradeLegendDismissedChange,
  onPointClick,
}: ElevationProfileChartProps): ReactElement {
  const { i18n, t } = useLingui();
  const theme = useTheme();
  const sampledPoints = useMemo(() => sampleElevationProfilePoints(profile), [profile]);
  const timeline = useMemo(() => profileTimeline(profile), [profile]);
  // Plain component state: the chart remembers the view only while it stays mounted.
  /* eslint-disable lingui/no-unlocalized-strings -- Profile view tokens. */
  const [selectedMetric, setSelectedMetric] = useState<ProfileMetric>('elevation');
  const [selectedAxis, setSelectedAxis] = useState<ProfileAxis>('distance');
  // Tracks without recorded time fall back to elevation over distance.
  const metric: ProfileMetric = timeline === null ? 'elevation' : selectedMetric;
  const axis: ProfileAxis = timeline === null ? 'distance' : selectedAxis;
  /* eslint-enable lingui/no-unlocalized-strings */
  const rows = useMemo(
    () => profileChartRows(sampledPoints, timeline, metric === 'speed'),
    [sampledPoints, timeline, metric],
  );
  const elapsedSeconds = axis === 'time' ? (timeline?.elapsedSeconds ?? null) : null;
  const xOfSample = useCallback(
    (sampleIndex: number): number =>
      (elapsedSeconds === null
        ? profile.points[sampleIndex]?.distanceMeters
        : elapsedSeconds[sampleIndex]) ?? 0,
    [elapsedSeconds, profile],
  );
  const timeTicks = useMemo(
    () => (elapsedSeconds === null ? null : timeAxisTicks(elapsedSeconds.at(-1) ?? 0)),
    [elapsedSeconds],
  );
  // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG element ID.
  const gradientId = `elevation-grade-${useId().replaceAll(':', '')}`;
  const axisDistanceFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [i18n.locale],
  );
  let profileLabel: string;
  if (metric === 'elevation') {
    const minimumElevation = new Intl.NumberFormat(i18n.locale).format(
      Math.round(profile.minimumMeters),
    );
    const maximumElevationMeters = Math.round(profile.maximumMeters);
    profileLabel = t`${plural(maximumElevationMeters, {
      one: `Elevation profile from ${minimumElevation} to # metre`,
      other: `Elevation profile from ${minimumElevation} to # metres`,
    })}`;
  } else {
    const maximumSpeed = formatTrackSpeed(
      rows.reduce(
        (maximum, row) => Math.max(maximum, row.speedKilometersPerHour ?? 0),
        0,
      ),
      i18n,
    );
    profileLabel = t`Speed profile up to ${maximumSpeed}`;
  }
  const axisText = useMemo(
    () => ({
      fill: theme.palette.text.secondary,
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.caption.fontSize,
    }),
    [
      theme.palette.text.secondary,
      theme.typography.fontFamily,
      theme.typography.caption.fontSize,
    ],
  );
  const tooltipContent = useCallback(
    (props: TooltipContentProps) => (
      <ElevationTooltip {...props} profile={profile} rows={rows} metric={metric} />
    ),
    [profile, rows, metric],
  );

  function publishActivePoint(
    mouseHandlerData: MouseHandlerDataParam,
  ): ElevationProfilePoint | null {
    const point = activeProfilePoint(mouseHandlerData, rows);
    onActivePointChange?.(point);
    onSegmentHoverChange(
      point === null
        ? null
        : elevationSegmentIndexForSample(profile, point.sampleIndex),
    );
    return point;
  }

  return (
    <Stack spacing={1.5} data-tour="track-profile">
      {showHeading ? (
        <Box sx={{ position: 'relative' }}>
          <Typography component="h3" variant="subtitle2">
            {metric === 'speed' ? (
              <Trans>Speed profile</Trans>
            ) : (
              <Trans>Elevation profile</Trans>
            )}
          </Typography>
          {trackGradeLegendDismissed ? (
            <MuiTooltip title={t`Show track grade legend`}>
              <IconButton
                aria-label={t`Show track grade legend`}
                onClick={() => {
                  onTrackGradeLegendDismissedChange(false);
                }}
                size="small"
                sx={{
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              >
                <HelpOutlineOutlinedIcon fontSize="small" />
              </IconButton>
            </MuiTooltip>
          ) : null}
        </Box>
      ) : null}
      <Box role="img" aria-label={profileLabel} sx={{ height: 264, mx: -1 }}>
        <AreaChart<ProfileChartRow>
          aria-hidden
          accessibilityLayer={false}
          responsive
          data={rows}
          margin={{ top: 12, right: 16, bottom: 6, left: 4 }}
          style={{ width: '100%', height: '100%' }}
          onMouseMove={publishActivePoint}
          onClick={(mouseHandlerData) => {
            const point = activeProfilePoint(mouseHandlerData, rows);
            if (point === null) return;
            const segmentIndex = elevationSegmentIndexForSample(
              profile,
              point.sampleIndex,
            );
            if (
              segmentIndex === null ||
              profile.segments[segmentIndex]?.type === 'flat'
            ) {
              onSegmentSelectionChange(null);
            } else {
              onSegmentSelectionChange(
                selectedSegmentIndex === segmentIndex ? null : segmentIndex,
              );
            }
            onPointClick?.(point);
          }}
          onMouseLeave={() => {
            onActivePointChange?.(null);
            onSegmentHoverChange(null);
          }}
        >
          <CartesianGrid stroke={theme.palette.divider} />
          <XAxis
            type="number"
            /* eslint-disable lingui/no-unlocalized-strings -- Recharts data keys and domain tokens. */
            dataKey={axis === 'time' ? 'elapsedSeconds' : 'distanceMeters'}
            domain={['dataMin', 'dataMax']}
            /* eslint-enable lingui/no-unlocalized-strings */
            {...(timeTicks === null ? {} : { ticks: timeTicks.values })}
            height={32}
            tick={axisText}
            tickFormatter={(value: number) => {
              if (timeTicks !== null)
                return formatElapsedTick(value, timeTicks.stepSeconds);
              const distance = axisDistanceFormatter.format(value / 1_000);
              return t`${distance} km`;
            }}
          />
          <YAxis
            type="number"
            /* eslint-disable lingui/no-unlocalized-strings -- Recharts data keys and domain tokens. */
            dataKey={metric === 'speed' ? 'speedKilometersPerHour' : 'elevationMeters'}
            domain={metric === 'speed' ? [0, 'auto'] : ['auto', 'auto']}
            /* eslint-enable lingui/no-unlocalized-strings */
            width={64}
            tick={axisText}
            tickFormatter={(value: number) =>
              metric === 'speed'
                ? formatTrackSpeed(value, i18n)
                : formatTrackElevation(value, i18n)
            }
          />
          <Tooltip
            cursor={{ stroke: theme.palette.text.secondary, strokeWidth: 1 }}
            content={tooltipContent}
          />
          {profile.segments.slice(1).map((segment) => (
            <ReferenceLine
              key={segment.startSampleIndex}
              x={xOfSample(segment.startSampleIndex)}
              stroke={theme.palette.divider}
              strokeWidth={1}
            />
          ))}
          <ElevationProfileArea
            profile={profile}
            gradientId={gradientId}
            activeSegmentIndex={activeSegmentIndex}
            metric={metric}
            xOfSample={xOfSample}
          />
        </AreaChart>
      </Box>
      {showHeading && timeline !== null ? (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            aria-label={t`Profile value`}
            value={selectedMetric}
            onChange={(_event, value: ProfileMetric | null) => {
              if (value !== null) setSelectedMetric(value);
            }}
          >
            <ToggleButton value="elevation">
              <Trans>Elevation</Trans>
            </ToggleButton>
            <ToggleButton value="speed">
              <Trans>Speed</Trans>
            </ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup
            exclusive
            size="small"
            aria-label={t`Profile axis`}
            value={selectedAxis}
            onChange={(_event, value: ProfileAxis | null) => {
              if (value !== null) setSelectedAxis(value);
            }}
          >
            <ToggleButton value="distance">
              <Trans>Distance</Trans>
            </ToggleButton>
            <ToggleButton value="time">
              <Trans>Time</Trans>
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      ) : null}
    </Stack>
  );
}

export function CompactElevationProfile({
  profile,
}: {
  readonly profile: ElevationProfile;
}): ReactElement {
  const sampledPoints = useMemo(() => sampleElevationProfilePoints(profile), [profile]);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG element ID.
  const gradientId = `compact-elevation-grade-${useId().replaceAll(':', '')}`;
  const distanceOfSample = useCallback(
    (sampleIndex: number) => profile.points[sampleIndex]?.distanceMeters ?? 0,
    [profile],
  );

  return (
    <Box
      aria-hidden
      data-testid="compact-elevation-profile"
      sx={{ width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <AreaChart<ElevationProfilePoint>
        aria-hidden
        accessibilityLayer={false}
        responsive
        data={sampledPoints}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS values.
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <XAxis
          hide
          height={0}
          type="number"
          /* eslint-disable lingui/no-unlocalized-strings -- Recharts data key and domain tokens. */
          dataKey="distanceMeters"
          domain={['dataMin', 'dataMax']}
          /* eslint-enable lingui/no-unlocalized-strings */
          padding={{ left: 0, right: 0 }}
        />
        <YAxis
          hide
          width={0}
          type="number"
          /* eslint-disable lingui/no-unlocalized-strings -- Recharts data key and domain tokens. */
          dataKey="elevationMeters"
          domain={['dataMin', 'dataMax']}
          /* eslint-enable lingui/no-unlocalized-strings */
        />
        <ElevationProfileArea
          profile={profile}
          gradientId={gradientId}
          activeSegmentIndex={null}
          metric="elevation"
          xOfSample={distanceOfSample}
        />
      </AreaChart>
    </Box>
  );
}
