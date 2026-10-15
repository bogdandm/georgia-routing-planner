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
  smoothedSpeedMetersPerSecond,
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
const TIME_TICK_STEPS_SECONDS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1_440].map(
  (minutes) => minutes * 60,
);

type ProfileMetric = 'elevation' | 'speed';
type ProfileAxis = 'distance' | 'time';
type ProfileValueKey = 'elevationMeters' | ((point: ElevationProfilePoint) => number);

/** Recorded time and chart speed, indexed like the profile points. */
interface ProfileTimeline {
  readonly elapsedSeconds: readonly number[];
  readonly speedKilometersPerHour: readonly number[];
}

function profileTimeline(profile: ElevationProfile): ProfileTimeline | null {
  const elapsedSeconds = recordedElapsedSeconds(profile.points);
  if (elapsedSeconds === null) return null;
  return {
    elapsedSeconds,
    speedKilometersPerHour: smoothedSpeedMetersPerSecond(
      profile.points,
      elapsedSeconds,
    ).map((metersPerSecond) => metersPerSecond * 3.6),
  };
}

/** Plotted value: elevation, or smoothed speed when the speed array is given. */
function profileValueKey(
  speedKilometersPerHour: readonly number[] | null,
): ProfileValueKey {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Recharts data key.
  if (speedKilometersPerHour === null) return 'elevationMeters';
  return (point: ElevationProfilePoint) =>
    speedKilometersPerHour[point.sampleIndex] ?? 0;
}

/** Round elapsed-time ticks such as 0:30, 1:00, 1:30 instead of arbitrary seconds. */
function timeAxisTicks(totalSeconds: number): readonly number[] {
  const stepSeconds =
    TIME_TICK_STEPS_SECONDS.find(
      (step) => totalSeconds / step <= MAXIMUM_TIME_TICK_INTERVALS,
    ) ?? Math.ceil(totalSeconds / MAXIMUM_TIME_TICK_INTERVALS / 86_400) * 86_400;
  const ticks: number[] = [];
  for (let seconds = 0; seconds <= totalSeconds; seconds += stepSeconds) {
    ticks.push(seconds);
  }
  return ticks;
}

