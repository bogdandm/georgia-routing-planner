import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CompareOutlinedIcon from '@mui/icons-material/CompareOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import lookupTimeZone from '@photostructure/tz-lookup';
import {
  Alert,
  Box,
  Button,
  IconButton,
  LinearProgress,
  Snackbar,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  satelliteSceneBounds,
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';
import type { SatelliteSearchResult } from '@/domain/satellite/SatelliteSearchResult';
import { createComparisonShareUrl } from '@/presentation/map/mapShareUrl';
import type { SatelliteCompareCamera } from '@/presentation/map/SatelliteCompareMaps';
import { defaultGeorgiaCamera, type MapCamera } from '@/presentation/map/mapTypes';
import { appColors } from '@/presentation/theme/appColors';
import { AcquisitionCalendar } from '@/presentation/satellite-browser/AcquisitionCalendar';
import {
  bestCoverageMatchOn,
  cachedCalendarMonth,
  loadCalendarMonth,
  toDateInputValue,
} from '@/presentation/satellite-browser/satelliteCalendarSearch';
import {
  clearComparedScenes,
  clearComparisonSlot,
  clearComparisonSlots,
  closeComparison,
  maximumComparedScenes,
  minimumComparedScenes,
  openComparison,
  openComparisonGrid,
  satelliteCompareStore,
  type ComparisonTileProgress,
  setComparisonSlot,
} from '@/presentation/satellite-browser/satelliteCompareStore';

/** Zoom used when the main map has no camera yet, roughly one Sentinel tile. */
const fallbackComparisonZoom = 10;

/** The main map's camera, else the first tray scene, else the Georgia overview. */
function startingComparisonCamera(
  camera: MapCamera | undefined,
  firstScene: SatelliteScene | undefined,
): SatelliteCompareCamera {
  if (camera !== undefined) {
    return {
      center: { longitude: camera.longitude, latitude: camera.latitude },
      zoom: camera.zoom,
    };
  }
  if (firstScene !== undefined) {
    const [west, south, east, north] = satelliteSceneBounds(firstScene);
    return {
      center: { longitude: (west + east) / 2, latitude: (south + north) / 2 },
      zoom: fallbackComparisonZoom,
    };
  }
  return {
    center: {
      longitude: defaultGeorgiaCamera.longitude,
      latitude: defaultGeorgiaCamera.latitude,
    },
    zoom: defaultGeorgiaCamera.zoom,
  };
}

interface ComparedSceneDatePickerProps {
  readonly slotIndex: number;
  /** The pane's scene, or null for a plain map whose date is still to be picked. */
  readonly scene: SatelliteScene | null;
  /** The pane's visible area: it anchors the search and weights day coverage. */
  readonly viewport: SatelliteSearchViewport;
  readonly onClose: () => void;
}

interface MonthSearch {
  readonly month: string;
  readonly result: SatelliteSearchResult | null;
  readonly failed: boolean;
}

/**
 * The Satellite acquisition calendar for one comparison pane. It opens on the scene's
 * month, or the current one; a day shows that day's best-coverage scene in the pane, as
 * in the search.
 */
export function ComparedSceneDatePicker({
  slotIndex,
  scene,
  viewport,
  onClose,
}: ComparedSceneDatePickerProps) {
  const { t } = useLingui();
  const { clock, database, searchSatelliteScenes } = useRuntimeServices();
  const [today] = useState(() => clock.now());
  const latestMonth = toDateInputValue(today).slice(0, 7);
  const [month, setMonth] = useState(scene?.acquiredAt.slice(0, 7) ?? latestMonth);
  const [maxCloudCoverPercent, setMaxCloudCoverPercent] = useState(50);
  const [search, setSearch] = useState<MonthSearch | null>(null);
  const [alreadyCompared, setAlreadyCompared] = useState(false);
  const cachedResult =
    searchSatelliteScenes === null
      ? undefined
      : cachedCalendarMonth(searchSatelliteScenes, viewport, month, today);
  const monthSearch: MonthSearch | null =
    cachedResult !== undefined
      ? { month, result: cachedResult, failed: false }
      : search?.month === month
        ? search
        : null;

  useEffect(() => {
    let active = true;
    void database.loadMaximumCloudCoverPercent().then(
      (value) => {
        if (active) setMaxCloudCoverPercent(value);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [database]);

  const monthCached = cachedResult !== undefined;
  useEffect(() => {
    if (searchSatelliteScenes === null || monthCached) return undefined;
    const controller = new AbortController();
    loadCalendarMonth(
      searchSatelliteScenes,
      viewport,
      month,
      today,
      controller.signal,
    ).then(
      (result) => {
        if (!controller.signal.aborted) setSearch({ month, result, failed: false });
      },
      () => {
        if (!controller.signal.aborted)
          setSearch({ month, result: null, failed: true });
      },
    );
    return () => {
      controller.abort();
    };
  }, [month, monthCached, searchSatelliteScenes, today, viewport]);

  const selectDate = (date: string) => {
    const result = monthSearch?.result;
    const match =
      result === undefined || result === null
        ? undefined
        : bestCoverageMatchOn(result, date);
    if (match === undefined) return;
    if (scene !== null && satelliteSceneKey(match.scene) === satelliteSceneKey(scene)) {
      onClose();
      return;
    }
    if (!setComparisonSlot(slotIndex, match.scene)) {
      setAlreadyCompared(true);
      return;
    }
    onClose();
  };

  return (
    <Stack spacing={1.5} sx={{ p: 2, width: 388 }}>
      <Typography component="h3" variant="subtitle2">
        {scene === null ? (
          <Trans>Pick image date</Trans>
        ) : (
          <Trans>Change image date</Trans>
        )}
      </Typography>
      <AcquisitionCalendar
        displayMonth={month}
        maximumMonth={latestMonth}
        navigationDisabled={false}
        onMonthChange={(nextMonth) => {
          setMonth(nextMonth);
          setAlreadyCompared(false);
        }}
        today={today}
        mode={{
          kind: 'scene',
          loadingMonth: monthSearch === null ? month : null,
          maxCloudCoverPercent,
          result: monthSearch?.result ?? null,
          onSelectDate: selectDate,
        }}
      />
      {monthSearch?.failed === true ? (
        <Alert severity="error">{t`Images for this month could not be loaded.`}</Alert>
      ) : null}
      {alreadyCompared ? (
        <Alert severity="info">{t`That image is already in the comparison.`}</Alert>
      ) : null}
    </Stack>
  );
}

/**
 * Pinned at the bottom of the results pane once a scene is added: the comparison count,
 * **Compare** (two or more scenes), and **Clear**.
 */
export function SatelliteComparisonTray() {
  const { t } = useLingui();
  const { mapDiagnostics } = useRuntimeServices();
  const scenes = useStore(satelliteCompareStore, (state) => state.scenes);
  const firstScene = scenes[0];
  if (firstScene === undefined) return null;

  const count = scenes.length;
  const canCompare = count >= minimumComparedScenes;
  const open = () => {
    openComparison(
      startingComparisonCamera(mapDiagnostics.getSnapshot()?.camera, firstScene),
    );
  };

  return (
    <Stack
      role="region"
      aria-label={t`Image comparison`}
      direction="row"
      spacing={1}
      sx={{
        minHeight: 56,
        px: 2,
        alignItems: 'center',
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: appColors.surface.subtle,
      }}
    >
      <CompareOutlinedIcon color="primary" fontSize="small" />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
        <Trans>
          Comparison: {count} of {maximumComparedScenes}
        </Trans>
      </Typography>
      <Button color="inherit" onClick={clearComparedScenes}>
        <Trans>Clear</Trans>
      </Button>
      <Tooltip title={canCompare ? '' : t`Add at least two images`}>
        <span>
          <Button variant="contained" disabled={!canCompare} onClick={open}>
            <Trans>Compare</Trans>
          </Button>
        </span>
      </Tooltip>
    </Stack>
  );
}

/**
 * Satellite header shortcut: a 2×2 grid with the tray's scenes first and plain maps
 * whose dates are picked from each pane's calendar.
 */
export function SatelliteComparisonShortcut() {
  const { t } = useLingui();
  const { mapDiagnostics } = useRuntimeServices();
  return (
    <Tooltip title={t`Compare images from different dates side by side`}>
      <ToggleButton
        size="small"
        value="compare"
        selected={false}
        aria-label={t`Open image comparison`}
        sx={{ gap: 0.75 }}
        onClick={() => {
          openComparisonGrid(
            startingComparisonCamera(
              mapDiagnostics.getSnapshot()?.camera,
              satelliteCompareStore.getState().scenes[0],
            ),
          );
        }}
      >
        <CompareOutlinedIcon sx={{ fontSize: 20 }} />
        <Trans>Compare</Trans>
      </ToggleButton>
    </Tooltip>
  );
}

/** One map's Sentinel tile loading: waiting, a determinate bar, then complete. */
function TileProgressBar({
  day,
  progress,
}: {
  readonly day: string;
  readonly progress: ComparisonTileProgress | undefined;
}) {
  const { t } = useLingui();
  const finished = progress?.finished ?? 0;
  const requested = progress?.requested ?? 0;
  const complete = progress?.complete === true;
  const percent = complete
    ? 100
    : requested === 0
      ? null
      : Math.round((finished / requested) * 100);
  return (
    <Box sx={{ mt: 0.75 }}>
      <LinearProgress
        aria-label={t`Imagery loading for ${day}`}
        color={complete ? 'success' : 'primary'}
        variant={percent === null ? 'indeterminate' : 'determinate'}
        value={percent ?? 0}
        sx={{ height: 4, borderRadius: 2 }}
      />
      <Typography variant="caption" color="text.secondary">
        {complete
          ? t`Imagery loaded`
          : percent === null
            ? t`Waiting for imagery…`
            : t`${finished} of ${requested} tiles`}
      </Typography>
    </Box>
  );
}
function sceneTimeZone(scene: SatelliteScene): string {
  const [west, south, east, north] = satelliteSceneBounds(scene);
  return lookupTimeZone((south + north) / 2, (west + east) / 2);
}

/** Sidebar content while the comparison grid replaces the map. */
export function SatelliteComparisonPanel() {
  const { i18n, t } = useLingui();
  const slots = useStore(satelliteCompareStore, (state) => state.slots);
  const directFallback = useStore(
    satelliteCompareStore,
    (state) => state.directFallback,
  );
  const tileProgress = useStore(satelliteCompareStore, (state) => state.tileProgress);
  const filledSlots = slots.flatMap((scene, index) =>
    scene === null ? [] : [{ scene, index }],
  );
  const sceneCount = filledSlots.length;
  const camera = useStore(satelliteCompareStore, (state) => state.camera);
  const [copyLinkStatus, setCopyLinkStatus] = useState<'idle' | 'copied' | 'failed'>(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
    'idle',
  );
  /* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
  const formats = useMemo(
    () => ({
      day: (acquiredAt: Date, timeZone: string) =>
        new Intl.DateTimeFormat(i18n.locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone,
        }).format(acquiredAt),
      time: (acquiredAt: Date, timeZone: string) =>
        new Intl.DateTimeFormat(i18n.locale, {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone,
          timeZoneName: 'short',
        }).format(acquiredAt),
      percent: new Intl.NumberFormat(i18n.locale, {
        style: 'percent',
        maximumFractionDigits: 0,
      }),
    }),
    [i18n.locale],
  );
  /* eslint-enable lingui/no-unlocalized-strings */

  const copyLink = async () => {
    if (camera === null) return;
    try {
      await navigator.clipboard.writeText(
        createComparisonShareUrl(
          window.location.href,
          camera.center,
          camera.zoom,
          filledSlots.map(({ scene }) => satelliteSceneKey(scene)),
        ),
      );
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setCopyLinkStatus('copied');
    } catch {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setCopyLinkStatus('failed');
    }
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Box>
        <Button
          color="inherit"
          startIcon={<ArrowBackOutlinedIcon />}
          onClick={closeComparison}
          sx={{ ml: -1 }}
        >
          <Trans>Back to search</Trans>
        </Button>
      </Box>
      <Typography component="h3" variant="subtitle2">
        {t`${plural(sceneCount, {
          one: 'Comparing # image',
          other: 'Comparing # images',
        })}`}
      </Typography>
      {directFallback ? (
        <Alert severity="warning">
          {t`TiTiler is unavailable. Direct pre-rendered Sentinel imagery is active and loads more slowly.`}
        </Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        <Trans>
          Click a date on a map to pick another image. Drag a date onto another map to
          swap their places.
        </Trans>
      </Typography>
      <Stack component="ul" spacing={0} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {filledSlots.map(({ scene, index }) => {
          const acquiredAt = new Date(scene.acquiredAt);
          const timeZone = sceneTimeZone(scene);
          const day = formats.day(acquiredAt, timeZone);
          const time = formats.time(acquiredAt, timeZone);
          const cloud = formats.percent.format(
            Math.round(scene.cloudCoverPercent) / 100,
          );
          return (
            <Stack
              component="li"
              key={index}
              direction="row"
              spacing={1}
              sx={{
                py: 1,
                alignItems: 'center',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">{day}</Typography>
                <Typography variant="caption" color="text.secondary">
                  <Trans>
                    {time} · {cloud} cloud
                  </Trans>
                </Typography>
                {/* A scene without a supported raster shows a warning in its pane. */}
                {scene.visualAsset.kind === 'sentinel-l2a' ? (
                  <TileProgressBar day={day} progress={tileProgress[index]} />
                ) : null}
              </Box>
              <Tooltip title={t`Remove ${day} from comparison`}>
                <IconButton
                  aria-label={t`Remove ${day} from comparison`}
                  onClick={() => {
                    clearComparisonSlot(index);
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          );
        })}
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          startIcon={<ShareOutlinedIcon />}
          disabled={camera === null || sceneCount < minimumComparedScenes}
          onClick={() => void copyLink()}
        >
          <Trans>Share link</Trans>
        </Button>
        <Button color="inherit" onClick={clearComparisonSlots}>
          <Trans>Clear</Trans>
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        <Trans>Imagery: Copernicus Sentinel data via Element 84 Earth Search.</Trans>
      </Typography>
      <Snackbar
        open={copyLinkStatus !== 'idle'}
        autoHideDuration={copyLinkStatus === 'copied' ? 2_500 : 4_000}
        message={
          copyLinkStatus === 'copied'
            ? t`Comparison link copied`
            : t`Clipboard access failed. Try again.`
        }
        onClose={() => {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
          setCopyLinkStatus('idle');
        }}
      />
    </Stack>
  );
}
