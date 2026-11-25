import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useId, useMemo, useState, type ReactElement } from 'react';

import {
  estimateRouteHikingTime,
  type TrackTimingMetrics,
  type TrackTimingRoute,
} from '@/application/weather/TrackWeatherForecast';
import {
  GRADE_BANDS_ASCENDING,
  GRADE_BAND_THRESHOLDS_PCT,
  type GradeBand,
} from '@/domain/tracks/elevationProfile';
import {
  builtInHikingTimeAccuracy,
  hikingTimePresets,
  resolveHikingTimePreset,
  type HikingTimeEstimate,
  type HikingTimeRatioSpread,
} from '@/domain/tracks/hikingTime';
import {
  analyzeRecordedHike,
  compareGradeBands,
} from '@/domain/tracks/recordedHikeAnalysis';
import { useUiStore } from '@/presentation/shell/uiStore';
import {
  estimateDivergence,
  estimateMatch,
  formatEstimateDivergence,
  hikingTimePresetName,
} from '@/presentation/tracks/hikingTimePresetFormat';
import { HikingTimePresetSelect } from '@/presentation/tracks/HikingTimePresetSelect';
import {
  formatTrackDistance,
  formatTrackDuration,
  formatTrackGrade,
  formatTrackSpeed,
} from '@/presentation/tracks/trackFormatters';

// eslint-disable-next-line lingui/no-unlocalized-strings -- MUI Alert severity tokens.
const matchSeverity = { close: 'success', fair: 'warning', far: 'error' } as const;

const missingValue = '—';

interface HikingTimeMatchProps {
  readonly route: TrackTimingRoute;
  readonly metrics: TrackTimingMetrics & { readonly elapsedSeconds: number };
  /** The track's preset; null follows the default. */
  readonly presetId: string | null;
}

/**
 * How the track's preset would have estimated this recorded hike, with a report that
 * compares every preset part by part. Estimates ignore the track's pace and stop factors.
 */
