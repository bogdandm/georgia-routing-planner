import { Paper, Typography } from '@mui/material';
import { useId } from 'react';

import {
  GRADE_BANDS_ASCENDING,
  GRADE_BAND_THRESHOLDS_PCT,
  type ElevationProfile,
} from '@/domain/tracks/elevationProfile';
import { appColors } from '@/presentation/theme/appColors';

interface ElevationGradeLegendProps {
  readonly profile: ElevationProfile | null;
  readonly visible: boolean;
}

function hasGradeSubsegments(profile: ElevationProfile): boolean {
  return profile.segments.some(
    (segment) => segment.type !== 'flat' && segment.gradeSubsegments.length > 0,
  );
}

function formatGradeThreshold(threshold: number): string {
  return `${threshold < 0 ? '−' : ''}${String(Math.abs(threshold))}%`;
}

/** Explains the colors of the active track's grade overlay without duplicating its state. */
export function ElevationGradeLegend({ profile, visible }: ElevationGradeLegendProps) {
  const gradientId = `elevation-grade-legend-${useId().replaceAll(':', '')}`;

  if (!visible || profile === null || !hasGradeSubsegments(profile)) return null;

  return (
    <Paper
      aria-label="Elevation grade legend"
      component="section"
      elevation={2}
      sx={{
        position: 'absolute',
        right: 8,
        bottom: 32,
        zIndex: 1,
        px: 1,
        py: 0.75,
        maxWidth: 'calc(100% - 16px)',
      }}
    >
      <Typography component="h2" variant="caption" sx={{ fontWeight: 700 }}>
        Track grade
      </Typography>
      <svg
        aria-label="Track grade color thresholds"
        height={62}
        role="img"
        viewBox="0 0 252 62"
        width={252}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            {GRADE_BANDS_ASCENDING.flatMap((band, index) => {
              const startOffset = (index / GRADE_BANDS_ASCENDING.length) * 100;
              const endOffset = ((index + 1) / GRADE_BANDS_ASCENDING.length) * 100;
              const color = appColors.elevationGrade[band];
              return [
                <stop
                  key={`${band}:start`}
                  offset={`${String(startOffset)}%`}
                  stopColor={color}
                />,
                <stop
                  key={`${band}:end`}
                  offset={`${String(endOffset)}%`}
                  stopColor={color}
                />,
              ];
            })}
          </linearGradient>
        </defs>
        <path
          d="M 7 36 C 47 36 74 8 126 8 C 178 8 205 36 245 36 L 245 40 L 7 40 Z"
          fill={`url(#${gradientId})`}
          fillOpacity={0.2}
        />
        <path
          d="M 7 36 C 47 36 74 8 126 8 C 178 8 205 36 245 36"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeWidth={3}
        />
        {GRADE_BAND_THRESHOLDS_PCT.map((threshold, index) => {
          const x = 41 + index * 34;
          return (
            <g key={threshold}>
              <line
                stroke="currentColor"
                strokeWidth={1}
                x1={x}
                x2={x}
                y1={40}
                y2={44}
              />
              <text fontSize={10} textAnchor="middle" x={x} y={57}>
                {formatGradeThreshold(threshold)}
              </text>
            </g>
          );
        })}
      </svg>
    </Paper>
  );
}
