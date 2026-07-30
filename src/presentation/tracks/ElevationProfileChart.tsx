import { Box, Paper, Stack, Typography, useTheme } from '@mui/material';
import { useId, type ReactElement } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  ReferenceArea,
  YAxis,
  type MouseHandlerDataParam,
  type TooltipContentProps,
} from 'recharts';

import {
  gradeBandForGrade,
  type ElevationProfile,
  type ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import { formatTrackGrade } from '@/presentation/tracks/trackFormatters';
import { appColors } from '@/presentation/theme/appColors';

interface ElevationProfileChartProps {
  readonly profile: ElevationProfile;
  readonly activeSegmentIndex?: number | null;
  readonly onActivePointChange?: (point: ElevationProfilePoint | null) => void;
  readonly onPointClick?: (point: ElevationProfilePoint) => void;
}

function sampleProfilePoints<T>(points: readonly T[], maximum = 1_200): readonly T[] {
  if (points.length <= maximum) return points;
  const sampled: T[] = [];
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round((index / (maximum - 1)) * (points.length - 1));
    const point = points[sourceIndex];
    if (point !== undefined) sampled.push(point);
  }
  return sampled;
}
function activeProfilePoint(
  { activeIndex, activeLabel, isTooltipActive }: MouseHandlerDataParam,
  sampledPoints: readonly ElevationProfilePoint[],
): ElevationProfilePoint | null {
  if (!isTooltipActive) return null;
  if (typeof activeIndex === 'number') {
    return sampledPoints[activeIndex] ?? null;
  }
  if (typeof activeLabel === 'number') {
    return sampledPoints.find((point) => point.distanceMeters === activeLabel) ?? null;
  }
  return null;
}

function ElevationTooltip({
  active,
  label,
  payload,
}: TooltipContentProps): ReactElement | null {
  const point = payload[0]?.payload as Partial<ElevationProfilePoint> | undefined;
  const elevationMeters = point?.elevationMeters;
  const localGradePct = point?.localGradePct;
  if (
    !active ||
    typeof label !== 'number' ||
    typeof elevationMeters !== 'number' ||
    typeof localGradePct !== 'number'
  ) {
    return null;
  }
  return (
    <Paper elevation={3} sx={{ p: 1 }}>
      <Typography variant="caption" component="div">
        {(label / 1_000).toFixed(1)} km
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <Box
          aria-hidden
          sx={{
            width: 8,
            height: 20,
            borderRadius: 0.5,
            bgcolor: appColors.elevationGrade[gradeBandForGrade(localGradePct)],
          }}
        />
        <Box>
          <Typography variant="body2">
            Elevation {String(Math.round(elevationMeters))} m
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Grade {formatTrackGrade(localGradePct)}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

export function ElevationProfileChart({
  profile,
  activeSegmentIndex = null,
  onActivePointChange,
  onPointClick,
}: ElevationProfileChartProps): ReactElement {
  const theme = useTheme();
  const sampledPoints = sampleProfilePoints(profile.points);
  const gradientId = `elevation-grade-${useId().replaceAll(':', '')}`;
  const maximumDistance = sampledPoints.at(-1)?.distanceMeters ?? 0;
  const activeSegment =
    activeSegmentIndex === null ? undefined : profile.segments[activeSegmentIndex];
  const axisText = {
    fill: theme.palette.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.caption.fontSize,
  };

  function handleMouseMove(mouseHandlerData: MouseHandlerDataParam): void {
    onActivePointChange?.(activeProfilePoint(mouseHandlerData, sampledPoints));
  }

  function handleClick(mouseHandlerData: MouseHandlerDataParam): void {
    const point = activeProfilePoint(mouseHandlerData, sampledPoints);
    if (point !== null) onPointClick?.(point);
  }

  return (
    <Stack spacing={1.5}>
      <Typography component="h3" variant="subtitle2">
        Elevation profile
      </Typography>
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
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onMouseLeave={() => onActivePointChange?.(null)}
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
            content={ElevationTooltip}
          />
          {activeSegment === undefined ? null : (
            <ReferenceArea
              x1={activeSegment.startDistanceMeters}
              x2={activeSegment.endDistanceMeters}
              fill={theme.palette.action.selected}
              fillOpacity={1}
              strokeOpacity={0}
            />
          )}
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              {sampledPoints.flatMap((point, index) => {
                const offset =
                  maximumDistance <= 0 ? 0 : (point.distanceMeters / maximumDistance) * 100;
                const color = appColors.elevationGrade[gradeBandForGrade(point.localGradePct)];
                const previous = sampledPoints[index - 1];
                return previous === undefined
                  ? [<stop key={`${String(index)}:start`} offset={`${String(offset)}%`} stopColor={color} />]
                  : [
                      <stop
                        key={`${String(index)}:previous`}
                        offset={`${String(offset)}%`}
                        stopColor={
                          appColors.elevationGrade[gradeBandForGrade(previous.localGradePct)]
                        }
                      />,
                      <stop
                        key={`${String(index)}:current`}
                        offset={`${String(offset)}%`}
                        stopColor={color}
                      />,
                    ];
              })}
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
        </AreaChart>
      </Box>
    </Stack>
  );
}
