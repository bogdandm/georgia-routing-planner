import ChangeHistoryOutlinedIcon from '@mui/icons-material/ChangeHistoryOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import TerrainOutlinedIcon from '@mui/icons-material/TerrainOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  Box,
  IconButton,
  Paper,
  Stack,
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useId, type ReactElement } from 'react';
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
import { appColors } from '@/presentation/theme/appColors';
import {
  formatTrackDistance,
  formatTrackElevation,
  formatTrackGrade,
} from '@/presentation/tracks/trackFormatters';

interface ElevationProfileChartProps {
  readonly profile: ElevationProfile;
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

interface ElevationTooltipProps extends TooltipContentProps {
  readonly profile: ElevationProfile;
}

function ElevationTooltip({
  active,
  payload,
  profile,
}: ElevationTooltipProps): ReactElement | null {
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
  const typeNumber =
    segment.type === 'flat'
      ? null
      : profile.segments
          .slice(0, (segmentIndex ?? 0) + 1)
          .filter((candidate) => candidate.type === segment.type).length;
  const typeLabel =
    segment.type === 'climb'
      ? `Climb ${String(typeNumber)}`
      : segment.type === 'descent'
        ? `Descent ${String(typeNumber)}`
        : 'Flat';

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
              {formatTrackDistance(point.distanceMeters)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <TerrainOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
            <Typography variant="body2">
              {formatTrackElevation(point.elevationMeters)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <ChangeHistoryOutlinedIcon
              aria-hidden
              sx={{
                fontSize: 16,
                transform: point.localGradePct < 0 ? 'rotate(180deg)' : undefined,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {formatTrackGrade(point.localGradePct)}
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
              {formatTrackDistance(segment.distanceMeters)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <NorthEastIcon aria-hidden sx={{ fontSize: 16 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {formatTrackElevation(segment.ascentMeters)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <SouthEastIcon aria-hidden sx={{ fontSize: 16 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {formatTrackElevation(segment.descentMeters)}
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
              {formatTrackGrade(segment.averageGradePct)}
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
}

function ElevationProfileArea({
  profile,
  gradientId,
  activeSegmentIndex,
}: ElevationProfileAreaProps): ReactElement {
  const maximumDistance = profile.points.at(-1)?.distanceMeters ?? 0;

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          {profile.segments.flatMap((segment, segmentIndex) =>
            segment.gradeSubsegments.flatMap((gradeSegment) => {
              const startOffset =
                maximumDistance <= 0
                  ? 0
                  : (gradeSegment.startDistanceMeters / maximumDistance) * 100;
              const endOffset =
                maximumDistance <= 0
                  ? 0
                  : (gradeSegment.endDistanceMeters / maximumDistance) * 100;
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
        dataKey="elevationMeters"
        name="Elevation"
        baseValue="dataMin"
        dot={false}
        stroke={`url(#${gradientId})`}
        fill={`url(#${gradientId})`}
        fillOpacity={0.2}
        isAnimationActive={false}
      />
    </>
  );
}

export function ElevationProfileChart({
  profile,
  activeSegmentIndex,
  selectedSegmentIndex,
  trackGradeLegendDismissed,
  onActivePointChange,
  onSegmentHoverChange,
  onSegmentSelectionChange,
  onTrackGradeLegendDismissedChange,
  onPointClick,
}: ElevationProfileChartProps): ReactElement {
  const theme = useTheme();
  const sampledPoints = sampleElevationProfilePoints(profile);
  const gradientId = `elevation-grade-${useId().replaceAll(':', '')}`;
  const axisText = {
    fill: theme.palette.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.caption.fontSize,
  };

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
    <Stack spacing={1.5}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography component="h3" variant="subtitle2">
          Elevation profile
        </Typography>
        {trackGradeLegendDismissed ? (
          <MuiTooltip title="Show track grade legend">
            <IconButton
              aria-label="Show track grade legend"
              onClick={() => {
                onTrackGradeLegendDismissedChange(false);
              }}
              size="small"
            >
              <HelpOutlineOutlinedIcon fontSize="small" />
            </IconButton>
          </MuiTooltip>
        ) : null}
      </Box>
      <Box
        role="img"
        aria-label={`Elevation profile from ${String(Math.round(profile.minimumMeters))} to ${String(Math.round(profile.maximumMeters))} metres`}
        sx={{ height: 264, mx: -1 }}
      >
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
            dataKey="distanceMeters"
            domain={['dataMin', 'dataMax']}
            height={32}
            tick={axisText}
            tickFormatter={(distanceMeters: number) =>
              `${(distanceMeters / 1_000).toFixed(1)} km`
            }
          />
          <YAxis
            type="number"
            dataKey="elevationMeters"
            domain={['auto', 'auto']}
            width={64}
            tick={axisText}
            tickFormatter={(elevationMeters: number) =>
              `${String(Math.round(elevationMeters))} m`
            }
          />
          <Tooltip
            cursor={{ stroke: theme.palette.text.secondary, strokeWidth: 1 }}
            content={(props) => <ElevationTooltip {...props} profile={profile} />}
          />
          {profile.segments.slice(1).map((segment) => (
            <ReferenceLine
              key={segment.startSampleIndex}
              x={segment.startDistanceMeters}
              stroke={theme.palette.divider}
              strokeWidth={1}
            />
          ))}
          <ElevationProfileArea
            profile={profile}
            gradientId={gradientId}
            activeSegmentIndex={activeSegmentIndex}
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
  const sampledPoints = sampleElevationProfilePoints(profile);
  const gradientId = `compact-elevation-grade-${useId().replaceAll(':', '')}`;

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
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <XAxis
          hide
          height={0}
          type="number"
          dataKey="distanceMeters"
          domain={['dataMin', 'dataMax']}
          padding={{ left: 0, right: 0 }}
        />
        <YAxis
          hide
          width={0}
          type="number"
          dataKey="elevationMeters"
          domain={['dataMin', 'dataMax']}
        />
        <ElevationProfileArea
          profile={profile}
          gradientId={gradientId}
          activeSegmentIndex={null}
        />
      </AreaChart>
    </Box>
  );
}
