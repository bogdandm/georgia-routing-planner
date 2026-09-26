import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
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
  useMemo,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { satelliteRequestStatusStore } from '@/presentation/satellite-browser/satelliteRequestStatusStore';
const availableImagesMessage = msg({
  message:
    '{count, plural, one {# Sentinel image is available} other {# Sentinel images are available}}',
});
const mosaicRenderProgressMessage = msg({
  message:
    '{renderedSceneCount, number} of {totalSceneCount, number} Mosaic images rendered',
});
const weatherMapRenderProgressMessage = msg({
  message:
    '{loadedSourceCount, number} of {totalSourceCount, number} weather map sources rendered',
});
const queuedTerrainWorkMessage = msg({
  message:
    'Terrain worker · {queuedCount, number}/{capacity, number} queued{activeCount, plural, =0 {} one { · # task active} other { · # tasks active}}',
});
const activeTerrainWorkMessage = msg({
  message:
    'Terrain worker · {activeCount, plural, one {# task active} other {# tasks active}}',
});

interface DisplayStatus {
  readonly kind: 'ready' | 'pending' | 'warning' | 'error';
  readonly message: string;
  readonly startedAt: number | null;
  readonly announcement: 'polite' | 'assertive';
  readonly progressPercent?: number;
  readonly progressLabel?: string;
}

