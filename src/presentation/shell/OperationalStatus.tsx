import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import { Box, CircularProgress, LinearProgress, Typography } from '@mui/material';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { satelliteRequestStatusStore } from '@/presentation/satellite-browser/satelliteRequestStatusStore';

interface DisplayStatus {
  readonly kind: 'ready' | 'pending' | 'error';
  readonly message: string;
  readonly startedAt: number | null;
}

/** Quiet, always-visible summary of map and imagery work for ordinary users. */
export function OperationalStatus() {
  const { mapDiagnostics, mapProviderConfiguration } = useRuntimeServices();
  const appliedImagery = useStore(mapLayerStore, (state) => state.appliedImagery);
  const layerError = useStore(mapLayerStore, (state) => state.errorMessage);
  const requestStatus = useStore(satelliteRequestStatusStore);
  const subscribeToMap = useCallback(
    (listener: () => void) => mapDiagnostics.subscribe(listener),
    [mapDiagnostics],
  );
  const getMapSnapshot = useCallback(
    () => mapDiagnostics.getSnapshot(),
    [mapDiagnostics],
  );
  const mapSnapshot = useSyncExternalStore(
    subscribeToMap,
    getMapSnapshot,
    getMapSnapshot,
  );
  const [now, setNow] = useState(0);

  let display: DisplayStatus;
  if (mapProviderConfiguration.status === 'invalid') {
    display = {
      kind: 'error',
      message: mapProviderConfiguration.message,
      startedAt: null,
    };
  } else if (layerError !== null) {
    display = { kind: 'error', message: layerError, startedAt: null };
  } else if (requestStatus.status === 'error') {
    display = { kind: 'error', message: requestStatus.message, startedAt: null };
  } else if (
    mapSnapshot?.lifecycle === 'fatal' ||
    (mapSnapshot?.lifecycle === 'degraded' && mapSnapshot.message !== null)
  ) {
    display = {
      kind: 'error',
      message: mapSnapshot.message ?? 'Map data is unavailable.',
      startedAt: null,
    };
  } else if (appliedImagery.status === 'loading') {
    display = {
      kind: 'pending',
      message: appliedImagery.message,
      startedAt: appliedImagery.startedAt,
    };
  } else if (requestStatus.status === 'pending') {
    display = {
      kind: 'pending',
      message: requestStatus.message,
      startedAt: requestStatus.startedAt,
    };
  } else if (mapSnapshot === null || mapSnapshot.lifecycle === 'loading') {
    display = {
      kind: 'pending',
      message: 'Starting the map workspace…',
      startedAt: null,
    };
  } else {
    display = { kind: 'ready', message: requestStatus.message, startedAt: null };
  }

  useEffect(() => {
    if (display.kind !== 'pending') return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [display.kind]);

  const elapsedSeconds =
    display.startedAt === null
      ? null
      : Math.max(0, Math.floor((now - display.startedAt) / 1_000));

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute',
        top: 62,
        right: 64,
        zIndex: 2,
        width: 330,
        maxWidth: 'calc(100% - 144px)',
        px: 1.75,
        color: display.kind === 'error' ? 'error.dark' : 'text.secondary',
        textShadow: '0 1px 2px rgba(255,255,255,0.9)',
      }}
    >
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', minHeight: 20 }}>
        {display.kind === 'pending' ? (
          <CircularProgress size={14} thickness={5} aria-hidden />
        ) : display.kind === 'error' ? (
          <ErrorOutlineIcon color="error" sx={{ fontSize: 17 }} aria-hidden />
        ) : (
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 17 }} aria-hidden />
        )}
        <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
          {display.message}
          {display.kind === 'pending' && elapsedSeconds !== null
            ? ` · ${String(elapsedSeconds)}s`
            : ''}
        </Typography>
      </Box>
      {display.kind === 'pending' ? (
        <LinearProgress aria-hidden sx={{ mt: 0.25, height: 2, borderRadius: 1 }} />
      ) : null}
    </Box>
  );
}