function formatElapsedTick(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.round((seconds % 3_600) / 60);
  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
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

function activeProfilePoint(
  { activeIndex, isTooltipActive }: MouseHandlerDataParam,
  sampledPoints: readonly ElevationProfilePoint[],
): ElevationProfilePoint | null {
  if (!isTooltipActive) return null;
  const sampledIndex = Number(activeIndex);
  if (!Number.isInteger(sampledIndex)) return null;
  return sampledPoints[sampledIndex] ?? null;
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
  readonly timeline: ProfileTimeline | null;
  readonly metric: ProfileMetric;
}

function ElevationTooltip({
  active,
  payload,
  profile,
  timeline,
  metric,
}: ElevationTooltipProps): ReactElement | null {
  const { i18n, t } = useLingui();
  const point: unknown = payload[0]?.payload;
  if (
    !active ||
    typeof point !== 'object' ||
    point === null ||
    !('sampleIndex' in point) ||
    typeof point.sampleIndex !== 'number'
  ) {
    return null;
  }
  const segmentIndex = elevationSegmentIndexForSample(profile, point.sampleIndex);
  const segment = segmentIndex === null ? undefined : profile.segments[segmentIndex];
  if (
    segment === undefined ||
    !('distanceMeters' in point) ||
    typeof point.distanceMeters !== 'number' ||
    !('elevationMeters' in point) ||
    typeof point.elevationMeters !== 'number' ||
    !('localGradePct' in point) ||
    typeof point.localGradePct !== 'number'
  ) {
    return null;
  }
  const profilePoint = profile.points[point.sampleIndex];
  const hoverGradePct =
    profilePoint?.sampleIndex === point.sampleIndex
      ? smoothedHoverGradePct(profile, profilePoint)
      : point.localGradePct;
  const elapsedSeconds = timeline?.elapsedSeconds[point.sampleIndex];
  const speedKilometersPerHour = timeline?.speedKilometersPerHour[point.sampleIndex];
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

  return (
    <Paper elevation={3} sx={{ p: 1, minWidth: 210 }}>
      <Stack spacing={0.4}>
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
            <Typography variant="caption">
              {formatTrackDistance(point.distanceMeters, i18n)}
            </Typography>
          </Stack>
          {elapsedSeconds === undefined ? null : (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <TimerOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
              <Typography variant="caption">
                {formatTrackDuration(elapsedSeconds, i18n)}
              </Typography>
            </Stack>
          )}
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <TerrainOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
            <Typography variant={metric === 'elevation' ? 'body2' : 'caption'}>
              {formatTrackElevation(point.elevationMeters, i18n)}
            </Typography>
          </Stack>
          {speedKilometersPerHour === undefined ? null : (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <SpeedOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
              <Typography variant={metric === 'speed' ? 'body2' : 'caption'}>
                {formatTrackSpeed(speedKilometersPerHour, i18n)}
              </Typography>
            </Stack>
          )}
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
        </Stack>
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
  readonly valueKey: ProfileValueKey;
  /** Horizontal position of a profile sample; the axis starts at zero. */
  readonly xOfSample: (sampleIndex: number) => number;
}

function ElevationProfileArea({
  profile,
  gradientId,
  activeSegmentIndex,
  metric,
  valueKey,
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
        dataKey={valueKey}
        name={metric === 'speed' ? t`Speed` : t`Elevation`}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Recharts domain token.
        baseValue={metric === 'speed' ? 0 : 'dataMin'}
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
  /* eslint-enable lingui/no-unlocalized-strings */
  const elapsedSeconds =
    selectedAxis === 'time' ? (timeline?.elapsedSeconds ?? null) : null;
  const speedKilometersPerHour =
    metric === 'speed' ? (timeline?.speedKilometersPerHour ?? null) : null;
  const valueKey = useMemo(
    () => profileValueKey(speedKilometersPerHour),
    [speedKilometersPerHour],
  );
  const xOfSample = useCallback(
    (sampleIndex: number): number =>
      (elapsedSeconds === null
        ? profile.points[sampleIndex]?.distanceMeters
        : elapsedSeconds[sampleIndex]) ?? 0,
    [elapsedSeconds, profile],
  );
  const xValueKey = useCallback(
    (point: ElevationProfilePoint) => xOfSample(point.sampleIndex),
    [xOfSample],
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
  if (speedKilometersPerHour === null) {
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
      speedKilometersPerHour.reduce((maximum, speed) => Math.max(maximum, speed), 0),
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
      <ElevationTooltip
        {...props}
        profile={profile}
        timeline={timeline}
        metric={metric}
      />
    ),
    [profile, timeline, metric],
  );

  function publishActivePoint(
    mouseHandlerData: MouseHandlerDataParam,
  ): ElevationProfilePoint | null {
    const point = activeProfilePoint(mouseHandlerData, sampledPoints);
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
      <Box role="img" aria-label={profileLabel} sx={{ height: 264, mx: -1 }}>
        <AreaChart<ElevationProfilePoint>
          aria-hidden
          accessibilityLayer={false}
          responsive
          data={sampledPoints}
          margin={{ top: 12, right: 16, bottom: 6, left: 4 }}
          style={{ width: '100%', height: '100%' }}
          onMouseMove={publishActivePoint}
          onClick={(mouseHandlerData) => {
            const point = activeProfilePoint(mouseHandlerData, sampledPoints);
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
            dataKey={xValueKey}
            // eslint-disable-next-line lingui/no-unlocalized-strings -- Recharts domain tokens.
            domain={['dataMin', 'dataMax']}
            {...(timeTicks === null ? {} : { ticks: timeTicks })}
            height={32}
            tick={axisText}
            tickFormatter={(value: number) => {
              if (timeTicks !== null) return formatElapsedTick(value);
              const distance = axisDistanceFormatter.format(value / 1_000);
              return t`${distance} km`;
            }}
          />
          <YAxis
            type="number"
            dataKey={valueKey}
            domain={
              // eslint-disable-next-line lingui/no-unlocalized-strings -- Recharts domain tokens.
              speedKilometersPerHour === null ? ['auto', 'auto'] : [0, 'auto']
            }
            width={64}
            tick={axisText}
            tickFormatter={(value: number) =>
              speedKilometersPerHour === null
                ? formatTrackElevation(value, i18n)
                : formatTrackSpeed(value, i18n)
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
            valueKey={valueKey}
            xOfSample={xOfSample}
          />
        </AreaChart>
      </Box>
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
          // eslint-disable-next-line lingui/no-unlocalized-strings -- Recharts data key.
          valueKey="elevationMeters"
          xOfSample={distanceOfSample}
        />
      </AreaChart>
    </Box>
  );
}
