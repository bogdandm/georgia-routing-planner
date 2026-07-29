import { Box, Paper, Stack, Typography, useTheme } from '@mui/material';
import type { ReactElement } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  type MouseHandlerDataParam,
  type TooltipContentProps,
} from 'recharts';

import type {
  ElevationProfile,
  ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import { appColors } from '@/presentation/theme/appColors';

interface ElevationProfileChartProps {
  readonly profile: ElevationProfile;
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
  const elevationMeters = payload[0]?.value;
  if (!active || typeof label !== 'number' || typeof elevationMeters !== 'number') {
    return null;
  }

  return (
    <Paper elevation={3} sx={{ p: 1 }}>
      <Typography variant="caption" component="div">
        {(label / 1_000).toFixed(1)} km
      </Typography>
      <Typography variant="body2">
        Elevation {String(Math.round(elevationMeters))} m
      </Typography>
    </Paper>
  );
}

export function ElevationProfileChart({
  profile,
  onActivePointChange,
  onPointClick,
}: ElevationProfileChartProps): ReactElement {
  const theme = useTheme();
  const sampledPoints = sampleProfilePoints(profile.points);
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
          <Area
            type="linear"
            dataKey="elevationMeters"
            name="Elevation"
            baseValue="dataMin"
            dot={false}
            stroke={appColors.brand.blueGreenDark}
            fill={appColors.brand.blueGreenDark}
            fillOpacity={0.16}
            isAnimationActive={false}
          />
        </AreaChart>
      </Box>
    </Stack>
  );
}