/** Quiet, always-visible summary of map and imagery work for ordinary users. */
export function OperationalStatus() {
  const { i18n, t } = useLingui();
  const { mapDiagnostics, mapProviderConfiguration } = useRuntimeServices();
  const appliedImagery = useStore(mapLayerStore, (state) => state.appliedImagery);
  const appliedMosaic = useStore(mapLayerStore, (state) => state.appliedMosaic);
  const automaticAlternativeProviderState = useStore(
    mapLayerStore,
    (state) => state.automaticAlternativeProviderState,
  );
  const layerError = useStore(mapLayerStore, (state) => state.errorMessage);
  const terrainQueue = useStore(mapLayerStore, (state) => state.terrainComputeQueue);
  const weatherMap = useStore(mapLayerStore, (state) => state.weatherMap);
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
  /* eslint-disable -- Intl options and ISO date syntax are locale-independent tokens. */
  const monthFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [i18n.locale],
  );
  const integerFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 0 }),
    [i18n.locale],
  );
  const loadingMonthLabel =
    requestStatus.status === 'pending' && requestStatus.code === 'loading-month'
      ? monthFormatter.format(new Date(`${requestStatus.month}-01T00:00:00.000Z`))
      : null;
  /* eslint-enable */

  let satelliteStatusMessage: string;
  if (requestStatus.status === 'pending') {
    satelliteStatusMessage =
      loadingMonthLabel !== null
        ? t`Loading Sentinel imagery for ${loadingMonthLabel}`
        : t`Searching the Earth Search Sentinel catalog…`;
  } else if (requestStatus.status === 'ready') {
    if (requestStatus.code === 'catalog-ready') {
      satelliteStatusMessage = t`Sentinel catalog ready`;
    } else if (requestStatus.code === 'search-cancelled') {
      satelliteStatusMessage = t`Sentinel search cancelled`;
    } else if (requestStatus.code === 'images-available') {
      satelliteStatusMessage = i18n._({
        ...availableImagesMessage,
        values: { count: requestStatus.count },
      });
    } else {
      satelliteStatusMessage = t`Ready`;
    }
  } else {
    satelliteStatusMessage = t`Sentinel imagery search failed. Try again.`;
  }

  let display: DisplayStatus;
  if (mapProviderConfiguration.status === 'invalid') {
    display = {
      kind: 'error',
      message: t`Map provider configuration is invalid.`,
      startedAt: null,
      announcement: 'assertive',
    };
  } else if (mapSnapshot?.lifecycle === 'fatal') {
    display = {
      kind: 'error',
      message: t`The map could not be loaded.`,
      startedAt: null,
      announcement: 'assertive',
    };
  } else if (automaticAlternativeProviderState === 'switching') {
    display = {
      kind: 'warning',
      message: t`TiTiler is unavailable. Switching to direct pre-rendered Sentinel imagery.`,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (layerError !== null) {
    display = {
      kind: 'error',
      message: t`A map layer update failed. Try again.`,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (requestStatus.status === 'error') {
    display = {
      kind: 'error',
      message: satelliteStatusMessage,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (mapSnapshot?.lifecycle === 'degraded' && mapSnapshot.message !== null) {
    display = {
      kind: 'error',
      message: t`The map is running in a degraded state.`,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (appliedImagery.status === 'loading') {
    const message =
      appliedImagery.stage === 'preparing'
        ? t`Preparing the selected Sentinel scene…`
        : appliedImagery.stage === 'requesting-tiles'
          ? t`Requesting Sentinel imagery tiles…`
          : appliedImagery.stage === 'rendering'
            ? t`Rendering the selected Sentinel scene…`
            : t`Finalizing the selected Sentinel scene…`;
    display = {
      kind: 'pending',
      message,
      startedAt: appliedImagery.startedAt,
      announcement: 'polite',
    };
  } else if (appliedMosaic.status === 'loading') {
    const renderProgress = appliedMosaic.renderProgress;
    display = {
      kind: 'pending',
      message:
        renderProgress === null
          ? t`Searching Sentinel archive…`
          : i18n._({
              ...mosaicRenderProgressMessage,
              values: {
                renderedSceneCount: renderProgress.renderedSceneCount,
                totalSceneCount: renderProgress.totalSceneCount,
              },
            }),
      startedAt: null,
      announcement: 'polite',
      ...(renderProgress === null
        ? {}
        : {
            progressPercent:
              renderProgress.totalSceneCount === 0
                ? 0
                : (renderProgress.renderedSceneCount / renderProgress.totalSceneCount) *
                  100,
            progressLabel: t`Rendering Mosaic images`,
          }),
    };
  } else if (weatherMap.status === 'loading') {
    display = {
      kind: 'pending',
      message: t`Loading ECMWF weather map…`,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (weatherMap.enabled && weatherMap.renderProgress !== null) {
    const { loadedSourceCount, totalSourceCount } = weatherMap.renderProgress;
    display = {
      kind: 'pending',
      message: i18n._({
        ...weatherMapRenderProgressMessage,
        values: { loadedSourceCount, totalSourceCount },
      }),
      startedAt: null,
      announcement: 'polite',
      progressPercent:
        totalSourceCount === 0 ? 0 : (loadedSourceCount / totalSourceCount) * 100,
      progressLabel: t`Rendering weather map`,
    };
  } else if (requestStatus.status === 'pending') {
    display = {
      kind: 'pending',
      message: satelliteStatusMessage,
      startedAt: requestStatus.startedAt,
      announcement: 'polite',
    };
  } else if (mapSnapshot === null || mapSnapshot.lifecycle === 'loading') {
    display = {
      kind: 'pending',
      message: t`Starting the map workspace…`,
      startedAt: null,
      announcement: 'polite',
    };
  } else if (automaticAlternativeProviderState === 'active') {
    display = {
      kind: 'warning',
      message: t`TiTiler is unavailable. Direct pre-rendered Sentinel imagery is active.`,
      startedAt: null,
      announcement: 'polite',
    };
  } else {
    display = {
      kind: 'ready',
      message: satelliteStatusMessage,
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
      ? t`Terrain compute · compatibility mode`
      : terrainQueue.executionMode === 'restarting'
        ? t`Terrain worker · restarting`
        : terrainQueue.queuedContourCount > 0
          ? i18n._({
              ...queuedTerrainWorkMessage,
              values: {
                queuedCount: terrainQueue.queuedContourCount,
                capacity: terrainQueue.queueCapacity,
                activeCount: terrainQueue.activeCount,
              },
            })
          : terrainQueue.activeCount > 0
            ? i18n._({
                ...activeTerrainWorkMessage,
                values: { activeCount: terrainQueue.activeCount },
              })
            : null;
  const elapsedLabel =
    elapsedSeconds === null ? null : t`${integerFormatter.format(elapsedSeconds)} s`;

  /* eslint-disable -- MUI, CSS, and ARIA control tokens are not user-visible copy. */
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
        right: 54,
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
            : display.kind === 'warning'
              ? 'warning.dark'
              : display.kind === 'pending'
                ? 'primary.dark'
                : 'text.secondary',
        textShadow:
          display.kind === 'ready' ? '0 1px 2px rgba(255,255,255,0.9)' : 'none',
      }}
    >
      <Box
        component={display.kind === 'error' ? ButtonBase : 'div'}
        aria-label={
          display.kind === 'error' ? t`Show current error details` : undefined
        }
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
        ) : display.kind === 'warning' ? (
          <WarningAmberOutlinedIcon color="warning" sx={{ fontSize: 17 }} aria-hidden />
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
            {display.kind === 'pending' && elapsedLabel !== null
              ? ` · ${elapsedLabel}`
              : ''}
          </Typography>
        </Tooltip>
      </Box>
      {display.kind === 'pending' ? (
        <LinearProgress
          aria-hidden={display.progressLabel === undefined ? true : undefined}
          aria-label={display.progressLabel}
          variant={
            display.progressPercent === undefined ? 'indeterminate' : 'determinate'
          }
          value={display.progressPercent}
          sx={{ mt: 0.25, height: 2, borderRadius: 1 }}
        />
      ) : null}
      {display.kind === 'ready' && terrainActivityLabel !== null ? (
        <Typography
          variant="caption"
          color="text.secondary"
          aria-label={t`Terrain compute queue state`}
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
        <Typography variant="subtitle2">{t`Current map error`}</Typography>
        <Typography variant="body2" color="text.secondary">
          {display.message}
        </Typography>
      </Popover>
    </Box>
  );
  /* eslint-enable */
}
