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
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  satelliteSceneBounds,
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';
import type { SatelliteSearchResult } from '@/domain/satellite/SatelliteSearchResult';
import {
  createComparisonShareUrl,
  satelliteBasemapLabels,
} from '@/presentation/map/mapShareUrl';
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
  clearComparedImages,
  clearComparisonSlot,
  clearComparisonSlots,
  closeComparison,
  comparisonImageKey,
  isComparisonBasemap,
  maximumComparedScenes,
  minimumComparedScenes,
  openComparison,
  openComparisonGrid,
  satelliteCompareStore,
  setComparisonCalendarMonth,
  setComparisonLayout,
  setComparisonSlot,
  type ComparisonImage,
  type ComparisonLayout,
  type ComparisonTileProgress,
} from '@/presentation/satellite-browser/satelliteCompareStore';

/** Zoom used when the main map has no camera yet, roughly one Sentinel tile. */
const fallbackComparisonZoom = 10;

/** The main map's camera, else the first tray scene, else the Georgia overview. */
function startingComparisonCamera(
  camera: MapCamera | undefined,
  images: readonly ComparisonImage[],
): SatelliteCompareCamera {
  const firstScene = images.find(
    (image): image is SatelliteScene => !isComparisonBasemap(image),
  );
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
 * The Satellite acquisition calendar for one comparison pane. It opens on the month any
 * pane's calendar showed last, else the scene's month, else the current one; a day shows
 * that day's best-coverage scene in the pane, as in the search.
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
  const [month, setMonth] = useState(
    () =>
      satelliteCompareStore.getState().calendarMonth ??
      scene?.acquiredAt.slice(0, 7) ??
      latestMonth,
  );
  useEffect(() => {
    setComparisonCalendarMonth(month);
  }, [month]);
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
  const { mapDiagnostics, mapViewport } = useRuntimeServices();
  const images = useStore(satelliteCompareStore, (state) => state.images);
  if (images.length === 0) return null;

  const count = images.length;
  const canCompare = count >= minimumComparedScenes;
  const open = () => {
    openComparison(
      startingComparisonCamera(mapDiagnostics.getSnapshot()?.camera, images),
      mapViewport.getViewportSnapshot(),
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
      <Button color="inherit" onClick={clearComparedImages}>
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
 * Satellite header shortcut: a 2×2 grid with the tray's images first and plain maps
 * whose images are picked from each pane's calendar or imagery menu.
 */
export function SatelliteComparisonShortcut() {
  const { t } = useLingui();
  const { mapDiagnostics, mapViewport } = useRuntimeServices();
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
              satelliteCompareStore.getState().images,
            ),
            mapViewport.getViewportSnapshot(),
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
  const filledSlots = slots.flatMap((image, index) =>
    image === null ? [] : [{ image, index }],
  );
  const imageCount = filledSlots.length;
  const twoMapsAvailable = imageCount <= 2;
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
          filledSlots.map(({ image }) => comparisonImageKey(image)),
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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography component="h3" variant="subtitle2" sx={{ flex: 1 }}>
          {t`${plural(imageCount, {
            one: 'Comparing # image',
            other: 'Comparing # images',
          })}`}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label={t`Map layout`}
          value={slots.length}
          onChange={(_event, layout: ComparisonLayout | null) => {
            if (layout !== null) setComparisonLayout(layout);
          }}
        >
          <Tooltip
            title={
              twoMapsAvailable
                ? t`Two maps side by side`
                : t`Remove images until two remain to show two maps`
            }
          >
            <span>
              <ToggleButton
                value={2}
                disabled={!twoMapsAvailable}
                aria-label={t`Two maps side by side`}
                sx={{ px: 1.25, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              >
                2×1
              </ToggleButton>
            </span>
          </Tooltip>
          <Tooltip title={t`Four maps in a 2×2 grid`}>
            <ToggleButton
              value={maximumComparedScenes}
              aria-label={t`Four maps in a 2×2 grid`}
              sx={{ px: 1.25 }}
            >
              2×2
            </ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>
      </Stack>
      {directFallback ? (
        <Alert severity="warning">
          {t`TiTiler is unavailable. Direct pre-rendered Sentinel imagery is active and loads more slowly.`}
        </Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        <Trans>
          Click a date on a map to pick another image, or the layers button next to it
          for static satellite imagery. Drag a label onto another map to swap their
          places.
        </Trans>
      </Typography>
      <Stack component="ul" spacing={0} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {filledSlots.map(({ image, index }) => {
          let title: string;
          let details: ReactNode = null;
          if (isComparisonBasemap(image)) {
            title = i18n._(satelliteBasemapLabels[image]);
          } else {
            const acquiredAt = new Date(image.acquiredAt);
            const timeZone = sceneTimeZone(image);
            title = formats.day(acquiredAt, timeZone);
            const time = formats.time(acquiredAt, timeZone);
            const cloud = formats.percent.format(
              Math.round(image.cloudCoverPercent) / 100,
            );
            details = (
              <>
                <Typography variant="caption" color="text.secondary">
                  <Trans>
                    {time} · {cloud} cloud
                  </Trans>
                </Typography>
                {/* A scene without a supported raster shows a warning in its pane. */}
                {image.visualAsset.kind === 'sentinel-l2a' ? (
                  <TileProgressBar day={title} progress={tileProgress[index]} />
                ) : null}
              </>
            );
          }
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
                <Typography variant="subtitle2">{title}</Typography>
                {details}
              </Box>
              <Tooltip title={t`Remove ${title} from comparison`}>
                <IconButton
                  aria-label={t`Remove ${title} from comparison`}
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
          disabled={camera === null || imageCount < minimumComparedScenes}
          onClick={() => void copyLink()}
        >
          <Trans>Share link</Trans>
        </Button>
        <Button color="inherit" onClick={clearComparisonSlots}>
          <Trans>Clear</Trans>
        </Button>
      </Stack>
      {filledSlots.some(({ image }) => !isComparisonBasemap(image)) ? (
        <Typography variant="caption" color="text.secondary">
          <Trans>Imagery: Copernicus Sentinel data via Element 84 Earth Search.</Trans>
        </Typography>
      ) : null}
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
