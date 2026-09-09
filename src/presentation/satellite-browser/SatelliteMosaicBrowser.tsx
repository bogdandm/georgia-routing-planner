import { Alert, Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { sentinelArchiveStartDate } from '@/application/satellite/SearchSatelliteMosaic';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { AcquisitionCalendar } from '@/presentation/satellite-browser/AcquisitionCalendar';
import { useSatelliteMosaic } from '@/presentation/satellite-browser/SatelliteMosaicProvider';
import { SatelliteRenderModeSelect } from '@/presentation/satellite-browser/SatelliteRenderingControls';

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(date: string): string {
  return dayFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

export function SatelliteMosaicBrowser() {
  const { clock } = useRuntimeServices();
  const {
    activeDate,
    draftDate,
    requestActive,
    setDraftDate,
    setRenderModePending,
    showDisabledReason,
    showMosaic,
    shown,
  } = useSatelliteMosaic();
  const appliedMosaic = useStore(mapLayerStore, (state) => state.appliedMosaic);
  const today = clock.now();
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

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography component="h3" variant="subtitle2">
        Acquisition calendar
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
        All dates before it will be selected.
      </Typography>

      <SatelliteRenderModeSelect onPendingChange={setRenderModePending} />

      <Tooltip title={showDisabledReason ?? 'Fill the settled map view with a Mosaic'}>
        <span>
          <Button
            fullWidth
            variant="contained"
            disabled={showDisabledReason !== null}
            onClick={showMosaic}
          >
            Show mosaic
          </Button>
        </span>
      </Tooltip>

      {!shown || activeDate === null || appliedMosaic.status === 'empty' ? null : (
        <Stack spacing={0.75} aria-live="polite">
          {appliedMosaic.status === 'failed' ? (
            <Alert severity="error">{appliedMosaic.message}</Alert>
          ) : null}
          {appliedMosaic.status === 'ready' && !hasRenderedScenes ? (
            <Alert severity="info">
              No Sentinel imagery found through the archive.
            </Alert>
          ) : null}
          {hasRenderedScenes ? (
            <>
              <Typography variant="body2">
                Coverage: {appliedMosaic.coveragePercent.toFixed(1)}%
              </Typography>
              <Typography variant="body2">
                Rendered images: {renderedSceneCount}
              </Typography>
              <Typography variant="body2">
                Date range:{' '}
                {formatDate(
                  appliedMosaic.oldestAcquisitionDate ?? appliedMosaic.selectedDate,
                )}{' '}
                to {formatDate(appliedMosaic.selectedDate)}
              </Typography>
            </>
          ) : null}
        </Stack>
      )}

      <Box>
        <Typography variant="caption" color="text.secondary">
          Imagery: Copernicus Sentinel data via Element 84 Earth Search.
        </Typography>
      </Box>
    </Stack>
  );
}
