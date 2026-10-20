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
