import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import CloseIcon from '@mui/icons-material/Close';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import lookupTimeZone from '@photostructure/tz-lookup';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  ListItemButton,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Slider,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';

import {
  SatelliteSearchError,
  type SatelliteSearchErrorCode,
} from '@/application/satellite/SatelliteSearchError';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type {
  SatelliteProductLevel,
  SatelliteSearchViewport,
} from '@/domain/satellite/SatelliteSearchCriteria';
import type {
  SatelliteAcquisitionGroup,
  SatelliteSceneMatch,
  SatelliteSearchResult,
} from '@/domain/satellite/SatelliteSearchResult';
import { calculateSatelliteCoverage } from '@/domain/satellite/calculateSatelliteCoverage';
import {
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';
import {
  mapLayerStore,
  type AppliedSatelliteImagerySnapshot,
} from '@/presentation/map/mapLayerStore';
import { createMapShareUrl } from '@/presentation/map/mapShareUrl';
import {
  consumeSatelliteSearchRequest,
  mapInteractionStore,
  setSatelliteSearchAnchor,
} from '@/presentation/map/mapInteractionStore';
import { appColors } from '@/presentation/theme/appColors';
import { AcquisitionCalendar } from '@/presentation/satellite-browser/AcquisitionCalendar';
import { SatelliteRenderingControls } from '@/presentation/satellite-browser/SatelliteRenderingControls';
import { shouldAutoFillResults } from '@/presentation/satellite-browser/shouldAutoFillResults';
import {
  satelliteImageryProblemMessage,
  satelliteSearchErrorMessage,
} from '@/presentation/satellite-browser/satelliteProblemMessages';
import {
  beginSatelliteRequest,
  completeSatelliteRequest,
  failSatelliteRequest,
} from '@/presentation/satellite-browser/satelliteRequestStatusStore';

interface SatelliteBrowserProps {
  readonly active?: boolean;
  readonly auxiliaryOverlay: boolean;
  readonly fallbackCoordinates: string;
  readonly onPaneOpenChange: (open: boolean) => void;
  /** Reveals the map on smartphones after an action whose result is on the map. */
  readonly onShowMap?: (() => void) | undefined;
}

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'error';
      /** `null` when the search failed outside the satellite application boundary. */
      readonly searchErrorCode: SatelliteSearchErrorCode | null;
    }
  | { readonly status: 'success'; readonly result: SatelliteSearchResult };

function SatelliteSearchRequestRunner({
  canRun,
  onRun,
  requestId,
}: {
  readonly canRun: boolean;
  readonly onRun: () => Promise<void>;
  readonly requestId: number | null;
}) {
  useEffect(() => {
    if (!canRun || requestId === null) return;
    consumeSatelliteSearchRequest(requestId);
    void onRun();
  }, [canRun, onRun, requestId]);

  return null;
}

const firstResultCount = 8;
const resultPageSize = 8;
const calendarMonthLoadDelayMs = 300;
const catalogCloudCoverCeilingPercent = 100;
const sentinelArchiveFirstMonth = '2015-06';
const resultSummaryMessage = msg({
  message:
    '{imageCount, plural, one {# image} other {# images}} · {dayCount, plural, one {# acquisition day} other {# acquisition days}}',
});

interface MonthLoadError {
  readonly month: string;
  readonly searchErrorCode: SatelliteSearchErrorCode | null;
}

/** Display-only formats; acquisition days and months are UTC calendar dates. */
interface DisplayFormats {
  readonly month: Intl.DateTimeFormat;
  readonly day: Intl.DateTimeFormat;
  readonly percent: Intl.NumberFormat;
  readonly kilometers: Intl.NumberFormat;
  /** Local acquisition time at the searched place, e.g. `14:12 GMT+4`. */
  readonly acquisitionTime: (acquiredAt: Date, timeZone: string) => string;
}

/* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
function createDisplayFormats(locale: string): DisplayFormats {
  return {
    month: new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    day: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    percent: new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 0,
    }),
    kilometers: new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'kilometer',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
    acquisitionTime: (acquiredAt, timeZone) =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
        timeZoneName: 'short',
      }).format(acquiredAt),
  };
}
/* eslint-enable lingui/no-unlocalized-strings */

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface SearchMonthRange {
  readonly month: string;
  readonly startDate: string;
  readonly endDate: string;
}

interface SubmittedSearch {
  readonly viewport: SatelliteSearchViewport;
  readonly productLevel: SatelliteProductLevel;
  readonly initialMonth: string;
}

