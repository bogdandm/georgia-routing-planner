import { Trans, useLingui } from '@lingui/react/macro';
import { Alert, Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { sentinelArchiveStartDate } from '@/application/satellite/SearchSatelliteMosaic';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { AcquisitionCalendar } from '@/presentation/satellite-browser/AcquisitionCalendar';
import {
  useSatelliteMosaic,
  useSatelliteMosaicShowDisabledReason,
} from '@/presentation/satellite-browser/SatelliteMosaicProvider';
import { SatelliteRenderModeSelect } from '@/presentation/satellite-browser/SatelliteRenderingControls';
import { satelliteImageryProblemMessage } from '@/presentation/satellite-browser/satelliteProblemMessages';

interface SatelliteMosaicBrowserProps {
  /** Reveals the map on smartphones after the mosaic starts rendering. */
  readonly onShowMap: (() => void) | undefined;
}

export function SatelliteMosaicBrowser({ onShowMap }: SatelliteMosaicBrowserProps) {
  const { i18n, t } = useLingui();
  const { clock } = useRuntimeServices();
  const {
    activeDate,
    draftDate,
    requestActive,
    setDraftDate,
    setRenderModePending,
    showMosaic,
    shown,
  } = useSatelliteMosaic();
  const showDisabledReason = useSatelliteMosaicShowDisabledReason();
  const appliedMosaic = useStore(mapLayerStore, (state) => state.appliedMosaic);
  const [today] = useState(() => clock.now());
  const todayDate = today.toISOString().slice(0, 10);
  const latestMonth = todayDate.slice(0, 7);
  const [calendarMonth, setCalendarMonth] = useState(latestMonth);

  useEffect(
    () => () => {
      setRenderModePending(false);
    },
    [setRenderModePending],
  );

  const renderedSceneCount =
    appliedMosaic.status === 'empty'
      ? 0
      : appliedMosaic.status === 'loading'
        ? (appliedMosaic.renderProgress?.renderedSceneCount ?? 0)
        : appliedMosaic.sceneKeys.length;
  const hasRenderedScenes = renderedSceneCount > 0;
  let coverage = '';
  let firstDate = '';
  let lastDate = '';
  if (appliedMosaic.status !== 'empty') {
    /* eslint-disable lingui/no-unlocalized-strings -- Intl option and ISO date tokens. */
    const dayFormatter = new Intl.DateTimeFormat(i18n.locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const coverageFormatter = new Intl.NumberFormat(i18n.locale, {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    const oldestDate =
      appliedMosaic.oldestAcquisitionDate ?? appliedMosaic.selectedDate;
    coverage = coverageFormatter.format(appliedMosaic.coveragePercent / 100);
    firstDate = dayFormatter.format(new Date(`${oldestDate}T00:00:00.000Z`));
    lastDate = dayFormatter.format(
      new Date(`${appliedMosaic.selectedDate}T00:00:00.000Z`),
    );
    /* eslint-enable lingui/no-unlocalized-strings */
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography component="h3" variant="subtitle2">
        <Trans>Acquisition calendar</Trans>
      </Typography>
      <AcquisitionCalendar
        displayMonth={calendarMonth}
        maximumMonth={latestMonth}
        navigationDisabled={requestActive}
        onMonthChange={setCalendarMonth}
        today={today}
        mode={{
          kind: 'mosaic',
          selectedDate: draftDate,
          archiveStartDate: sentinelArchiveStartDate,
          onSelectDate: setDraftDate,
        }}
      />
      <Typography variant="body2" color="text.secondary">
        <Trans>All dates before it will be selected.</Trans>
      </Typography>

      <SatelliteRenderModeSelect onPendingChange={setRenderModePending} />

      <Tooltip
        title={
          showDisabledReason === null
            ? t`Fill the settled map view with a Mosaic`
            : i18n._(showDisabledReason)
        }
      >
        <span>
          <Button
            fullWidth
            variant="contained"
            disabled={showDisabledReason !== null}
            onClick={() => {
              showMosaic();
              onShowMap?.();
            }}
          >
            <Trans>Show mosaic</Trans>
          </Button>
        </span>
      </Tooltip>

      {!shown || activeDate === null || appliedMosaic.status === 'empty' ? null : (
        <Stack spacing={0.75} aria-live="polite">
          {appliedMosaic.status === 'failed' ? (
            <Alert severity="error">
              {i18n._(satelliteImageryProblemMessage(appliedMosaic.problem))}
            </Alert>
          ) : null}
          {appliedMosaic.status === 'ready' && !hasRenderedScenes ? (
            <Alert severity="info">
              <Trans>No Sentinel imagery found through the archive.</Trans>
            </Alert>
          ) : null}
          {hasRenderedScenes ? (
            <>
              <Typography variant="body2">
                <Trans>Coverage: {coverage}</Trans>
              </Typography>
              <Typography variant="body2">
                <Trans>Rendered images: {renderedSceneCount}</Trans>
              </Typography>
              <Typography variant="body2">
                <Trans>
                  Date range: {firstDate} to {lastDate}
                </Trans>
              </Typography>
            </>
          ) : null}
        </Stack>
      )}

      <Box>
        <Typography variant="caption" color="text.secondary">
          <Trans>Imagery: Copernicus Sentinel data via Element 84 Earth Search.</Trans>
        </Typography>
      </Box>
    </Stack>
  );
}
