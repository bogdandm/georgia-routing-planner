import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import CloseIcon from '@mui/icons-material/Close';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SearchIcon from '@mui/icons-material/Search';
import lookupTimeZone from '@photostructure/tz-lookup';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  ClickAwayListener,
  Divider,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Popper,
  Select,
  type SelectChangeEvent,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';

import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
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
import { calculateWeightedCloudCover } from '@/domain/satellite/calculateWeightedCloudCover';
import { calculateSatelliteCoverage } from '@/domain/satellite/calculateSatelliteCoverage';
import {
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';
import {
  mapLayerStore,
  type AppliedSatelliteImagerySnapshot,
} from '@/presentation/map/mapLayerStore';
import {
  consumeSatelliteSearchRequest,
  mapInteractionStore,
  setSatelliteSearchAnchor,
} from '@/presentation/map/mapInteractionStore';
import { appColors } from '@/presentation/theme/appColors';
import { SatelliteRenderingControls } from '@/presentation/satellite-browser/SatelliteRenderingControls';
import { shouldAutoFillResults } from '@/presentation/satellite-browser/shouldAutoFillResults';
import {
  beginSatelliteRequest,
  completeSatelliteRequest,
  failSatelliteRequest,
} from '@/presentation/satellite-browser/satelliteRequestStatusStore';

interface SatelliteBrowserProps {
  readonly active?: boolean;
  readonly fallbackCoordinates: string;
}

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
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
const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const calendarMonthNames = Array.from({ length: 12 }, (_value, month) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2020, month, 1)),
  ),
);
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
  readonly initialMonth: string;
}

