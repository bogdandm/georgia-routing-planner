import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { ElevationProfile } from '@/domain/tracks/elevationProfile';
import type { TrackMetrics } from '@/domain/tracks/trackCalculations';
import { CompactElevationProfile } from '@/presentation/tracks/ElevationProfileChart';
import {
  formatTrackDistance,
  formatTrackElevation,
} from '@/presentation/tracks/trackFormatters';

// eslint-disable-next-line react-refresh/only-export-components
export function formatTrackDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.round((seconds % 3_600) / 60);
  return `${String(hours)}h ${String(minutes)}m`;
}

function averageSpeedKilometersPerHour(metrics: TrackMetrics): number | undefined {
  const elapsedSeconds = metrics.elapsedSeconds;
  if (elapsedSeconds === undefined || elapsedSeconds <= 0) return undefined;
  return (metrics.distanceMeters / elapsedSeconds) * 3.6;
}

interface TrackStatProps {
  readonly emphasized?: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly overGraphic?: boolean;
  readonly value: string;
}

export function TrackStat({
  emphasized = false,
  icon,
  label,
  overGraphic = false,
  value,
}: TrackStatProps) {
  return (
    <Stack
      component="span"
      direction="row"
      spacing={0.5}
      aria-label={`${label}: ${value}`}
      sx={{
        minWidth: 0,
        alignItems: 'center',
        bgcolor: overGraphic ? 'rgba(255,255,255,0.78)' : undefined,
        backdropFilter: overGraphic ? 'blur(2px)' : undefined,
        border: overGraphic ? '1px solid rgba(255,255,255,0.88)' : undefined,
        borderRadius: overGraphic ? 0.75 : undefined,
        px: overGraphic ? 0.5 : undefined,
        py: overGraphic ? 0.25 : undefined,
      }}
    >
      <Tooltip title={label} enterTouchDelay={0}>
        <Box
          component="span"
          aria-hidden
          sx={{ color: 'text.secondary', display: 'inline-flex' }}
        >
          {icon}
        </Box>
      </Tooltip>
      <Typography
        component="span"
        variant={emphasized ? 'body2' : 'caption'}
        noWrap
        sx={{ color: 'text.primary', fontWeight: emphasized ? 600 : 400 }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

interface TrackStatsProps {
  readonly metrics: TrackMetrics;
  readonly compact?: boolean;
  readonly overGraphic?: boolean;
}

export function TrackStats({
  compact = false,
  metrics,
  overGraphic = false,
}: TrackStatsProps) {
  const stats: TrackStatProps[] = [];
  const elapsedSeconds = metrics.elapsedSeconds;
  if (elapsedSeconds !== undefined) {
    stats.push({
      icon: <TimerOutlinedIcon sx={{ fontSize: 18 }} />,
      label: 'Recorded time',
      value: formatTrackDuration(elapsedSeconds),
    });
  }
  stats.push({
    icon: <SwapHorizIcon sx={{ fontSize: 18 }} />,
    label: 'Distance',
    value: formatTrackDistance(metrics.distanceMeters),
  });
  if (!compact) {
    const speedKilometersPerHour = averageSpeedKilometersPerHour(metrics);
    if (speedKilometersPerHour !== undefined) {
      stats.push({
        icon: <SpeedOutlinedIcon sx={{ fontSize: 18 }} />,
        label: 'Average speed',
        value: `${speedKilometersPerHour.toFixed(1)} km/h`,
      });
    }
  }
  if (metrics.ascentMeters !== undefined) {
    stats.push({
      icon: <NorthEastIcon sx={{ fontSize: 18 }} />,
      label: 'Elevation gain',
      value: formatTrackElevation(metrics.ascentMeters),
    });
  }
  if (metrics.descentMeters !== undefined) {
    stats.push({
      icon: <SouthEastIcon sx={{ fontSize: 18 }} />,
      label: 'Elevation loss',
      value: formatTrackElevation(metrics.descentMeters),
    });
  }
  return (
    <Box
      sx={{
        display: compact ? 'flex' : 'grid',
        gridTemplateColumns: compact ? undefined : 'repeat(3, minmax(0, 1fr))',
        justifyContent: compact ? 'space-around' : undefined,
        columnGap: compact ? 0 : 1.5,
        rowGap: 1.5,
        minWidth: 0,
        '@media (width < 360px)': {
          display: compact ? 'grid' : undefined,
          gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : undefined,
          justifyItems: compact ? 'center' : undefined,
          rowGap: compact ? 0.75 : undefined,
        },
        flex: compact ? 1 : undefined,
      }}
    >
      {stats.map((stat) => (
        <TrackStat key={stat.label} {...stat} emphasized overGraphic={overGraphic} />
      ))}
    </Box>
  );
}

interface CompactTrackSummaryProps {
  readonly metrics: TrackMetrics | null;
  readonly profile: ElevationProfile | null;
  readonly showExpandIndicator?: boolean;
}

export function CompactTrackSummary({
  metrics,
  profile,
  showExpandIndicator = false,
}: CompactTrackSummaryProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minWidth: 0,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          width: '100%',
          height: '100%',
          minWidth: 0,
          alignItems: 'center',
        }}
      >
        {showExpandIndicator ? (
          <Box
            aria-hidden
            sx={{
              width: 30,
              height: 30,
              ml: 0.5,
              mr: 1,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'action.active',
            }}
          >
            <KeyboardArrowUpIcon fontSize="small" />
          </Box>
        ) : null}
        {metrics === null ? null : (
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <TrackStats compact overGraphic={profile !== null} metrics={metrics} />
          </Box>
        )}
      </Box>
      {profile === null ? null : (
        <Box sx={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <CompactElevationProfile profile={profile} />
        </Box>
      )}
    </Box>
  );
}
