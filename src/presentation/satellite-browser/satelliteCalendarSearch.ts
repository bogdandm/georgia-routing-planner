import type { SearchSatelliteScenes } from '@/application/satellite/SearchSatelliteScenes';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';
import type {
  SatelliteSceneMatch,
  SatelliteSearchResult,
} from '@/domain/satellite/SatelliteSearchResult';

/** Calendar searches load every scene; the cloud slider only filters on the client. */
export const catalogCloudCoverCeilingPercent = 100;

export interface SearchMonthRange {
  readonly month: string;
  readonly startDate: string;
  readonly endDate: string;
}

export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The UTC date range of a calendar month; the current month ends today. */
export function searchMonthRange(month: string, today: Date): SearchMonthRange {
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

/** Months kept per search service; the least recently used entries are dropped first. */
const monthResultCacheLimit = 64;

/**
 * Loaded calendar months of the comparison pickers, per search service, so reopening a
 * picker or paging back to a month does not query the catalog again. Only successful
 * results are kept, for the page session.
 */
const monthResultCaches = new WeakMap<
  SearchSatelliteScenes,
  Map<string, SatelliteSearchResult>
>();

/**
 * The searched range, so the current month misses once a new day extends it. Rounding to
 * about 10 m absorbs float noise between the synchronized panes' views.
 */
function monthResultKey(
  viewport: SatelliteSearchViewport,
  range: SearchMonthRange,
): string {
  const { west, south, east, north } = viewport.bounds;
  const { longitude, latitude } = viewport.center;
  return [
    range.startDate,
    range.endDate,
    ...[west, south, east, north, longitude, latitude].map((value) => value.toFixed(4)),
  ].join('|');
}

export function cachedCalendarMonth(
  searchScenes: SearchSatelliteScenes,
  viewport: SatelliteSearchViewport,
  month: string,
  today: Date,
): SatelliteSearchResult | undefined {
  const cache = monthResultCaches.get(searchScenes);
  const key = monthResultKey(viewport, searchMonthRange(month, today));
  const result = cache?.get(key);
  if (cache !== undefined && result !== undefined) {
    cache.delete(key);
    cache.set(key, result);
  }
  return result;
}

/** Loads one calendar month at a viewport and remembers the result. */
export async function loadCalendarMonth(
  searchScenes: SearchSatelliteScenes,
  viewport: SatelliteSearchViewport,
  month: string,
  today: Date,
  signal: AbortSignal,
): Promise<SatelliteSearchResult> {
  const range = searchMonthRange(month, today);
  const result = await searchScenes.execute(
    {
      viewport,
      startDate: range.startDate,
      endDate: range.endDate,
      productLevel: 'L2A',
      maxCloudCoverPercent: catalogCloudCoverCeilingPercent,
    },
    signal,
  );
  let cache = monthResultCaches.get(searchScenes);
  if (cache === undefined) {
    cache = new Map();
    monthResultCaches.set(searchScenes, cache);
  }
  const key = monthResultKey(viewport, range);
  cache.delete(key);
  cache.set(key, result);
  if (cache.size > monthResultCacheLimit) {
    const oldest = cache.keys().next();
    if (oldest.done !== true) cache.delete(oldest.value);
  }
  return result;
}

/** The scene a calendar day click applies: the one covering most of the viewport. */
export function bestCoverageMatchOn(
  result: SatelliteSearchResult,
  date: string,
): SatelliteSceneMatch | undefined {
  return result.groups
    .find((candidate) => candidate.date === date)
    ?.scenes.reduce<SatelliteSceneMatch | undefined>(
      (best, candidate) =>
        best === undefined ||
        candidate.coverage.viewportCoveragePercent >
          best.coverage.viewportCoveragePercent
          ? candidate
          : best,
      undefined,
    );
}