function searchMonthRange(month: string, today: Date): SearchMonthRange {
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

function AcquisitionCalendar({
  displayMonth,
  loadingMonth,
  maxCloudCoverPercent,
  maximumMonth,
  navigationDisabled,
  onMonthChange,
  onSelectDate,
  result,
  today,
}: {
  readonly displayMonth: string;
  readonly loadingMonth: string | null;
  readonly maxCloudCoverPercent: number;
  readonly maximumMonth: string;
  readonly navigationDisabled: boolean;
  readonly onMonthChange: (month: string) => void;
  readonly onSelectDate: (date: string) => void;
  readonly result: SatelliteSearchResult | null;
  readonly today: Date;
}) {
  const [monthPickerAnchor, setMonthPickerAnchor] = useState<HTMLElement | null>(null);
  const monthPickerOpen = monthPickerAnchor !== null;
  const latestDate = result?.groups[0]?.date ?? toDateInputValue(today);
  const displayMonthDate = new Date(`${displayMonth}-01T00:00:00.000Z`);
  const minimumMonthDate = new Date(`${sentinelArchiveFirstMonth}-01T00:00:00.000Z`);
  const maximumMonthDate = new Date(`${maximumMonth}-01T00:00:00.000Z`);

  const availability = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const group of result?.groups ?? []) {
      const cloudCover = calculateWeightedCloudCover(group.scenes);
      if (cloudCover !== null) byDate.set(group.date, cloudCover);
    }
    return byDate;
  }, [result]);
  const year = displayMonthDate.getUTCFullYear();
  const month = displayMonthDate.getUTCMonth();
  const minimumYear = minimumMonthDate.getUTCFullYear();
  const maximumYear = maximumMonthDate.getUTCFullYear();
  const availableYears = Array.from(
    { length: maximumYear - minimumYear + 1 },
    (_value, index) => maximumYear - index,
  );
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const calendarCellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: calendarCellCount }, (_value, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  const calendarRows = Array.from(
    { length: calendarCellCount / 7 },
    (_value, rowIndex) => cells.slice(rowIndex * 7, rowIndex * 7 + 7),
  );

  const changeMonth = (offset: number) => {
    const nextMonth = new Date(Date.UTC(year, month + offset, 1));
    onMonthChange(toDateInputValue(nextMonth).slice(0, 7));
  };

  const selectYear = (nextYear: number) => {
    const earliestMonth = nextYear === minimumYear ? minimumMonthDate.getUTCMonth() : 0;
    const latestMonth = nextYear === maximumYear ? maximumMonthDate.getUTCMonth() : 11;
    const nextMonth = Math.min(Math.max(month, earliestMonth), latestMonth);
    onMonthChange(
      toDateInputValue(new Date(Date.UTC(nextYear, nextMonth, 1))).slice(0, 7),
    );
  };

  const selectMonth = (nextMonth: number) => {
    onMonthChange(toDateInputValue(new Date(Date.UTC(year, nextMonth, 1))).slice(0, 7));
    setMonthPickerAnchor(null);
  };

  return (
    <Box aria-label="Sentinel acquisition calendar">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '80px minmax(0, 1fr) 80px',
          alignItems: 'center',
          mb: 0.5,
        }}
      >
        <Tooltip title="Previous month">
          <span style={{ display: 'flex', width: 'fit-content' }}>
            <IconButton
              size="small"
              aria-label="Previous acquisition month"
              disabled={navigationDisabled || displayMonth <= sentinelArchiveFirstMonth}
              onClick={() => {
                changeMonth(-1);
              }}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Stack
          direction="row"
          spacing={1}
          sx={{ minWidth: 0, alignItems: 'center', justifyContent: 'center' }}
        >
          <Box sx={{ display: 'flex', width: 14, height: 14 }}>
            <CircularProgress
              size={14}
              aria-label={
                loadingMonth === displayMonth
                  ? `Loading ${monthFormatter.format(displayMonthDate)} imagery`
                  : undefined
              }
              aria-hidden={loadingMonth === displayMonth ? undefined : true}
              sx={{ visibility: loadingMonth === displayMonth ? 'visible' : 'hidden' }}
            />
          </Box>
          <Tooltip title="Choose month and year">
            <ButtonBase
              aria-label={`Choose acquisition month and year, ${monthFormatter.format(displayMonthDate)}`}
              aria-expanded={monthPickerOpen}
              onClick={(event) => {
                setMonthPickerAnchor((anchor) =>
                  anchor === null ? event.currentTarget : null,
                );
              }}
              sx={{ gap: 0.25, borderRadius: 1, pl: 0.5, pr: 0.25 }}
            >
              <Typography variant="subtitle2">
                {monthFormatter.format(displayMonthDate)}
              </Typography>
              <KeyboardArrowDownIcon fontSize="small" />
            </ButtonBase>
          </Tooltip>
        </Stack>
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Tooltip title="Next month">
            <span style={{ display: 'flex' }}>
              <IconButton
                size="small"
                aria-label="Next acquisition month"
                disabled={navigationDisabled || displayMonth >= maximumMonth}
                onClick={() => {
                  changeMonth(1);
                }}
              >
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Return to current month">
            <span style={{ display: 'flex' }}>
              <IconButton
                size="small"
                aria-label="Return to current acquisition month"
                disabled={navigationDisabled || displayMonth >= maximumMonth}
                onClick={() => {
                  onMonthChange(maximumMonth);
                }}
              >
                <KeyboardDoubleArrowRightIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>
      <Popper
        open={monthPickerOpen}
        anchorEl={monthPickerAnchor}
        placement="bottom"
        modifiers={[{ name: 'offset', options: { offset: [0, 4] } }]}
        sx={{ zIndex: 'modal' }}
      >
        <ClickAwayListener
          onClickAway={() => {
            setMonthPickerAnchor(null);
          }}
        >
          <Paper
            elevation={8}
            role="group"
            aria-label="Choose acquisition month and year"
            sx={{ width: 280, maxWidth: 'calc(100vw - 32px)', p: 1 }}
          >
            <Select
              fullWidth
              size="small"
              value={year}
              inputProps={{ 'aria-label': 'Acquisition year' }}
              onChange={(event) => {
                selectYear(event.target.value);
              }}
              sx={{ mb: 1 }}
            >
              {availableYears.map((availableYear) => (
                <MenuItem key={availableYear} value={availableYear}>
                  {availableYear}
                </MenuItem>
              ))}
            </Select>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 0.5,
              }}
            >
              {calendarMonthNames.map((monthName, monthIndex) => {
                const candidate = `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
                const unavailable =
                  candidate < sentinelArchiveFirstMonth || candidate > maximumMonth;
                return (
                  <ButtonBase
                    key={monthName}
                    aria-label={`Choose ${monthName} ${String(year)}`}
                    aria-pressed={monthIndex === month}
                    disabled={unavailable}
                    onClick={() => {
                      selectMonth(monthIndex);
                    }}
                    sx={{
                      minHeight: 32,
                      borderRadius: 1,
                      bgcolor: monthIndex === month ? 'action.selected' : 'transparent',
                      color: unavailable ? 'text.disabled' : 'text.primary',
                      fontSize: '0.75rem',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    {monthName}
                  </ButtonBase>
                );
              })}
            </Box>
          </Paper>
        </ClickAwayListener>
      </Popper>
      <Box
        role="grid"
        aria-label={monthFormatter.format(displayMonthDate)}
        sx={{ display: 'grid', gap: 0.25 }}
      >
        <Box role="row" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
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
        </Box>
        {calendarRows.map((calendarRow, rowIndex) => (
          <Box
            key={`week-${String(rowIndex)}`}
            role="row"
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.25 }}
          >
            {calendarRow.map((day, columnIndex) => {
              if (day === null) {
                return (
                  <Box
                    key={`empty-${String(rowIndex * 7 + columnIndex)}`}
                    role="gridcell"
                    aria-hidden="true"
                  />
                );
              }
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
                    height: 34,
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
                  <Typography variant="caption" sx={{ lineHeight: 1.1 }}>
                    {day}
                  </Typography>
                  {cloud === undefined ? null : (
                    <Typography
                      variant="caption"
                      sx={{ color: 'inherit', lineHeight: 1 }}
                    >
                      {cloud.toFixed(0)}%
                    </Typography>
                  )}
                </ButtonBase>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function SceneCard({
  appliedImagery,
  match,
  selected,
  timeZone,
  onFitFootprint,
  onSelect,
  onToggleImagery,
}: {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly match: SatelliteSceneMatch;
  readonly selected: boolean;
  readonly timeZone: string;
  readonly onFitFootprint: () => void;
  readonly onSelect: () => void;
  readonly onToggleImagery: (visible: boolean) => void;
}) {
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
  const title = dayFormatter.format(acquiredAt);
  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    const clickedSecondaryAction =
      event.target instanceof Element &&
      event.target.closest('[data-scene-card-secondary-action]') !== null;
    if (!clickedSecondaryAction) onSelect();
  };
  return (
    <Paper
      id={`satellite-scene-${encodeURIComponent(scene.id)}`}
      variant="outlined"
      onClick={handleCardClick}
      sx={{
        overflow: 'hidden',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? appColors.surface.selected : 'background.paper',
        cursor: 'pointer',
      }}
    >
      <ButtonBase
        aria-label={
          applied ? `Remove ${title} imagery from map` : `Apply ${title} imagery`
        }
        aria-pressed={selected}
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
              {applying
                ? 'Applying true-color imagery…'
                : failed
                  ? 'Image failed to apply'
                  : hidden
                    ? 'Applied imagery is hidden'
                    : applied
                      ? 'True-color imagery applied'
                      : 'Selected for imagery'}
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
      {selected ? (
        <Stack
          spacing={0.75}
          sx={{ px: 1.5, py: 1.25, borderTop: 1, borderColor: 'divider' }}
        >
          {failed ? <Alert severity="error">{appliedImagery.message}</Alert> : null}
          <Typography variant="caption" color="text.secondary">
            Tile {scene.tileId ?? 'Unavailable'} · Orbit {scene.orbit ?? 'Unavailable'}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ overflowWrap: 'anywhere' }}
          >
            Product {scene.productId ?? 'Unavailable'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Scene edge {coverage.distanceToSceneEdgeKm.toFixed(1)} km from search point
          </Typography>
          {applied ? (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                data-scene-card-secondary-action
                startIcon={<CenterFocusStrongIcon />}
                onClick={onFitFootprint}
              >
                Fit footprint
              </Button>
              <Button
                size="small"
                data-scene-card-secondary-action
                startIcon={hidden ? <VisibilityIcon /> : <VisibilityOffIcon />}
                onClick={() => {
                  onToggleImagery(hidden);
                }}
              >
                {hidden ? 'Show imagery' : 'Hide imagery'}
              </Button>
            </Stack>
          ) : null}
        </Stack>
      ) : null}
    </Paper>
  );
}

function SatelliteResultsPane({
  appliedImagery,
  coordinates,
  canLoadOlder,
  loadMoreError,
  loadingMore,
  onAutoLoadMore,
  onClose,
  onFitFootprint,
  onLoadMore,
  onSelect,
  onToggleImagery,
  searchState,
  scrollRequestId,
  selectedSceneId,
  timeZone,
  visibleCount,
}: {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly coordinates: string;
  readonly canLoadOlder: boolean;
  readonly loadMoreError: string | null;
  readonly loadingMore: boolean;
  readonly onAutoLoadMore: () => void;
  readonly onClose: () => void;
  readonly onFitFootprint: () => void;
  readonly onLoadMore: () => void;
  readonly onSelect: (match: SatelliteSceneMatch) => void;
  readonly onToggleImagery: (visible: boolean) => void;
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
        height: '100%',
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
              : `${String(result.sceneCount)} image${result.sceneCount === 1 ? '' : 's'} · ${String(result.acquisitionDateCount)} acquisition day${result.acquisitionDateCount === 1 ? '' : 's'}`}
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
                  appliedImagery={appliedImagery}
                  key={`${match.scene.collection}:${match.scene.id}`}
                  match={match}
                  selected={match.scene.id === selectedSceneId}
                  timeZone={timeZone}
                  onSelect={() => {
                    onSelect(match);
                  }}
                  onFitFootprint={onFitFootprint}
                  onToggleImagery={onToggleImagery}
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

export function SatelliteBrowser({
  active = true,
  fallbackCoordinates,
}: SatelliteBrowserProps) {
  const { clock, database, logger, mapLayers, mapViewport, searchSatelliteScenes } =
    useRuntimeServices();
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
  const [submittedTimeZone, setSubmittedTimeZone] = useState('Asia/Tbilisi');
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(null);
  const [loadedMonths, setLoadedMonths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [autoLoadAttempts, setAutoLoadAttempts] = useState(0);
  const [scrollRequestId, setScrollRequestId] = useState(0);
  const request = useRef<AbortController | null>(null);
  const calendarMonthLoadTimer = useRef<number | null>(null);
  const applyRequest = useRef<AbortController | null>(null);
  const cloudCoverChangedByUser = useRef(false);
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
  const searchAreaSource = satelliteSearchAnchor === null ? 'viewport' : 'custom';
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
    const loadMaximumCloudCover = async () => {
      try {
        const value = await database.loadMaximumCloudCoverPercent();
        if (!cancelled && !cloudCoverChangedByUser.current) {
          setMaxCloudCoverPercent(value);
        }
      } catch {
        logger.log({
          level: 'warn',
          name: 'storage.satellite-preferences.load-failed',
        });
      }
    };

    void loadMaximumCloudCover();
    return () => {
      cancelled = true;
    };
  }, [database, logger]);

  const coordinates =
    searchViewport === null
      ? fallbackCoordinates
      : `${searchViewport.center.latitude.toFixed(4)}, ${searchViewport.center.longitude.toFixed(4)}`;
  const restoredScene = useMemo(() => {
    return selectedMapScene ?? mapLayers?.getSelectedScene() ?? null;
  }, [mapLayers, selectedMapScene]);
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
    beginSatelliteRequest(
      `Loading Sentinel imagery for ${monthFormatter.format(new Date(`${range.month}-01T00:00:00.000Z`))}…`,
    );
    try {
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
      completeSatelliteRequest(
        `${String(mergedResult.sceneCount)} Sentinel image${mergedResult.sceneCount === 1 ? '' : 's'} available`,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof SatelliteSearchError
          ? error.message
          : `${monthFormatter.format(new Date(`${range.month}-01T00:00:00.000Z`))} imagery could not be loaded. Try again.`;
      setLoadMoreError(message);
      failSatelliteRequest(message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoadingMonth(null);
        setLoadingMore(false);
      }
    }
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
    beginSatelliteRequest('Searching the Earth Search Sentinel catalog…');
    try {
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
        completeSatelliteRequest(
          `${String(result.sceneCount)} Sentinel image${result.sceneCount === 1 ? '' : 's'} available`,
        );
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof SatelliteSearchError
          ? error.message
          : 'The imagery search could not be completed.';
      setSearchState({
        status: 'error',
        message,
      });
      failSatelliteRequest(message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoadingMonth(null);
      }
    }
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
    completeSatelliteRequest('Sentinel search cancelled');
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
      return;
    }
    setSelectedSceneId(match.scene.id);
    applyRequest.current?.abort();
    const controller = new AbortController();
    applyRequest.current = controller;
    void mapLayers.applyScene(match.scene, controller.signal).finally(() => {
      if (applyRequest.current === controller) applyRequest.current = null;
    });
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

  return (
    <>
      <SatelliteSearchRequestRunner
        canRun={active && canSearch}
        requestId={satelliteSearchRequest?.id ?? null}
        onRun={runSearch}
      />
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography component="h3" variant="subtitle2">
          Acquisition calendar
        </Typography>
        <AcquisitionCalendar
          displayMonth={calendarMonth}
          loadingMonth={loadingMonth}
          maxCloudCoverPercent={maxCloudCoverPercent}
          maximumMonth={latestMonth}
          navigationDisabled={searchState.status === 'loading'}
          onMonthChange={changeCalendarMonth}
          onSelectDate={selectCalendarDate}
          result={calendarResult}
          today={today}
        />
        {loadMoreError === null || resultsOpen ? null : (
          <Alert severity="error">{loadMoreError}</Alert>
        )}
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
            Search images
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
              {searchAreaSource === 'custom' ? 'Custom' : 'Point'} {coordinates} ·{' '}
              {monthFormatter.format(new Date(`${calendarMonth}-01T00:00:00.000Z`))} →
              older · highlight cloud ≤ {maxCloudCoverPercent}%
            </Typography>
          ) : null}
        </Box>

        <Divider />
        <FormControl size="small" fullWidth>
          <InputLabel id="satellite-search-area-label">Search area source</InputLabel>
          <Select
            labelId="satellite-search-area-label"
            label="Search area source"
            displayEmpty
            value={searchAreaSource === 'custom' ? '' : searchAreaSource}
            onChange={changeSearchAreaSource}
            renderValue={() => (
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ minWidth: 72, fontWeight: 700 }}>
                  {searchAreaSource === 'custom' ? 'Custom' : 'Point'}
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
          <FormHelperText>
            Uses the map center point or a custom area for imagery search.
          </FormHelperText>
        </FormControl>
        <SatelliteRenderingControls />
      </Stack>
      {active && portalTarget !== null && paneOpen
        ? createPortal(
            <SatelliteResultsPane
              appliedImagery={appliedImagery}
              coordinates={paneCoordinates}
              canLoadOlder={nextArchiveMonth !== null}
              loadingMore={loadingMore}
              loadMoreError={loadMoreError}
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
              onFitFootprint={() => {
                mapLayers?.fitFootprint();
              }}
              onToggleImagery={(visible) => {
                mapLayers?.setLayerVisibility('satellite-imagery', visible);
              }}
            />,
            portalTarget,
          )
        : null}
    </>
  );
}
