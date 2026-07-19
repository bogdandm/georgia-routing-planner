import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import SearchIcon from '@mui/icons-material/Search';
import lookupTimeZone from '@photostructure/tz-lookup';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Slider,
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

import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import type {
  SatelliteProductLevel,
  SatelliteSearchViewport,
} from '@/domain/satellite/SatelliteSearchCriteria';
import type {
  SatelliteAcquisitionGroup,
  SatelliteSceneMatch,
  SatelliteSearchResult,
} from '@/domain/satellite/SatelliteSearchResult';
import { calculateWeightedCloudCover } from '@/domain/satellite/calculateWeightedCloudCover';
import { appColors } from '@/presentation/theme/appColors';
import { shouldAutoFillResults } from '@/presentation/satellite-browser/shouldAutoFillResults';

interface SatelliteBrowserProps {
  readonly fallbackCoordinates: string;
}

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'success'; readonly result: SatelliteSearchResult };

const firstResultCount = 8;
const resultPageSize = 8;
const sentinelArchiveFirstMonth = '2015-06';
const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
function formatAcquisitionTime(acquiredAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
    timeZoneName: 'short',
  }).format(acquiredAt);
}

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
  readonly maxCloudCoverPercent: number;
}

function currentSearchMonth(today: Date): SearchMonthRange {
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return {
    month: toDateInputValue(start).slice(0, 7),
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

function previousSearchMonth(month: string): SearchMonthRange {
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

function flattenMatches(result: SatelliteSearchResult): readonly SatelliteSceneMatch[] {
  return result.groups.flatMap((group) => group.scenes);
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

function AcquisitionCalendar({
  maxCloudCoverPercent,
  onSelectDate,
  result,
  today,
}: {
  readonly maxCloudCoverPercent: number;
  readonly onSelectDate: (date: string) => void;
  readonly result: SatelliteSearchResult | null;
  readonly today: Date;
}) {
  const latestDate = result?.groups[0]?.date ?? toDateInputValue(today);
  const [displayMonth, setDisplayMonth] = useState(
    () => new Date(`${latestDate.slice(0, 7)}-01T00:00:00.000Z`),
  );

  const availability = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const group of result?.groups ?? []) {
      const cloudCover = calculateWeightedCloudCover(group.scenes);
      if (cloudCover !== null) byDate.set(group.date, cloudCover);
    }
    return byDate;
  }, [result]);
  const year = displayMonth.getUTCFullYear();
  const month = displayMonth.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array.from({ length: 42 }, (_value, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });

  const changeMonth = (offset: number) => {
    setDisplayMonth(new Date(Date.UTC(year, month + offset, 1)));
  };

  return (
    <Box aria-label="Sentinel acquisition calendar">
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
        <IconButton
          size="small"
          aria-label="Previous acquisition month"
          onClick={() => {
            changeMonth(-1);
          }}
        >
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" sx={{ flex: 1, textAlign: 'center' }}>
          {monthFormatter.format(displayMonth)}
        </Typography>
        <IconButton
          size="small"
          aria-label="Next acquisition month"
          onClick={() => {
            changeMonth(1);
          }}
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Box
        role="grid"
        aria-label={monthFormatter.format(displayMonth)}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.75 }}
      >
        {weekDays.map((day) => (
          <Typography
            key={day}
            role="columnheader"
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: 'center' }}
          >
            {day}
          </Typography>
        ))}
        {cells.map((day, index) => {
          if (day === null) return <Box key={`empty-${String(index)}`} />;
          const date = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const cloud = availability.get(date);
          const isLatest = date === latestDate && cloud !== undefined;
          const matchesCloudFilter =
            cloud !== undefined && cloud <= maxCloudCoverPercent;
          return (
            <ButtonBase
              key={date}
              role="gridcell"
              disabled={cloud === undefined}
              onClick={() => {
                onSelectDate(date);
              }}
              aria-label={
                cloud === undefined
                  ? `${dayFormatter.format(new Date(`${date}T00:00:00.000Z`))}, no loaded imagery`
                  : `${dayFormatter.format(new Date(`${date}T00:00:00.000Z`))}, imagery available, ${cloud.toFixed(0)} percent weighted cloud, ${matchesCloudFilter ? 'matches' : 'exceeds'} the current cloud limit`
              }
              sx={{
                height: 46,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 1.25,
                border: 1,
                borderColor:
                  cloud === undefined
                    ? 'transparent'
                    : matchesCloudFilter
                      ? appColors.brand.tigerOrange
                      : 'transparent',
                bgcolor:
                  cloud === undefined
                    ? 'transparent'
                    : matchesCloudFilter
                      ? appColors.tag.orange.background
                      : 'transparent',
                color: matchesCloudFilter
                  ? appColors.tag.orange.foreground
                  : 'text.primary',
                fontWeight: isLatest ? 700 : 400,
                '&.Mui-disabled': { color: 'text.primary' },
              }}
            >
              <Typography variant="caption">{day}</Typography>
              {cloud === undefined ? null : (
                <Typography variant="caption" sx={{ color: 'inherit', lineHeight: 1 }}>
                  {cloud.toFixed(0)}%
                </Typography>
              )}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}

function SceneCard({
  match,
  selected,
  timeZone,
  onSelect,
}: {
  readonly match: SatelliteSceneMatch;
  readonly selected: boolean;
  readonly timeZone: string;
  readonly onSelect: () => void;
}) {
  const { scene, coverage } = match;
  const acquiredAt = new Date(scene.acquiredAt);
  const title = dayFormatter.format(acquiredAt);
  return (
    <Paper
      id={`satellite-scene-${encodeURIComponent(scene.id)}`}
      variant="outlined"
      sx={{
        overflow: 'hidden',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? appColors.surface.selected : 'background.paper',
      }}
    >
      <ButtonBase
        aria-label={`Select ${title} imagery`}
        aria-pressed={selected}
        onClick={onSelect}
        sx={{ display: 'block', width: '100%', textAlign: 'left' }}
      >
        <Stack direction="row" spacing={1.5} sx={{ p: 1.5 }}>
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
              {title} · {formatAcquisitionTime(acquiredAt, timeZone)}
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
                  aria-label={`High cloud cover: ${scene.cloudCoverPercent.toFixed(0)}%`}
                  label={`${scene.cloudCoverPercent.toFixed(0)}% cloud`}
                  sx={{ height: 20 }}
                />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  · {scene.cloudCoverPercent.toFixed(0)}% cloud
                </Typography>
              )}
            </Stack>
            {coverage.viewportCoveragePercent <= 50 ? (
              <Chip
                size="small"
                color="warning"
                aria-label={`Low viewport coverage: ${coverage.viewportCoveragePercent.toFixed(0)}%`}
                label={`${coverage.viewportCoveragePercent.toFixed(0)}% coverage`}
                sx={{ height: 20, my: 0.25 }}
              />
            ) : (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', minHeight: 20 }}
              >
                {coverage.viewportCoveragePercent.toFixed(0)}% coverage
              </Typography>
            )}
          </Box>
          <ChevronRightIcon color="action" fontSize="small" />
        </Stack>
        {coverage.hasEdgeWarning ? (
          <Alert severity="error" icon={false} sx={{ borderRadius: 0, py: 0 }}>
            Scene border is only {coverage.distanceToSceneEdgeKm.toFixed(1)} km from the
            search anchor.
          </Alert>
        ) : null}
        {selected ? (
          <Box sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Selected for imagery
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              Acquired {title} · {formatAcquisitionTime(acquiredAt, timeZone)}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              {scene.attribution}
            </Typography>
          </Box>
        ) : null}
      </ButtonBase>
    </Paper>
  );
}

function SatelliteResultsPane({
  coordinates,
  canLoadOlder,
  loadMoreError,
  loadingMore,
  onAutoLoadMore,
  onClose,
  onLoadMore,
  onSelect,
  searchState,
  scrollRequestId,
  selectedSceneId,
  timeZone,
  visibleCount,
}: {
  readonly coordinates: string;
  readonly canLoadOlder: boolean;
  readonly loadMoreError: string | null;
  readonly loadingMore: boolean;
  readonly onAutoLoadMore: () => void;
  readonly onClose: () => void;
  readonly onLoadMore: () => void;
  readonly onSelect: (sceneId: string) => void;
  readonly searchState: SearchState;
  readonly scrollRequestId: number;
  readonly selectedSceneId: string | null;
  readonly timeZone: string;
  readonly visibleCount: number;
}) {
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
      aria-label="Sentinel imagery results"
      sx={{
        width: { xs: 404, xl: 440 },
        height: '100dvh',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: 1,
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
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            component="h2"
            variant="subtitle1"
            noWrap
            sx={{ fontWeight: 700 }}
          >
            Images near {coordinates}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {result === null
              ? 'Latest Sentinel scenes'
              : `${String(result.sceneCount)} images · ${String(result.acquisitionDateCount)} acquisition days`}
          </Typography>
        </Box>
        <IconButton size="small" aria-label="Close imagery results" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Box ref={scrollViewport} sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2 }}>
        {searchState.status === 'loading' ? (
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Loading latest images…</Typography>
          </Stack>
        ) : null}
        {searchState.status === 'error' ? (
          <Alert severity="error">{searchState.message}</Alert>
        ) : null}
        {result?.sceneCount === 0 ? (
          <Alert severity="info">
            No matching images. Increase the cloud limit or move the map.
          </Alert>
        ) : null}
        <Stack spacing={1.5}>
          {groups.map((group, index) => (
            <Stack key={group.date} spacing={1}>
              {index === 0 ||
              groups[index - 1]?.date.slice(0, 7) !== group.date.slice(0, 7) ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="overline">
                    {monthFormatter.format(new Date(`${group.date}T00:00:00.000Z`))}
                  </Typography>
                  <Divider sx={{ flex: 1 }} />
                </Stack>
              ) : null}
              {group.scenes.map((match) => (
                <SceneCard
                  key={`${match.scene.collection}:${match.scene.id}`}
                  match={match}
                  selected={match.scene.id === selectedSceneId}
                  timeZone={timeZone}
                  onSelect={() => {
                    onSelect(match.scene.id);
                  }}
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
            {loadingMore ? 'Loading older images…' : 'Load more images'}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

export function SatelliteBrowser({ fallbackCoordinates }: SatelliteBrowserProps) {
  const { clock, mapViewport, searchSatelliteScenes } = useRuntimeServices();
  const [today] = useState(() => clock.now());
  const [maxCloudCoverPercent, setMaxCloudCoverPercent] = useState(25);
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const [visibleCount, setVisibleCount] = useState(firstResultCount);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [submittedCoordinates, setSubmittedCoordinates] = useState(fallbackCoordinates);
  const [submittedTimeZone, setSubmittedTimeZone] = useState('Asia/Tbilisi');
  const [oldestLoadedMonth, setOldestLoadedMonth] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [autoLoadAttempts, setAutoLoadAttempts] = useState(0);
  const [scrollRequestId, setScrollRequestId] = useState(0);
  const request = useRef<AbortController | null>(null);
  const submittedSearch = useRef<SubmittedSearch | null>(null);
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
  const portalTarget = document.getElementById('satellite-results-pane');

  useEffect(() => {
    return () => {
      request.current?.abort();
    };
  }, []);

  const coordinates =
    viewport === null
      ? fallbackCoordinates
      : `${viewport.center.latitude.toFixed(4)}, ${viewport.center.longitude.toFixed(4)}`;
  const searchUnavailable = searchSatelliteScenes === null;
  const canSearch =
    viewport !== null &&
    !searchUnavailable &&
    searchState.status !== 'loading' &&
    !loadingMore;
  const calendarResult = searchState.status === 'success' ? searchState.result : null;

  const runSearch = async () => {
    if (viewport === null || searchSatelliteScenes === null) return;
    request.current?.abort();
    const controller = new AbortController();
    const range = currentSearchMonth(clock.now());
    request.current = controller;
    submittedSearch.current = {
      viewport,
      productLevel: 'L2A',
      maxCloudCoverPercent,
    };
    setVisibleCount(firstResultCount);
    setSelectedSceneId(null);
    setOldestLoadedMonth(range.month);
    setLoadMoreError(null);
    setAutoLoadAttempts(0);
    setSubmittedCoordinates(coordinates);
    setSubmittedTimeZone(
      lookupTimeZone(viewport.center.latitude, viewport.center.longitude),
    );
    setResultsOpen(true);
    setSearchState({ status: 'loading' });
    try {
      const result = await searchSatelliteScenes.execute(
        {
          viewport,
          startDate: range.startDate,
          endDate: range.endDate,
          productLevel: 'L2A',
          maxCloudCoverPercent,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setSearchState({ status: 'success', result });
    } catch (error) {
      if (controller.signal.aborted) return;
      setSearchState({
        status: 'error',
        message:
          error instanceof SatelliteSearchError
            ? error.message
            : 'The imagery search could not be completed.',
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  const loadMoreImages = async () => {
    if (searchState.status !== 'success') return;
    if (visibleCount < searchState.result.sceneCount) {
      setVisibleCount((count) => count + resultPageSize);
      return;
    }
    if (
      oldestLoadedMonth === null ||
      oldestLoadedMonth <= sentinelArchiveFirstMonth ||
      submittedSearch.current === null ||
      searchSatelliteScenes === null
    ) {
      return;
    }

    request.current?.abort();
    const controller = new AbortController();
    const range = previousSearchMonth(oldestLoadedMonth);
    const criteria = submittedSearch.current;
    request.current = controller;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const olderResult = await searchSatelliteScenes.execute(
        {
          ...criteria,
          startDate: range.startDate,
          endDate: range.endDate,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSearchState((current) =>
        current.status === 'success'
          ? {
              status: 'success',
              result: mergeSearchResults(current.result, olderResult),
            }
          : current,
      );
      setOldestLoadedMonth(range.month);
      setVisibleCount(searchState.result.sceneCount + resultPageSize);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadMoreError(
        error instanceof SatelliteSearchError
          ? error.message
          : 'Older imagery could not be loaded. Try again.',
      );
    } finally {
      if (request.current === controller) request.current = null;
      setLoadingMore(false);
    }
  };

  const cancelSearch = () => {
    request.current?.abort();
    request.current = null;
    setLoadingMore(false);
    setSearchState({ status: 'idle' });
    setResultsOpen(false);
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
    if (resultsOpen) setScrollRequestId((requestId) => requestId + 1);
  };

  return (
    <>
      <Stack spacing={2} sx={{ p: 2 }}>
        <Select
          fullWidth
          size="small"
          value="viewport"
          inputProps={{ 'aria-label': 'Search area source' }}
          renderValue={() => (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={{ minWidth: 72, fontWeight: 700 }}>
                Point
              </Typography>
              <Divider orientation="vertical" flexItem />
              <Typography variant="body2" color="text.secondary" noWrap>
                {coordinates}
              </Typography>
            </Stack>
          )}
        >
          <MenuItem value="viewport">Point</MenuItem>
          <MenuItem value="marker" disabled>
            Marker
          </MenuItem>
        </Select>

        <Divider />
        <Typography component="h3" variant="subtitle2">
          Acquisition calendar
        </Typography>
        <AcquisitionCalendar
          key={calendarResult?.groups[0]?.date ?? 'no-results'}
          maxCloudCoverPercent={maxCloudCoverPercent}
          onSelectDate={selectCalendarDate}
          result={calendarResult}
          today={today}
        />
        <Box>
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Typography id="cloud-cover-slider-label" variant="body2" sx={{ flex: 1 }}>
              Maximum cloud
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              ≤ {maxCloudCoverPercent}%
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
              if (nextValue !== undefined) setMaxCloudCoverPercent(nextValue);
            }}
          />
        </Box>

        {searchState.status === 'loading' ? (
          <Button fullWidth color="inherit" variant="outlined" onClick={cancelSearch}>
            Cancel search
          </Button>
        ) : (
          <Button
            fullWidth
            variant="contained"
            startIcon={<SearchIcon />}
            disabled={!canSearch}
            onClick={() => void runSearch()}
          >
            Search latest images
          </Button>
        )}

        <Box aria-live="polite">
          {viewport === null ? (
            <Alert severity="info">Waiting for the map viewport to become ready.</Alert>
          ) : null}
          {searchUnavailable ? (
            <Alert severity="error">
              Satellite provider configuration is unavailable.
            </Alert>
          ) : null}
          {searchState.status === 'loading' ? (
            <Typography variant="body2">Loading the latest matching images…</Typography>
          ) : null}
          {searchState.status !== 'loading' &&
          viewport !== null &&
          !searchUnavailable ? (
            <Typography variant="caption" color="text.secondary">
              Point {coordinates} ·{' '}
              {monthFormatter.format(
                new Date(`${currentSearchMonth(today).month}-01T00:00:00.000Z`),
              )}{' '}
              → older · cloud ≤ {maxCloudCoverPercent}%
            </Typography>
          ) : null}
        </Box>
      </Stack>
      {portalTarget !== null && resultsOpen
        ? createPortal(
            <SatelliteResultsPane
              coordinates={submittedCoordinates}
              canLoadOlder={
                oldestLoadedMonth !== null &&
                oldestLoadedMonth > sentinelArchiveFirstMonth
              }
              loadingMore={loadingMore}
              loadMoreError={loadMoreError}
              onAutoLoadMore={() => {
                if (autoLoadAttempts >= 3) return;
                setAutoLoadAttempts((attempts) => attempts + 1);
                void loadMoreImages();
              }}
              searchState={searchState}
              scrollRequestId={scrollRequestId}
              visibleCount={visibleCount}
              selectedSceneId={selectedSceneId}
              timeZone={submittedTimeZone}
              onClose={() => {
                setResultsOpen(false);
              }}
              onLoadMore={() => void loadMoreImages()}
              onSelect={(sceneId) => {
                setSelectedSceneId((current) => (current === sceneId ? null : sceneId));
              }}
            />,
            portalTarget,
          )
        : null}
    </>
  );
}