function searchMonthRange(month: string, today: Date): SearchMonthRange {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- ISO date token.
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const currentMonth = `${String(today.getUTCFullYear()).padStart(4, '0')}-${String(
    today.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
  const end =
    month === currentMonth
      ? new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
        )
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return {
    month,
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

function currentSearchMonth(today: Date): SearchMonthRange {
  return searchMonthRange(toDateInputValue(today).slice(0, 7), today);
}

function previousSearchMonth(month: string): SearchMonthRange {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- ISO date token.
  const current = new Date(`${month}-01T00:00:00.000Z`);
  const start = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1),
  );
  const end = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0));
  return {
    month: toDateInputValue(start).slice(0, 7),
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

function nextUnloadedSearchMonth(
  initialMonth: string,
  loadedMonths: ReadonlySet<string>,
): SearchMonthRange | null {
  let candidate = previousSearchMonth(initialMonth);
  while (candidate.month >= sentinelArchiveFirstMonth) {
    if (!loadedMonths.has(candidate.month)) return candidate;
    candidate = previousSearchMonth(candidate.month);
  }
  return null;
}

function hasSameSubmittedCriteria(
  submitted: SubmittedSearch,
  viewport: SatelliteSearchViewport,
): boolean {
  return (
    submitted.productLevel === 'L2A' &&
    submitted.viewport.center.longitude === viewport.center.longitude &&
    submitted.viewport.center.latitude === viewport.center.latitude &&
    submitted.viewport.bounds.west === viewport.bounds.west &&
    submitted.viewport.bounds.south === viewport.bounds.south &&
    submitted.viewport.bounds.east === viewport.bounds.east &&
    submitted.viewport.bounds.north === viewport.bounds.north
  );
}

function hasSameViewport(
  left: SatelliteSearchViewport | null,
  right: SatelliteSearchViewport | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.center.longitude === right.center.longitude &&
      left.center.latitude === right.center.latitude &&
      left.bounds.west === right.bounds.west &&
      left.bounds.south === right.bounds.south &&
      left.bounds.east === right.bounds.east &&
      left.bounds.north === right.bounds.north)
  );
}

function mergeSearchResults(
  newer: SatelliteSearchResult,
  older: SatelliteSearchResult,
): SatelliteSearchResult {
  const groups = [...newer.groups, ...older.groups].toSorted((left, right) =>
    right.date.localeCompare(left.date),
  );
  return {
    groups,
    sceneCount: groups.reduce((count, group) => count + group.scenes.length, 0),
    acquisitionDateCount: groups.length,
    totalMatched: newer.totalMatched + older.totalMatched,
  };
}

function singleSceneResult(
  scene: SatelliteScene,
  viewport: SatelliteSearchViewport,
): SatelliteSearchResult {
  // Shared scenes do not carry search evidence, so recompute it for a safe local viewport.
  return {
    groups: [
      {
        date: scene.acquiredAt.slice(0, 10),
        scenes: [
          {
            scene,
            coverage: calculateSatelliteCoverage(viewport, scene.footprint),
          },
        ],
      },
    ],
    sceneCount: 1,
    acquisitionDateCount: 1,
    totalMatched: 1,
  };
}

function sceneFootprintViewport(scene: SatelliteScene): SatelliteSearchViewport {
  const positions =
    scene.footprint.type === 'Polygon'
      ? scene.footprint.coordinates.flatMap((ring) => ring)
      : scene.footprint.coordinates.flatMap((polygon) =>
          polygon.flatMap((ring) => ring),
        );
  const bounds = { west: 180, south: 90, east: -180, north: -90 };
  for (const position of positions) {
    const longitude = position[0];
    const latitude = position[1];
    if (longitude === undefined || latitude === undefined) continue;
    bounds.west = Math.min(bounds.west, longitude);
    bounds.south = Math.min(bounds.south, latitude);
    bounds.east = Math.max(bounds.east, longitude);
    bounds.north = Math.max(bounds.north, latitude);
  }
  return {
    bounds,
    center: {
      longitude: (bounds.west + bounds.east) / 2,
      latitude: (bounds.south + bounds.north) / 2,
    },
  };
}

function flattenMatches(result: SatelliteSearchResult): readonly SatelliteSceneMatch[] {
  return result.groups.flatMap((group) => group.scenes);
}

function filterResultByCloudCover(
  result: SatelliteSearchResult,
  maxCloudCoverPercent: number,
  selectedSceneId: string | null,
): SatelliteSearchResult {
  const groups = result.groups
    .map((group) => ({
      ...group,
      scenes: group.scenes.filter(
        (match) =>
          match.scene.cloudCoverPercent <= maxCloudCoverPercent ||
          match.scene.id === selectedSceneId,
      ),
    }))
    .filter((group) => group.scenes.length > 0);
  return {
    groups,
    sceneCount: groups.reduce((count, group) => count + group.scenes.length, 0),
    acquisitionDateCount: groups.length,
    totalMatched: result.totalMatched,
  };
}

function visibleGroups(
  result: SatelliteSearchResult,
  visibleCount: number,
): readonly SatelliteAcquisitionGroup[] {
  const visibleKeys = new Set(
    flattenMatches(result)
      .slice(0, visibleCount)
      .map((match) => `${match.scene.collection}:${match.scene.id}`),
  );
  return result.groups
    .map((group) => ({
      ...group,
      scenes: group.scenes.filter((match) =>
        visibleKeys.has(`${match.scene.collection}:${match.scene.id}`),
      ),
    }))
    .filter((group) => group.scenes.length > 0);
}

function SceneCard({
  appliedImagery,
  formats,
  match,
  selected,
  showBottomDivider,
  timeZone,
  onCopyLink,
  onFitFootprint,
  onSelect,
}: {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly formats: DisplayFormats;
  readonly match: SatelliteSceneMatch;
  readonly selected: boolean;
  readonly showBottomDivider: boolean;
  readonly timeZone: string;
  readonly onCopyLink: () => void;
  readonly onFitFootprint: () => void;
  readonly onSelect: () => void;
}) {
  const { i18n, t } = useLingui();
  const { scene, coverage } = match;
  const sceneKey = satelliteSceneKey(scene);
  const applying =
    appliedImagery.status === 'loading' && appliedImagery.sceneKey === sceneKey;
  const failed =
    appliedImagery.status === 'failed' && appliedImagery.sceneKey === sceneKey;
  const applied =
    (appliedImagery.status === 'ready' ||
      appliedImagery.status === 'preview' ||
      appliedImagery.status === 'hidden') &&
    appliedImagery.sceneKey === sceneKey;
  const hidden = appliedImagery.status === 'hidden' && applied;
  const acquiredAt = new Date(scene.acquiredAt);
  const title = formats.day.format(acquiredAt);
  const acquisitionTime = formats.acquisitionTime(acquiredAt, timeZone);
  const cloudPercent = formats.percent.format(
    Math.round(scene.cloudCoverPercent) / 100,
  );
  const coveragePercent = formats.percent.format(
    Math.round(coverage.viewportCoveragePercent) / 100,
  );
  const edgeDistance = formats.kilometers.format(coverage.distanceToSceneEdgeKm);
  const unavailable = t`Unavailable`;
  const tileId = scene.tileId ?? unavailable;
  const orbit = scene.orbit ?? unavailable;
  const productId = scene.productId ?? unavailable;
  return (
    <Box
      id={`satellite-scene-${encodeURIComponent(scene.id)}`}
      sx={{
        overflow: 'hidden',
        borderBottom: showBottomDivider ? 1 : 0,
        borderColor: 'divider',
        bgcolor: selected ? appColors.surface.selected : 'transparent',
      }}
    >
      <ListItemButton
        aria-label={
          applied ? t`Remove ${title} imagery from map` : t`Apply ${title} imagery`
        }
        aria-pressed={selected}
        selected={selected}
        onClick={onSelect}
        sx={{
          display: 'block',
          p: 0,
          textAlign: 'left',
          '&.Mui-selected': {
            bgcolor: 'transparent',
          },
          '&:hover': { bgcolor: 'action.hover' },
          '&.Mui-selected:hover': {
            bgcolor: `color-mix(in srgb, ${appColors.surface.selected}, ${appColors.text.primary} 8%)`,
          },
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ p: 2 }}>
          {scene.thumbnailHref === null ? (
            <Box
              sx={{
                width: 88,
                height: 66,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                bgcolor: appColors.surface.subtle,
                color: 'primary.main',
                borderRadius: 1,
              }}
            >
              <ImageOutlinedIcon />
            </Box>
          ) : (
            <Box
              component="img"
              src={scene.thumbnailHref}
              alt=""
              sx={{
                width: 88,
                height: 66,
                flexShrink: 0,
                objectFit: 'cover',
                borderRadius: 1,
                bgcolor: appColors.surface.subtle,
              }}
            />
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap title={title}>
              {title} · {acquisitionTime}
            </Typography>
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: 'center', minHeight: 20 }}
            >
              <Typography variant="caption" color="text.secondary">
                {scene.productLevel}
              </Typography>
              {scene.cloudCoverPercent >= 70 ? (
                <Chip
                  size="small"
                  color="error"
                  aria-label={t`High cloud cover: ${cloudPercent}`}
                  label={t`${cloudPercent} cloud`}
                  sx={{ height: 20 }}
                />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  <Trans>· {cloudPercent} cloud</Trans>
                </Typography>
              )}
            </Stack>
            {coverage.viewportCoveragePercent <= 50 ? (
              <Chip
                size="small"
                color="warning"
                aria-label={t`Low viewport coverage: ${coveragePercent}`}
                label={t`${coveragePercent} coverage`}
                sx={{ height: 20, my: 0.25 }}
              />
            ) : (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', minHeight: 20 }}
              >
                <Trans>{coveragePercent} coverage</Trans>
              </Typography>
            )}
          </Box>
          <ChevronRightIcon color="action" fontSize="small" />
        </Stack>
        {coverage.hasEdgeWarning ? (
          <Alert severity="error" icon={false} sx={{ borderRadius: 0, py: 0 }}>
            <Trans>Scene border is only {edgeDistance} from the search anchor.</Trans>
          </Alert>
        ) : null}
        {selected ? (
          <Box sx={{ px: 2, pb: applied ? 0 : 2 }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {applying
                ? t`Applying true-color imagery…`
                : failed
                  ? t`Image failed to apply`
                  : hidden
                    ? t`Applied imagery is hidden`
                    : applied
                      ? t`True-color imagery applied`
                      : t`Selected for imagery`}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              <Trans>
                Acquired {title} · {acquisitionTime}
              </Trans>
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              {scene.attribution}
            </Typography>
            {failed ? (
              <Alert severity="error">
                {i18n._(satelliteImageryProblemMessage(appliedImagery.problem))}
              </Alert>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              <Trans>
                Tile {tileId} · Orbit {orbit}
              </Trans>
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', wordBreak: 'break-all' }}
            >
              <Trans>Product {productId}</Trans>
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              <Trans>Scene edge {edgeDistance} from search point</Trans>
            </Typography>
          </Box>
        ) : null}
      </ListItemButton>
      {selected && applied ? (
        <Stack direction="row" spacing={0.5} sx={{ p: 0.5 }}>
          <Button
            color="inherit"
            startIcon={<CenterFocusStrongIcon />}
            onClick={onFitFootprint}
            sx={{
              minHeight: 40,
              px: 1.5,
              '&:hover': { bgcolor: appColors.interaction.navigationHoverOverlay },
            }}
          >
            <Trans>Fit footprint</Trans>
          </Button>
          <Button
            color="inherit"
            startIcon={<ShareOutlinedIcon />}
            onClick={onCopyLink}
            sx={{
              minHeight: 40,
              px: 1.5,
              '&:hover': { bgcolor: appColors.interaction.navigationHoverOverlay },
            }}
          >
            <Trans>Share link</Trans>
          </Button>
        </Stack>
      ) : null}
    </Box>
  );
}

function SatelliteResultsPane({
  appliedImagery,
  coordinates,
  canLoadOlder,
  formats,
  loadMoreError,
  loadingMore,
  onAutoLoadMore,
  onClose,
  onCopyLink,
  onFitFootprint,
  onLoadMore,
  onSelect,
  searchState,
  scrollRequestId,
  overlay,
  selectedSceneId,
  timeZone,
  visibleCount,
}: {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly coordinates: string;
  readonly canLoadOlder: boolean;
  readonly formats: DisplayFormats;
  readonly loadMoreError: string | null;
  readonly loadingMore: boolean;
  readonly onAutoLoadMore: () => void;
  readonly onClose: () => void;
  readonly onCopyLink: (sceneKey: string) => void;
  readonly onFitFootprint: () => void;
  readonly onLoadMore: () => void;
  readonly onSelect: (match: SatelliteSceneMatch) => void;
  readonly searchState: SearchState;
  readonly overlay: boolean;
  readonly scrollRequestId: number;
  readonly selectedSceneId: string | null;
  readonly timeZone: string;
  readonly visibleCount: number;
}) {
  const { i18n, t } = useLingui();
  const result = searchState.status === 'success' ? searchState.result : null;
  const groups = result === null ? [] : visibleGroups(result, visibleCount);
  const shownCount = groups.reduce((count, group) => count + group.scenes.length, 0);
  const scrollViewport = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      result === null ||
      loadingMore ||
      loadMoreError !== null ||
      (shownCount >= result.sceneCount && !canLoadOlder)
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const viewport = scrollViewport.current;
      const lastContent = viewport?.lastElementChild;
      if (viewport !== null && lastContent instanceof HTMLElement) {
        const viewportBounds = viewport.getBoundingClientRect();
        const contentBounds = lastContent.getBoundingClientRect();
        const bottomPadding = Number.parseFloat(
          window.getComputedStyle(viewport).paddingBottom,
        );
        const occupiedHeight =
          contentBounds.bottom - viewportBounds.top + bottomPadding;
        if (!shouldAutoFillResults(occupiedHeight, viewport.clientHeight)) return;
        onAutoLoadMore();
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [canLoadOlder, loadMoreError, loadingMore, onAutoLoadMore, result, shownCount]);

  useEffect(() => {
    if (selectedSceneId === null || scrollRequestId === 0) return;
    const frame = window.requestAnimationFrame(() => {
      const selectedCard = document.getElementById(
        `satellite-scene-${encodeURIComponent(selectedSceneId)}`,
      );
      if (selectedCard !== null && typeof selectedCard.scrollIntoView === 'function') {
        selectedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [scrollRequestId, selectedSceneId, shownCount]);
  return (
    <Box
      component="aside"
      aria-label={t`Sentinel imagery results`}
      sx={{
        width: overlay ? '100%' : { xs: 404, xl: 440 },
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        borderRight: overlay ? 0 : 1,
        borderColor: 'divider',
      }}
    >
      <Stack
        direction="row"
        sx={{
          minHeight: 64,
          px: 2,
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        {overlay ? (
          <IconButton
            size="small"
            aria-label={t`Back to satellite search`}
            onClick={onClose}
            sx={{ mr: 1 }}
          >
            <ArrowBackOutlinedIcon fontSize="small" />
          </IconButton>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            component="h2"
            variant="subtitle1"
            noWrap
            sx={{ fontWeight: 700 }}
          >
            <Trans>Images near {coordinates}</Trans>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {result === null
              ? t`Latest Sentinel scenes`
              : i18n._({
                  ...resultSummaryMessage,
                  values: {
                    imageCount: result.sceneCount,
                    dayCount: result.acquisitionDateCount,
                  },
                })}
          </Typography>
        </Box>
        {!overlay ? (
          <IconButton
            size="small"
            aria-label={t`Close imagery results`}
            onClick={onClose}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        ) : null}
      </Stack>
      <Box ref={scrollViewport} sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2 }}>
        {searchState.status === 'loading' ? (
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2">
              <Trans>Loading latest images…</Trans>
            </Typography>
          </Stack>
        ) : null}
        {searchState.status === 'error' ? (
          <Alert severity="error">
            {searchState.searchErrorCode === null
              ? t`The imagery search could not be completed.`
              : i18n._(satelliteSearchErrorMessage(searchState.searchErrorCode))}
          </Alert>
        ) : null}
        {result?.sceneCount === 0 ? (
          <Alert severity="info">
            <Trans>No matching images. Increase the cloud limit or move the map.</Trans>
          </Alert>
        ) : null}
        <Stack spacing={0} sx={{ mx: -2 }}>
          {groups.map((group, index) => (
            <Stack key={group.date} spacing={0}>
              {index === 0 ||
              groups[index - 1]?.date.slice(0, 7) !== group.date.slice(0, 7) ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Divider sx={{ width: 24 }} />
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {/* eslint-disable-next-line lingui/no-unlocalized-strings -- ISO date token. */}
                    {formats.month.format(new Date(`${group.date}T00:00:00.000Z`))}
                  </Typography>
                  <Divider sx={{ flex: 1 }} />
                </Stack>
              ) : null}
              {group.scenes.map((match, sceneIndex) => (
                <SceneCard
                  appliedImagery={appliedImagery}
                  formats={formats}
                  key={`${match.scene.collection}:${match.scene.id}`}
                  match={match}
                  selected={match.scene.id === selectedSceneId}
                  showBottomDivider={
                    sceneIndex < group.scenes.length - 1 ||
                    groups[index + 1] === undefined ||
                    groups[index + 1]?.date.slice(0, 7) === group.date.slice(0, 7)
                  }
                  timeZone={timeZone}
                  onSelect={() => {
                    onSelect(match);
                  }}
                  onCopyLink={() => {
                    onCopyLink(satelliteSceneKey(match.scene));
                  }}
                  onFitFootprint={onFitFootprint}
                />
              ))}
            </Stack>
          ))}
        </Stack>
        {loadMoreError === null ? null : (
          <Alert severity="error" sx={{ mt: 2 }}>
            {loadMoreError}
          </Alert>
        )}
        {result !== null && (shownCount < result.sceneCount || canLoadOlder) ? (
          <Button
            fullWidth
            variant="outlined"
            sx={{ mt: 2 }}
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? t`Loading older images…` : t`Load more images`}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

export function SatelliteBrowser({
  active = true,
  auxiliaryOverlay,
  fallbackCoordinates,
  onPaneOpenChange,
  onShowMap,
}: SatelliteBrowserProps) {
  const {
    clock,
    database,
    logger,
    mapDiagnostics,
    mapLayers,
    mapViewport,
    searchSatelliteScenes,
  } = useRuntimeServices();
  const { i18n, t } = useLingui();
  const formats = useMemo(() => createDisplayFormats(i18n.locale), [i18n.locale]);
  const appliedImagery = useStore(mapLayerStore, (state) => state.appliedImagery);
  const selectedMapScene = useStore(mapLayerStore, (state) => state.selectedScene);
  const [today] = useState(() => clock.now());
  const latestMonth = currentSearchMonth(today).month;
  const [calendarMonth, setCalendarMonth] = useState(latestMonth);
  const [maxCloudCoverPercent, setMaxCloudCoverPercent] = useState(50);
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const [visibleCount, setVisibleCount] = useState(firstResultCount);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [dismissedRestoredSceneKey, setDismissedRestoredSceneKey] = useState<
    string | null
  >(null);
  const [submittedCoordinates, setSubmittedCoordinates] = useState(fallbackCoordinates);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- IANA time zone ID.
  const [submittedTimeZone, setSubmittedTimeZone] = useState('Asia/Tbilisi');
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(null);
  const [loadedMonths, setLoadedMonths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<MonthLoadError | null>(null);
  const [autoLoadAttempts, setAutoLoadAttempts] = useState(0);
  const [scrollRequestId, setScrollRequestId] = useState(0);
  const request = useRef<AbortController | null>(null);
  const calendarMonthLoadTimer = useRef<number | null>(null);
  const applyRequest = useRef<AbortController | null>(null);
  const cloudCoverChangedByUser = useRef(false);
  const previousViewport = useRef<SatelliteSearchViewport | null>(null);
  const [copyLinkStatus, setCopyLinkStatus] = useState<'idle' | 'copied' | 'failed'>(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
    'idle',
  );
  const subscribeToViewport = useCallback(
    (listener: () => void) => mapViewport.subscribe(listener),
    [mapViewport],
  );
  const readViewport = useCallback(
    () => mapViewport.getViewportSnapshot(),
    [mapViewport],
  );
  const viewport = useSyncExternalStore(
    subscribeToViewport,
    readViewport,
    readViewport,
  );
  const satelliteSearchAnchor = useStore(
    mapInteractionStore,
    (state) => state.satelliteSearchAnchor,
  );
  const satelliteSearchRequest = useStore(
    mapInteractionStore,
    (state) => state.satelliteSearchRequest,
  );
  const searchViewport =
    viewport === null || satelliteSearchAnchor === null
      ? viewport
      : { ...viewport, center: satelliteSearchAnchor };
  // eslint-disable-next-line lingui/no-unlocalized-strings -- State tokens.
  const searchAreaSource = satelliteSearchAnchor === null ? 'viewport' : 'custom';

  useEffect(() => {
    const previous = previousViewport.current;
    previousViewport.current = viewport;
    if (
      satelliteSearchAnchor !== null &&
      previous !== null &&
      viewport !== null &&
      !hasSameViewport(previous, viewport)
    ) {
      setSatelliteSearchAnchor(null);
    }
  }, [satelliteSearchAnchor, viewport]);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // The sibling results pane is attached in the same commit, after this component renders.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setPortalTarget(document.getElementById('satellite-results-pane'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (calendarMonthLoadTimer.current !== null) {
        window.clearTimeout(calendarMonthLoadTimer.current);
      }
      request.current?.abort();
      applyRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void database
      .loadMaximumCloudCoverPercent()
      .then((value) => {
        if (!cancelled && !cloudCoverChangedByUser.current) {
          setMaxCloudCoverPercent(value);
        }
      })
      .catch(() => {
        logger.log({
          level: 'warn',
          name: 'storage.satellite-preferences.load-failed',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [database, logger]);

  const coordinates =
    searchViewport === null
      ? fallbackCoordinates
      : `${searchViewport.center.latitude.toFixed(4)}, ${searchViewport.center.longitude.toFixed(4)}`;
  const restoredScene = selectedMapScene;
  const restoredResult = useMemo(
    () =>
      restoredScene === null
        ? null
        : singleSceneResult(
            restoredScene,
            viewport ?? sceneFootprintViewport(restoredScene),
          ),
    [restoredScene, viewport],
  );
  const showingRestoredScene =
    searchState.status === 'idle' && restoredScene !== null && restoredResult !== null;
  const restoredSceneKey =
    restoredScene === null ? null : satelliteSceneKey(restoredScene);
  const cloudFilteredResult = useMemo(
    () =>
      searchState.status === 'success'
        ? filterResultByCloudCover(
            searchState.result,
            maxCloudCoverPercent,
            selectedSceneId,
          )
        : null,
    [maxCloudCoverPercent, searchState, selectedSceneId],
  );
  const paneSearchState: SearchState = showingRestoredScene
    ? { status: 'success', result: restoredResult }
    : searchState.status === 'success' && cloudFilteredResult !== null
      ? { status: 'success', result: cloudFilteredResult }
      : searchState;
  const paneSelectedSceneId = showingRestoredScene ? restoredScene.id : selectedSceneId;
  const paneOpen =
    resultsOpen ||
    (showingRestoredScene && dismissedRestoredSceneKey !== restoredSceneKey);
  useEffect(() => {
    onPaneOpenChange(active && paneOpen);
  }, [active, onPaneOpenChange, paneOpen]);
  const paneCoordinates = showingRestoredScene ? coordinates : submittedCoordinates;
  const paneTimeZone =
    showingRestoredScene && viewport !== null
      ? lookupTimeZone(viewport.center.latitude, viewport.center.longitude)
      : submittedTimeZone;

  const searchUnavailable = searchSatelliteScenes === null;
  const canSearch =
    searchViewport !== null &&
    !searchUnavailable &&
    searchState.status !== 'loading' &&
    !loadingMore;
  const calendarResult = searchState.status === 'success' ? searchState.result : null;
  const nextArchiveMonth =
    submittedSearch === null
      ? null
      : nextUnloadedSearchMonth(submittedSearch.initialMonth, loadedMonths);

  const markMonthLoaded = (month: string) => {
    setLoadedMonths((current) => {
      if (current.has(month)) return current;
      const next = new Set(current);
      next.add(month);
      return next;
    });
  };

  const loadMonthIntoResults = async (
    range: SearchMonthRange,
    criteria: SubmittedSearch,
    revealLoadedMonth: boolean,
  ) => {
    if (searchSatelliteScenes === null || searchState.status !== 'success') return;
    if (loadedMonths.has(range.month)) {
      if (revealLoadedMonth) {
        setVisibleCount(
          filterResultByCloudCover(
            searchState.result,
            maxCloudCoverPercent,
            selectedSceneId,
          ).sceneCount,
        );
      }
      return;
    }
    if (request.current !== null) return;

    const controller = new AbortController();
    const baseResult = searchState.result;
    request.current = controller;
    setLoadingMonth(range.month);
    setLoadingMore(true);
    setLoadMoreError(null);
    beginSatelliteRequest({ code: 'loading-month', month: range.month });
    const loadMonth = async () => {
      const monthResult = await searchSatelliteScenes.execute(
        {
          viewport: criteria.viewport,
          startDate: range.startDate,
          endDate: range.endDate,
          productLevel: criteria.productLevel,
          maxCloudCoverPercent: catalogCloudCoverCeilingPercent,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const mergedResult = mergeSearchResults(baseResult, monthResult);
      const matchingMergedCount = filterResultByCloudCover(
        mergedResult,
        maxCloudCoverPercent,
        selectedSceneId,
      ).sceneCount;
      const matchingBaseCount = filterResultByCloudCover(
        baseResult,
        maxCloudCoverPercent,
        selectedSceneId,
      ).sceneCount;
      markMonthLoaded(range.month);
      setSearchState({ status: 'success', result: mergedResult });
      setVisibleCount(
        revealLoadedMonth
          ? matchingMergedCount
          : Math.min(matchingMergedCount, matchingBaseCount + resultPageSize),
      );
      completeSatelliteRequest({
        code: 'images-available',
        count: mergedResult.sceneCount,
      });
    };
    await loadMonth()
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadMoreError({
          month: range.month,
          searchErrorCode: error instanceof SatelliteSearchError ? error.code : null,
        });
        failSatelliteRequest();
      })
      .finally(() => {
        if (request.current === controller) {
          request.current = null;
          setLoadingMonth(null);
          setLoadingMore(false);
        }
      });
  };

  const runSearch = async () => {
    if (searchViewport === null || searchSatelliteScenes === null) return;
    const range = searchMonthRange(calendarMonth, clock.now());
    const existingSearch = submittedSearch;
    if (
      existingSearch !== null &&
      searchState.status === 'success' &&
      hasSameSubmittedCriteria(existingSearch, searchViewport)
    ) {
      setResultsOpen(true);
      setLoadMoreError(null);
      if (loadedMonths.has(range.month)) {
        setVisibleCount(cloudFilteredResult?.sceneCount ?? 0);
        return;
      }
      await loadMonthIntoResults(range, existingSearch, true);
      return;
    }

    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSubmittedSearch({
      viewport: searchViewport,
      productLevel: 'L2A',
      initialMonth: range.month,
    });
    setLoadedMonths(new Set());
    setLoadingMonth(range.month);
    setVisibleCount(firstResultCount);
    setSelectedSceneId(null);
    setLoadMoreError(null);
    setAutoLoadAttempts(0);
    setSubmittedCoordinates(coordinates);
    setSubmittedTimeZone(
      lookupTimeZone(searchViewport.center.latitude, searchViewport.center.longitude),
    );
    setResultsOpen(true);
    setSearchState({ status: 'loading' });
    beginSatelliteRequest({ code: 'searching-catalog' });
    const searchCatalog = async () => {
      const result = await searchSatelliteScenes.execute(
        {
          viewport: searchViewport,
          startDate: range.startDate,
          endDate: range.endDate,
          productLevel: 'L2A',
          maxCloudCoverPercent: catalogCloudCoverCeilingPercent,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        markMonthLoaded(range.month);
        setSearchState({ status: 'success', result });
        completeSatelliteRequest({
          code: 'images-available',
          count: result.sceneCount,
        });
      }
    };
    await searchCatalog()
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSearchState({
          status: 'error',
          searchErrorCode: error instanceof SatelliteSearchError ? error.code : null,
        });
        failSatelliteRequest();
      })
      .finally(() => {
        if (request.current === controller) {
          request.current = null;
          setLoadingMonth(null);
        }
      });
  };

  const loadMoreImages = async () => {
    if (searchState.status !== 'success') return;
    if (visibleCount < (cloudFilteredResult?.sceneCount ?? 0)) {
      setVisibleCount((count) => count + resultPageSize);
      return;
    }
    if (nextArchiveMonth === null || submittedSearch === null) return;
    const criteria = submittedSearch;
    await loadMonthIntoResults(nextArchiveMonth, criteria, false);
  };

  const changeCalendarMonth = (month: string) => {
    setCalendarMonth(month);
    setLoadMoreError(null);
    if (calendarMonthLoadTimer.current !== null) {
      window.clearTimeout(calendarMonthLoadTimer.current);
      calendarMonthLoadTimer.current = null;
    }
    if (searchState.status !== 'success' || submittedSearch === null) return;
    if (loadingMonth !== null) {
      request.current?.abort();
      request.current = null;
      setLoadingMonth(null);
      setLoadingMore(false);
    }
    if (loadedMonths.has(month)) {
      setVisibleCount(cloudFilteredResult?.sceneCount ?? 0);
      return;
    }
    calendarMonthLoadTimer.current = window.setTimeout(() => {
      calendarMonthLoadTimer.current = null;
      void loadMonthIntoResults(
        searchMonthRange(month, clock.now()),
        submittedSearch,
        true,
      );
    }, calendarMonthLoadDelayMs);
  };

  const cancelSearch = () => {
    if (calendarMonthLoadTimer.current !== null) {
      window.clearTimeout(calendarMonthLoadTimer.current);
      calendarMonthLoadTimer.current = null;
    }
    request.current?.abort();
    request.current = null;
    setLoadingMonth(null);
    setLoadingMore(false);
    setSearchState({ status: 'idle' });
    setResultsOpen(false);
    completeSatelliteRequest({ code: 'search-cancelled' });
  };

  const changeSearchAreaSource = (event: SelectChangeEvent) => {
    if (event.target.value === 'viewport') setSatelliteSearchAnchor(null);
  };

  const applyMatch = (match: SatelliteSceneMatch) => {
    if (mapLayers === null) return;
    const sceneKey = satelliteSceneKey(match.scene);
    const alreadyApplied =
      (appliedImagery.status === 'ready' ||
        appliedImagery.status === 'preview' ||
        appliedImagery.status === 'hidden') &&
      appliedImagery.sceneKey === sceneKey;
    if (alreadyApplied) {
      applyRequest.current?.abort();
      applyRequest.current = null;
      if (searchState.status === 'idle') {
        setSearchState({
          status: 'success',
          result: {
            groups: [
              {
                date: match.scene.acquiredAt.slice(0, 10),
                scenes: [match],
              },
            ],
            sceneCount: 1,
            acquisitionDateCount: 1,
            totalMatched: 1,
          },
        });
        setVisibleCount(1);
        setSubmittedCoordinates(coordinates);
        if (viewport !== null) {
          setSubmittedTimeZone(
            lookupTimeZone(viewport.center.latitude, viewport.center.longitude),
          );
        }
        setResultsOpen(true);
      }
      mapLayers.clearScene();
      setSelectedSceneId(null);
      onShowMap?.();
      return;
    }
    setSelectedSceneId(match.scene.id);
    applyRequest.current?.abort();
    const controller = new AbortController();
    applyRequest.current = controller;
    void mapLayers.applyScene(match.scene, controller.signal).finally(() => {
      if (applyRequest.current === controller) applyRequest.current = null;
    });
    onShowMap?.();
  };

  const copySceneLink = async (sceneKey: string) => {
    const camera = mapDiagnostics.getSnapshot()?.camera;
    if (camera === undefined) {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setCopyLinkStatus('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(
        createMapShareUrl(window.location.href, camera, sceneKey),
      );
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setCopyLinkStatus('copied');
    } catch {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setCopyLinkStatus('failed');
    }
  };

  const selectCalendarDate = (date: string) => {
    if (searchState.status !== 'success') return;
    const group = searchState.result.groups.find(
      (candidate) => candidate.date === date,
    );
    const bestCoverageMatch = group?.scenes.reduce<SatelliteSceneMatch | undefined>(
      (best, candidate) =>
        best === undefined ||
        candidate.coverage.viewportCoveragePercent >
          best.coverage.viewportCoveragePercent
          ? candidate
          : best,
      undefined,
    );
    if (bestCoverageMatch === undefined) return;
    const matchIndex = flattenMatches(searchState.result).findIndex(
      (candidate) =>
        candidate.scene.collection === bestCoverageMatch.scene.collection &&
        candidate.scene.id === bestCoverageMatch.scene.id,
    );
    setVisibleCount((count) => Math.max(count, matchIndex + 1));
    setSelectedSceneId(bestCoverageMatch.scene.id);
    applyMatch(bestCoverageMatch);
    if (resultsOpen) setScrollRequestId((requestId) => requestId + 1);
  };

  let loadMoreErrorMessage: string | null = null;
  if (loadMoreError !== null) {
    const monthLabel = formats.month.format(
      // eslint-disable-next-line lingui/no-unlocalized-strings -- ISO date token.
      new Date(`${loadMoreError.month}-01T00:00:00.000Z`),
    );
    loadMoreErrorMessage =
      loadMoreError.searchErrorCode === null
        ? t`${monthLabel} imagery could not be loaded. Try again.`
        : i18n._(satelliteSearchErrorMessage(loadMoreError.searchErrorCode));
  }

  return (
    <>
      <SatelliteSearchRequestRunner
        canRun={active && canSearch}
        requestId={satelliteSearchRequest?.id ?? null}
        onRun={runSearch}
      />
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography component="h3" variant="subtitle2">
          <Trans>Acquisition calendar</Trans>
        </Typography>
        <AcquisitionCalendar
          displayMonth={calendarMonth}
          maximumMonth={latestMonth}
          navigationDisabled={searchState.status === 'loading'}
          onMonthChange={changeCalendarMonth}
          today={today}
          mode={{
            kind: 'scene',
            loadingMonth,
            maxCloudCoverPercent,
            result: calendarResult,
            onSelectDate: selectCalendarDate,
          }}
        />
        {loadMoreErrorMessage === null || resultsOpen ? null : (
          <Alert severity="error">{loadMoreErrorMessage}</Alert>
        )}
        <Stack spacing={1}>
          <Box sx={{ px: 1 }}>
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <Typography
                id="cloud-cover-slider-label"
                variant="body2"
                sx={{ flex: 1 }}
              >
                <Trans>Maximum cloud</Trans>
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                ≤ {formats.percent.format(maxCloudCoverPercent / 100)}
              </Typography>
            </Stack>
            <Slider
              aria-labelledby="cloud-cover-slider-label"
              min={0}
              max={100}
              step={5}
              marks={[
                { value: 0 },
                { value: 25 },
                { value: 50 },
                { value: 75 },
                { value: 100 },
              ]}
              value={maxCloudCoverPercent}
              valueLabelDisplay="auto"
              onChange={(_event, value: number | number[]) => {
                const nextValue = Array.isArray(value) ? value[0] : value;
                if (nextValue !== undefined) {
                  cloudCoverChangedByUser.current = true;
                  setMaxCloudCoverPercent(nextValue);
                }
              }}
              onChangeCommitted={(_event, value: number | number[]) => {
                const nextValue = Array.isArray(value) ? value[0] : value;
                if (nextValue === undefined) return;
                void database.saveMaximumCloudCoverPercent(nextValue).catch(() => {
                  logger.log({
                    level: 'warn',
                    name: 'storage.satellite-preferences.save-failed',
                  });
                });
              }}
            />
          </Box>

          {searchState.status === 'loading' ? (
            <Button fullWidth color="inherit" variant="outlined" onClick={cancelSearch}>
              <Trans>Cancel search</Trans>
            </Button>
          ) : (
            <Button
              fullWidth
              variant="contained"
              startIcon={<SearchIcon />}
              disabled={!canSearch}
              onClick={() => void runSearch()}
            >
              <Trans>Search images</Trans>
            </Button>
          )}
        </Stack>

        <Box aria-live="polite">
          {viewport === null ? (
            <Alert severity="info">
              <Trans>Waiting for the map viewport to become ready.</Trans>
            </Alert>
          ) : null}
          {searchUnavailable ? (
            <Alert severity="error">
              <Trans>Satellite provider configuration is unavailable.</Trans>
            </Alert>
          ) : null}
        </Box>

        <Divider />
        <Box component="section" aria-labelledby="satellite-settings-heading">
          <Typography
            id="satellite-settings-heading"
            component="h3"
            variant="subtitle2"
          >
            <Trans>Settings</Trans>
          </Typography>
          <Stack spacing={1.5} sx={{ mt: 2, px: 1 }}>
            <FormControl size="small" fullWidth data-tour="satellite-search-area">
              <InputLabel id="satellite-search-area-label">
                <Trans>Search area source</Trans>
              </InputLabel>
              <Select
                labelId="satellite-search-area-label"
                label={t`Search area source`}
                value={searchAreaSource}
                onChange={changeSearchAreaSource}
                renderValue={() => (
                  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ minWidth: 72, fontWeight: 700 }}>
                      {searchAreaSource === 'custom'
                        ? t({ message: 'Custom', context: 'satellite search area' })
                        : t`Point`}
                    </Typography>
                    <Divider orientation="vertical" flexItem />
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {coordinates}
                    </Typography>
                  </Stack>
                )}
              >
                <MenuItem value="viewport">
                  <Trans>Point</Trans>
                </MenuItem>
                {searchAreaSource === 'custom' ? (
                  <MenuItem value="custom" disabled>
                    <Trans context="satellite search area">Custom</Trans>
                  </MenuItem>
                ) : null}
                <MenuItem value="marker" disabled>
                  <Trans>Marker</Trans>
                </MenuItem>
              </Select>
              <FormHelperText>
                <Trans>
                  Uses the map center point or a custom area for imagery search.
                </Trans>
              </FormHelperText>
            </FormControl>
            <SatelliteRenderingControls />
          </Stack>
        </Box>
      </Stack>
      {active && portalTarget !== null && paneOpen
        ? createPortal(
            <SatelliteResultsPane
              appliedImagery={appliedImagery}
              coordinates={paneCoordinates}
              canLoadOlder={nextArchiveMonth !== null}
              formats={formats}
              overlay={auxiliaryOverlay}
              loadingMore={loadingMore}
              loadMoreError={loadMoreErrorMessage}
              onAutoLoadMore={() => {
                if (autoLoadAttempts >= 3) return;
                setAutoLoadAttempts((attempts) => attempts + 1);
                void loadMoreImages();
              }}
              searchState={paneSearchState}
              scrollRequestId={scrollRequestId}
              visibleCount={visibleCount}
              selectedSceneId={paneSelectedSceneId}
              timeZone={paneTimeZone}
              onClose={() => {
                if (showingRestoredScene) {
                  setDismissedRestoredSceneKey(restoredSceneKey);
                }
                setResultsOpen(false);
              }}
              onLoadMore={() => void loadMoreImages()}
              onSelect={applyMatch}
              onCopyLink={(sceneKey) => void copySceneLink(sceneKey)}
              onFitFootprint={() => {
                mapLayers?.fitFootprint();
                onShowMap?.();
              }}
            />,
            portalTarget,
          )
        : null}
      <Snackbar
        open={copyLinkStatus !== 'idle'}
        autoHideDuration={copyLinkStatus === 'copied' ? 2_500 : 4_000}
        message={
          copyLinkStatus === 'copied'
            ? t`Scene link copied`
            : t`Clipboard access failed. Try again.`
        }
        onClose={() => {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
          setCopyLinkStatus('idle');
        }}
      />
    </>
  );
}
