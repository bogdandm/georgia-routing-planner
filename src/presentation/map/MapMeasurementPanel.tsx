import { useLingui } from '@lingui/react/macro';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import {
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import type {
  ElevationProvider,
  ElevationSample,
} from '@/application/ports/ElevationProvider';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import {
  formatDistanceWithMeters,
  formatElevationChange,
} from '@/presentation/tracks/trackFormatters';

function coordinateKey([longitude, latitude]: TrackCoordinate): string {
  return `${String(longitude)}:${String(latitude)}`;
}

interface MapMeasurementPanelProps {
  readonly points: readonly TrackCoordinate[];
  readonly elevationProvider: ElevationProvider | null;
  readonly onUndo: () => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
}

/**
 * Compact ruler readout: straight-line distance through the clicked points and terrain
 * elevation sampled only at those points, so the climb ignores relief between them.
 */
export function MapMeasurementPanel({
  points,
  elevationProvider,
  onUndo,
  onClear,
  onClose,
}: MapMeasurementPanelProps): ReactElement {
  const { i18n, t } = useLingui();
  const [samples, setSamples] = useState<ReadonlyMap<string, ElevationSample>>(
    new Map(),
  );

  useEffect(() => {
    const controller = new AbortController();
    const pendingPoints = points.filter((point) => !samples.has(coordinateKey(point)));
    if (pendingPoints.length === 0 || elevationProvider === null) {
      return () => {
        controller.abort();
      };
    }

    const applySamples = (resolvedSamples: readonly ElevationSample[]): void => {
      if (controller.signal.aborted) return;
      setSamples((current) => {
        const next = new Map<string, ElevationSample>();
        pendingPoints.forEach((point, index) => {
          next.set(
            coordinateKey(point),
            resolvedSamples[index] ?? { status: 'unavailable' },
          );
        });
        // Keep only samples for points that still exist so undo and clear release memory.
        for (const point of points) {
          const key = coordinateKey(point);
          const sample = current.get(key);
          if (sample !== undefined && !next.has(key)) next.set(key, sample);
        }
        return next;
      });
    };

    void elevationProvider
      .sampleMany(
        pendingPoints.map(([longitude, latitude]) => ({ longitude, latitude })),
        controller.signal,
      )
      .then(applySamples)
      .catch(() => {
        applySamples([]);
      });

    return () => {
      controller.abort();
    };
  }, [elevationProvider, points, samples]);

  let distanceMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start !== undefined && end !== undefined) {
      distanceMeters += geodesicDistanceMeters(start, end);
    }
  }

  // `undefined` while sampling; `null` when terrain has no usable value for the point.
  const elevations = points.map((point): number | null | undefined => {
    if (elevationProvider === null) return null;
    const sample = samples.get(coordinateKey(point));
    if (sample === undefined) return undefined;
    return sample.status === 'available' ? sample.meters : null;
  });

  const renderElevation = (
    values: readonly (number | null | undefined)[],
    format: (available: readonly number[]) => string,
  ): ReactNode => {
    if (values.some((value) => value === undefined)) {
      return <CircularProgress size={12} aria-label={t`Loading elevation`} />;
    }
    const available = values.filter((value) => typeof value === 'number');
    if (available.length !== values.length) return t`Unavailable`;
    return format(available);
  };

  const firstElevation = elevations[0];
  const lastElevation = elevations.at(-1);

  return (
    <Paper
      role="region"
      aria-label={t`Ruler`}
      elevation={4}
      sx={{
        position: 'absolute',
        top: 6,
        // Clears the 40 px right-side map control rail and its 6 px inset.
        right: 54,
        left: { xs: 64, sm: 'auto' },
        zIndex: 3,
        width: { sm: 248 },
        px: 1.5,
        py: 0.75,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t`Ruler`}
        </Typography>
        <Tooltip disableInteractive title={t`Undo last point`}>
          <span>
            <IconButton
              aria-label={t`Undo last point`}
              disabled={points.length === 0}
              onClick={onUndo}
              size="small"
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip disableInteractive title={t`Clear points`}>
          <span>
            <IconButton
              aria-label={t`Clear points`}
              disabled={points.length === 0}
              onClick={onClear}
              size="small"
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip disableInteractive title={t`Close ruler`}>
          <IconButton aria-label={t`Close ruler`} onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {points.length < 2 ? (
        <Typography variant="body2" color="text.secondary" sx={{ pb: 0.5 }}>
          {t`Click the map to add points.`}
        </Typography>
      ) : (
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 0.25,
            m: 0,
            pb: 0.5,
            '& dt': { color: 'text.secondary' },
            '& dd': { m: 0, fontWeight: 600, textAlign: 'right' },
          }}
        >
          <Typography component="dt" variant="body2">
            {t`Distance`}
          </Typography>
          <Typography component="dd" variant="body2">
            {formatDistanceWithMeters(distanceMeters, i18n)}
          </Typography>
          <Typography component="dt" variant="body2">
            {t`Elevation difference`}
          </Typography>
          <Typography component="dd" variant="body2">
            {renderElevation([firstElevation, lastElevation], ([first, last]) =>
              formatElevationChange((last ?? 0) - (first ?? 0), i18n),
            )}
          </Typography>
          {points.length > 2 ? (
            <>
              <Typography component="dt" variant="body2">
                {t`Ascent / descent`}
              </Typography>
              <Typography component="dd" variant="body2">
                {renderElevation(elevations, (available) => {
                  let ascent = 0;
                  let descent = 0;
                  for (let index = 1; index < available.length; index += 1) {
                    const change =
                      (available[index] ?? 0) - (available[index - 1] ?? 0);
                    if (change > 0) ascent += change;
                    else descent += change;
                  }
                  return `${formatElevationChange(ascent, i18n)} / ${formatElevationChange(descent, i18n)}`;
                })}
              </Typography>
            </>
          ) : null}
        </Box>
      )}
    </Paper>
  );
}