export function HikingTimeMatch({
  route,
  metrics,
  presetId,
}: HikingTimeMatchProps): ReactElement {
  const { i18n, t } = useLingui();
  const settings = useUiStore((state) => state.hikingTimePresets);
  const [reportOpen, setReportOpen] = useState(false);
  const { ascentMeters, descentMeters, elapsedSeconds } = metrics;
  const estimates = useMemo(() => {
    const totals: {
      elapsedSeconds: number;
      ascentMeters?: number;
      descentMeters?: number;
    } = { elapsedSeconds };
    if (ascentMeters !== undefined) totals.ascentMeters = ascentMeters;
    if (descentMeters !== undefined) totals.descentMeters = descentMeters;
    return new Map(
      hikingTimePresets(settings).map((preset) => [
        preset.id,
        estimateRouteHikingTime(route.points, totals, {
          paceFactor: 1,
          stopFactor: 1,
          hikingTime: preset.parameters,
        }),
      ]),
    );
  }, [route.points, ascentMeters, descentMeters, elapsedSeconds, settings]);

  const preset = resolveHikingTimePreset(settings, presetId);
  const estimate = estimates.get(preset.id);
  if (estimate === undefined)
    throw new RangeError('The resolved preset has no estimate.');
  const divergence = estimateDivergence(estimate.totalSeconds, elapsedSeconds);
  const name = hikingTimePresetName(preset, i18n);
  const duration = formatTrackDuration(estimate.totalSeconds, i18n);
  const difference = formatEstimateDivergence(divergence, i18n);

  return (
    <>
      <Alert
        severity={matchSeverity[estimateMatch(divergence)]}
        variant="outlined"
        sx={{ py: 0, alignItems: 'center' }}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setReportOpen(true);
            }}
          >
            <Trans>Show report</Trans>
          </Button>
        }
      >
        {t`${name} estimate: ${duration} (${difference} vs recorded)`}
      </Alert>
      {reportOpen ? (
        <HikingTimeReport
          route={route}
          recordedSeconds={elapsedSeconds}
          initialPresetId={preset.id}
          estimates={estimates}
          onClose={() => {
            setReportOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

interface HikingTimeReportProps {
  readonly route: TrackTimingRoute;
  readonly recordedSeconds: number;
  readonly initialPresetId: string;
  readonly estimates: ReadonlyMap<string, HikingTimeEstimate>;
  readonly onClose: () => void;
}

/** The comparison dialog; the preset chosen here is only for viewing. */
function HikingTimeReport({
  route,
  recordedSeconds,
  initialPresetId,
  estimates,
  onClose,
}: HikingTimeReportProps): ReactElement {
  const { i18n, t } = useLingui();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const titleId = `hiking-time-report-${useId().replaceAll(':', '')}`;
  const settings = useUiStore((state) => state.hikingTimePresets);
  const [selectedPresetId, setSelectedPresetId] = useState(initialPresetId);
  const analysis = useMemo(() => analyzeRecordedHike(route.points), [route.points]);
  const totals = useMemo(
    () => new Map([...estimates].map(([id, estimate]) => [id, estimate.totalSeconds])),
    [estimates],
  );
  const preset = resolveHikingTimePreset(settings, selectedPresetId);
  const estimate = estimates.get(preset.id);
  const bands = useMemo(
    () =>
      analysis === null || estimate === undefined
        ? []
        : compareGradeBands(
            route.points,
            analysis.movingStepSeconds,
            estimate.movingElapsedSeconds,
          ),
    [analysis, estimate, route.points],
  );
  if (estimate === undefined)
    throw new RangeError('The selected preset has no estimate.');
  const accuracy = builtInHikingTimeAccuracy[preset.id];
  const calibrationHikes = accuracy?.hikes ?? 0;

  const duration = (seconds: number | null): string =>
    seconds === null ? missingValue : formatTrackDuration(seconds, i18n);
  const difference = (estimated: number | null, recorded: number | null): string =>
    estimated === null || recorded === null || recorded <= 0
      ? missingValue
      : formatEstimateDivergence(estimateDivergence(estimated, recorded), i18n);

  const rows: { label: string; recorded: number | null; estimated: number | null }[] = [
    {
      label: t`Moving`,
      recorded: analysis?.movingSeconds ?? null,
      estimated: estimate.movingSeconds,
    },
    {
      label: t`Breaks`,
      recorded: analysis?.breakSeconds ?? null,
      estimated: estimate.breakSeconds,
    },
    {
      label: t`Lunch`,
      recorded: analysis?.lunchSeconds ?? null,
      estimated: estimate.lunchSeconds,
    },
  ];
  if (analysis !== null && analysis.idleSeconds > 0) {
    rows.push({
      label: t`Idle before start and after finish`,
      recorded: analysis.idleSeconds,
      estimated: null,
    });
  }
  rows.push({
    label: t`Total`,
    recorded: recordedSeconds,
    estimated: estimate.totalSeconds,
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby={titleId}>
      <DialogTitle id={titleId}>
        <Trans>Hiking time report</Trans>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <HikingTimePresetSelect
            label={t`Preset`}
            settings={settings}
            value={preset.id}
            estimates={totals}
            recordedSeconds={recordedSeconds}
            onChange={(next) => {
              if (next !== null) setSelectedPresetId(next);
            }}
          />
          <Stack spacing={1}>
            <Typography component="h3" variant="subtitle2">
              <Trans>Recorded and estimated time</Trans>
            </Typography>
            <Table size="small" aria-label={t`Recorded and estimated time`}>
              <TableHead>
                <TableRow>
                  <TableCell>
                    <Trans>Part</Trans>
                  </TableCell>
                  <TableCell align="right">
                    <Trans>Recorded</Trans>
                  </TableCell>
                  <TableCell align="right">
                    <Trans>Estimated</Trans>
                  </TableCell>
                  <TableCell align="right">
                    <Trans>Difference</Trans>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell component="th" scope="row">
                      {row.label}
                    </TableCell>
                    <TableCell align="right">{duration(row.recorded)}</TableCell>
                    <TableCell align="right">{duration(row.estimated)}</TableCell>
                    <TableCell align="right">
                      {difference(row.estimated, row.recorded)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Stack>
          <Stack spacing={1}>
            <Typography component="h3" variant="subtitle2">
              <Trans>Accuracy</Trans>
            </Typography>
            {accuracy === undefined ? (
              <Typography variant="body2" color="text.secondary">
                <Trans>No calibration statistics exist for this custom preset.</Trans>
              </Typography>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">
                  <Trans>
                    For a planned hike with this estimate, the actual time falls in this
                    range for 8 in 10 hikes. A wider range means a less certain
                    forecast.{' '}
                    <Plural
                      value={calibrationHikes}
                      one="Based on # recorded hike."
                      other="Based on # recorded hikes."
                    />
                  </Trans>
                </Typography>
                <Table size="small" aria-label={t`Accuracy`}>
                  <TableHead>
                    <TableRow>
                      <TableCell>
                        <Trans>Part</Trans>
                      </TableCell>
                      <TableCell align="right">
                        <Trans>Likely actual time</Trans>
                      </TableCell>
                      <TableCell align="right">
                        <Trans>Within ±10%</Trans>
                      </TableCell>
                      <TableCell align="right">
                        <Trans>Within ±20%</Trans>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <AccuracyRow
                      label={t`Moving`}
                      estimatedSeconds={estimate.movingSeconds}
                      spread={accuracy.moving}
                    />
                    <AccuracyRow
                      label={t`Total`}
                      estimatedSeconds={estimate.totalSeconds}
                      spread={accuracy.total}
                    />
                  </TableBody>
                </Table>
              </>
            )}
          </Stack>
          {bands.length === 0 ? null : (
            <Stack spacing={1}>
              <Typography component="h3" variant="subtitle2">
                <Trans>Moving speed by grade</Trans>
              </Typography>
              <Table size="small" aria-label={t`Moving speed by grade`}>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <Trans>Grade</Trans>
                    </TableCell>
                    <TableCell align="right">
                      <Trans>Distance</Trans>
                    </TableCell>
                    <TableCell align="right">
                      <Trans>Recorded</Trans>
                    </TableCell>
                    <TableCell align="right">
                      <Trans>Estimated</Trans>
                    </TableCell>
                    <TableCell align="right">
                      <Trans>Difference</Trans>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bands.map((band) => (
                    <TableRow key={band.band}>
                      <TableCell
                        component="th"
                        scope="row"
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        {gradeBandLabel(band.band, i18n)}
                      </TableCell>
                      <TableCell align="right">
                        {formatTrackDistance(band.distanceMeters, i18n)}
                      </TableCell>
                      <TableCell align="right">
                        {speed(band.distanceMeters, band.recordedMovingSeconds, i18n)}
                      </TableCell>
                      <TableCell align="right">
                        {speed(band.distanceMeters, band.estimatedMovingSeconds, i18n)}
                      </TableCell>
                      <TableCell align="right">
                        {difference(
                          band.estimatedMovingSeconds,
                          band.recordedMovingSeconds,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          <Trans>Close</Trans>
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface AccuracyRowProps {
  readonly label: string;
  readonly estimatedSeconds: number;
  readonly spread: HikingTimeRatioSpread;
}

/** The 80 % range of actual time: the estimate divided by the P90 and P10 ratios. */
function AccuracyRow({
  label,
  estimatedSeconds,
  spread,
}: AccuracyRowProps): ReactElement {
  const { i18n, t } = useLingui();
  const percent = new Intl.NumberFormat(i18n.locale, {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option token.
    style: 'percent',
    maximumFractionDigits: 0,
  });
  const shortest = formatTrackDuration(estimatedSeconds / spread.ratioP90, i18n);
  const longest = formatTrackDuration(estimatedSeconds / spread.ratioP10, i18n);
  return (
    <TableRow>
      <TableCell component="th" scope="row">
        {label}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        {t`${shortest} – ${longest}`}
      </TableCell>
      <TableCell align="right">{percent.format(spread.withinTenPercent)}</TableCell>
      <TableCell align="right">{percent.format(spread.withinTwentyPercent)}</TableCell>
    </TableRow>
  );
}

function speed(distanceMeters: number, seconds: number, i18n: I18n): string {
  return seconds > 0
    ? formatTrackSpeed((distanceMeters / seconds) * 3.6, i18n)
    : missingValue;
}

/** Grade range of a band, from the profile's band thresholds. */
function gradeBandLabel(band: GradeBand, i18n: I18n): string {
  const index = GRADE_BANDS_ASCENDING.indexOf(band);
  const lower = GRADE_BAND_THRESHOLDS_PCT[index - 1];
  const upper = GRADE_BAND_THRESHOLDS_PCT[index];
  // The outermost bands are open-ended: steeper than their one threshold.
  if (lower === undefined || upper === undefined) {
    const value = formatTrackGrade(lower ?? upper ?? 0, i18n);
    return i18n._(msg`${value} and steeper`);
  }
  const from = formatTrackGrade(lower, i18n);
  const to = formatTrackGrade(upper, i18n);
  return i18n._(msg`${from} to ${to}`);
}
