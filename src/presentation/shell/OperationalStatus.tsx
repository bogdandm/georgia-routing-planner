import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import {
  Box,
  ButtonBase,
  CircularProgress,
  LinearProgress,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { satelliteRequestStatusStore } from '@/presentation/satellite-browser/satelliteRequestStatusStore';

interface DisplayStatus {
  readonly kind: 'ready' | 'pending' | 'error';
  readonly message: string;
  readonly startedAt: number | null;
  readonly announcement: 'polite' | 'assertive';
}

/** Quiet, always-visible summary of map and imagery work for ordinary users. */
export function OperationalStatus() {
  const { mapDiagnostics, mapProviderConfiguration } = useRuntimeServices();
  const appliedImagery = useStore(mapLayerStore, (state) => state.appliedImagery);
  const layerError = useStore(mapLayerStore, (state) => state.errorMessage);
  const terrainQueue = useStore(mapLayerStore, (state) => state.terrainComputeQueue);
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
  const [errorAnchor, setErrorAnchor] = useState<HTMLElement | null>(null);

  let display: DisplayStatus;
  if (mapProviderConfiguration.status === 'invalid') {
    display = {
      kind: 'error',
      message: mapProviderConfiguration.message,
      startedAt: null,
      announcement: 'assertive',
    };
  } else if (mapSnapshot?.lifecycle === 'fatal') {
    display = {
      kind: 'error',
      message: mapSnapshot.message ?? 'Map data is unavailable.',
      startedAt: null,
      announcement: 'assertive',
    };
  } else if (layerError !== null) {
    display = {
      kind: 'error',
      message: layerError,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (requestStatus.status === 'error') {
    display = {
      kind: 'error',
      message: requestStatus.message,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (mapSnapshot?.lifecycle === 'degraded' && mapSnapshot.message !== null) {
    display = {
      kind: 'error',
      message: mapSnapshot.message,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (appliedImagery.status === 'loading') {
    display = {
      kind: 'pending',
      message: appliedImagery.message,
      startedAt: appliedImagery.startedAt,
      announcement: 'polite',
    };
  } else if (requestStatus.status === 'pending') {
    display = {
      kind: 'pending',
      message: requestStatus.message,
      startedAt: requestStatus.startedAt,
      announcement: 'polite',
    };
  } else if (mapSnapshot === null || mapSnapshot.lifecycle === 'loading') {
    display = {
      kind: 'pending',
      message: 'Starting the map workspace…',
      startedAt: null,
      announcement: 'polite',
    };
  } else {
    display = {
      kind: 'ready',
      message: requestStatus.message,
      startedAt: null,
      announcement: 'polite',
    };
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

  const terrainActivityLabel =
    terrainQueue.executionMode === 'inline'
      ? 'Terrain compute · compatibility mode'
      : terrainQueue.executionMode === 'restarting'
        ? 'Terrain worker · restarting'
        : terrainQueue.queuedContourCount > 0
          ? `Terrain worker · queue ${String(terrainQueue.queuedContourCount)}/${String(terrainQueue.queueCapacity)}${terrainQueue.activeCount > 0 ? ` · ${String(terrainQueue.activeCount)} active` : ''}`
          : terrainQueue.activeCount > 0
            ? `Terrain worker · ${String(terrainQueue.activeCount)} active`
            : null;

  const handleErrorDetailsOpen = (event: MouseEvent<HTMLElement>) => {
    setErrorAnchor(event.currentTarget);
  };

  return (
    <Box
      role={display.announcement === 'assertive' ? 'alert' : 'status'}
      aria-live={display.announcement}
      sx={{
        position: 'absolute',
        top: 56,
        right: 47,
        zIndex: 2,
        width: 330,
        maxWidth: 'calc(100% - 144px)',
        px: 1.75,
        py: 0.375,
        bgcolor: display.kind === 'ready' ? 'transparent' : 'rgba(255, 255, 255, 0.42)',
        backdropFilter: display.kind === 'ready' ? 'none' : 'blur(3px)',
        borderRadius: 1,
        boxShadow:
          display.kind === 'ready' ? 'none' : '0 1px 4px rgba(2, 48, 71, 0.08)',
        transition: (theme) =>
          theme.transitions.create(
            ['background-color', 'backdrop-filter', 'box-shadow'],
            { duration: 120 },
          ),
        color:
          display.kind === 'error'
            ? 'error.dark'
            : display.kind === 'pending'
              ? 'primary.dark'
              : 'text.secondary',
        textShadow:
          display.kind === 'ready' ? '0 1px 2px rgba(255,255,255,0.9)' : 'none',
      }}
    >
      <Box
        component={display.kind === 'error' ? ButtonBase : 'div'}
        aria-label={display.kind === 'error' ? 'Show current error details' : undefined}
        onClick={display.kind === 'error' ? handleErrorDetailsOpen : undefined}
        sx={{
          display: 'flex',
          width: '100%',
          gap: 0.75,
          alignItems: 'center',
          justifyContent: 'flex-start',
          minHeight: 20,
          borderRadius: 0.5,
          cursor: display.kind === 'error' ? 'pointer' : 'default',
        }}
      >
        {display.kind === 'pending' ? (
          <CircularProgress size={14} thickness={5} aria-hidden />
        ) : display.kind === 'error' ? (
          <ErrorOutlineIcon color="error" sx={{ fontSize: 17 }} aria-hidden />
        ) : (
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 17 }} aria-hidden />
        )}
        <Tooltip
          title={display.message}
          placement="bottom-start"
          slotProps={{
            tooltip: {
              sx: { maxWidth: 360, whiteSpace: 'normal', overflowWrap: 'anywhere' },
            },
          }}
        >
          <Typography
            variant="caption"
            noWrap
            sx={{
              minWidth: 0,
              flex: 1,
              fontWeight: display.kind === 'ready' ? 400 : 500,
            }}
          >
            {display.message}
            {display.kind === 'pending' && elapsedSeconds !== null
              ? ` · ${String(elapsedSeconds)}s`
              : ''}
          </Typography>
        </Tooltip>
      </Box>
      {display.kind === 'pending' ? (
        <LinearProgress aria-hidden sx={{ mt: 0.25, height: 2, borderRadius: 1 }} />
      ) : null}
      {display.kind === 'ready' && terrainActivityLabel !== null ? (
        <Typography
          variant="caption"
          color="text.secondary"
          aria-label="Terrain compute queue state"
          sx={{ display: 'block', pl: 2.875, lineHeight: 1.25 }}
        >
          {terrainActivityLabel}
        </Typography>
      ) : null}
      <Popover
        open={errorAnchor !== null && display.kind === 'error'}
        anchorEl={errorAnchor}
        onClose={() => {
          setErrorAnchor(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 0.5, p: 1.5, maxWidth: 360 } } }}
      >
        <Typography variant="subtitle2">Current map error</Typography>
        <Typography variant="body2" color="text.secondary">
          {display.message}
        </Typography>
      </Popover>
    </Box>
  );
}
