import { useLingui } from '@lingui/react/macro';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { useId, useMemo } from 'react';

import {
  GRADE_BANDS_ASCENDING,
  GRADE_BAND_THRESHOLDS_PCT,
  type ElevationProfile,
} from '@/domain/tracks/elevationProfile';
import { appColors } from '@/presentation/theme/appColors';

interface ElevationGradeLegendProps {
  readonly dismissed: boolean;
  readonly onDismissedChange: (dismissed: boolean) => void;
  readonly profile: ElevationProfile | null;
  readonly visible: boolean;
}

// With the SVG rendered 1:1, the curve tangent is grade: 30% rises 30 vertical
// units per 100 horizontal units. The asymmetric range leaves visible room beyond
// both outer labeled color boundaries.
const LEGEND_GRADE_MINIMUM_PCT = -25;
const LEGEND_GRADE_MAXIMUM_PCT = 35;
const LEGEND_PLOT_LEFT = 7;
const LEGEND_PLOT_RIGHT = 245;
const LEGEND_CURVE_START_Y = 25;
const legendPlotWidth = LEGEND_PLOT_RIGHT - LEGEND_PLOT_LEFT;
const legendCurveControlX = (LEGEND_PLOT_LEFT + LEGEND_PLOT_RIGHT) / 2;
const legendCurveControlY =
  LEGEND_CURVE_START_Y - (LEGEND_GRADE_MINIMUM_PCT / 100) * (legendPlotWidth / 2);
const legendCurveEndY =
  LEGEND_CURVE_START_Y -
  ((LEGEND_GRADE_MINIMUM_PCT + LEGEND_GRADE_MAXIMUM_PCT) / 2 / 100) * legendPlotWidth;
/* eslint-disable lingui/no-unlocalized-strings -- SVG path commands are not copy. */
const legendCurvePath = `M ${String(LEGEND_PLOT_LEFT)} ${String(LEGEND_CURVE_START_Y)} Q ${String(legendCurveControlX)} ${String(legendCurveControlY)} ${String(LEGEND_PLOT_RIGHT)} ${String(legendCurveEndY)}`;
const legendAreaPath = `${legendCurvePath} L ${String(LEGEND_PLOT_RIGHT)} 40 L ${String(LEGEND_PLOT_LEFT)} 40 Z`;
/* eslint-enable lingui/no-unlocalized-strings */
const legendBandBoundariesPct = [
  LEGEND_GRADE_MINIMUM_PCT,
  ...GRADE_BAND_THRESHOLDS_PCT,
  LEGEND_GRADE_MAXIMUM_PCT,
] as const;
const visibleGradeThresholdsPct = GRADE_BAND_THRESHOLDS_PCT.filter((_, index) => {
  const lowerBand = GRADE_BANDS_ASCENDING[index];
  const upperBand = GRADE_BANDS_ASCENDING[index + 1];
  return (
    lowerBand !== undefined &&
    upperBand !== undefined &&
    appColors.elevationGrade[lowerBand] !== appColors.elevationGrade[upperBand]
  );
});

function legendBandBoundary(index: number): number {
  const boundary = legendBandBoundariesPct[index];
  if (boundary === undefined)
    throw new RangeError('Grade legend bands are inconsistent.');
  return boundary;
}

function legendPositionPct(gradePct: number): number {
  return (
    ((gradePct - LEGEND_GRADE_MINIMUM_PCT) /
      (LEGEND_GRADE_MAXIMUM_PCT - LEGEND_GRADE_MINIMUM_PCT)) *
    100
  );
}

function legendPlotX(gradePct: number): number {
  return (
    LEGEND_PLOT_LEFT +
    (legendPositionPct(gradePct) / 100) * (LEGEND_PLOT_RIGHT - LEGEND_PLOT_LEFT)
  );
}

// Ticks carry bare numbers; the heading names the percent unit. Russian percent
// formatting adds a space before `%`, which made the ±3 % ticks overlap.
function formatGradeThreshold(
  threshold: number,
  numberFormatter: Intl.NumberFormat,
): string {
  return `${threshold < 0 ? '−' : ''}${numberFormatter.format(Math.abs(threshold))}`;
}

/** Explains the colors of the active track's grade overlay without duplicating its state. */
export function ElevationGradeLegend({
  dismissed,
  onDismissedChange,
  profile,
  visible,
}: ElevationGradeLegendProps) {
  const { i18n, t } = useLingui();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG element ID.
  const gradientId = `elevation-grade-legend-${useId().replaceAll(':', '')}`;
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.locale),
    [i18n.locale],
  );

  if (!visible || profile === null || profile.gradeSubsegments.length === 0)
    return null;

  if (dismissed) return null;

  return (
    <Paper
      aria-label={t`Elevation grade legend`}
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
      <Box
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography component="h2" variant="caption" sx={{ fontWeight: 700 }}>
          {t`Track grade (%)`}
        </Typography>
        <Tooltip title={t`Hide track grade legend`}>
          <IconButton
            aria-label={t`Hide track grade legend`}
            onClick={() => {
              onDismissedChange(true);
            }}
            size="small"
            sx={{ mr: -0.75, my: -0.75 }}
          >
            <CloseOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <svg
        aria-label={t`Track grade color thresholds`}
        height={62}
        role="img"
        viewBox="0 0 252 62"
        width={252}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            {GRADE_BANDS_ASCENDING.flatMap((band, index) => {
              const startOffset = legendPositionPct(legendBandBoundary(index));
              const endOffset = legendPositionPct(legendBandBoundary(index + 1));
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
        <path d={legendAreaPath} fill={`url(#${gradientId})`} fillOpacity={0.2} />
        <path
          d={legendCurvePath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeWidth={3}
        />
        {visibleGradeThresholdsPct.map((threshold) => {
          const x = legendPlotX(threshold);
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
                {formatGradeThreshold(threshold, numberFormatter)}
              </text>
            </g>
          );
        })}
      </svg>
    </Paper>
  );
}
