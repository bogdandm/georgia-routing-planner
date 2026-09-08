import type { SearchSatelliteScenes } from '@/application/satellite/SearchSatelliteScenes';
import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
import { validateSatelliteViewport } from '@/application/satellite/validateSatelliteSearchCriteria';
import { SatelliteGeometryError } from '@/domain/satellite/SatelliteGeometryError';
import type {
  SatelliteProductLevel,
  SatelliteSearchViewport,
} from '@/domain/satellite/SatelliteSearchCriteria';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import {
  satelliteMosaicCompleteCoveragePercent,
  SatelliteMosaicSelectionAccumulator,
} from '@/domain/satellite/selectSatelliteMosaicScenes';

export const sentinelArchiveStartDate = '2015-06-23';
const utcDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const millisecondsPerDay = 86_400_000;

export interface SatelliteMosaicSearchInput {
  readonly viewport: SatelliteSearchViewport;
  readonly selectedDate: string;
  readonly productLevel: Extract<SatelliteProductLevel, 'L2A'>;
}

export interface SatelliteMosaicResult {
  readonly scenes: readonly SatelliteScene[];
  readonly coveragePercent: number;
  readonly oldestAcquisitionDate: string | null;
  readonly archiveExhausted: boolean;
}

function parseSelectedDate(selectedDate: string): number {
  const timestamp = Date.parse(`${selectedDate}T00:00:00.000Z`);
  if (
    !utcDatePattern.test(selectedDate) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== selectedDate ||
    selectedDate < sentinelArchiveStartDate
  ) {
    throw new SatelliteSearchError(
      'invalid-date',
      'Choose a date within the Sentinel archive.',
    );
  }
  return timestamp;
}

/** Searches complete descending calendar months until the viewport mosaic is complete. */
export class SearchSatelliteMosaic {
  public constructor(private readonly searchScenes: SearchSatelliteScenes) {}

  public async execute(
    input: SatelliteMosaicSearchInput,
    signal: AbortSignal,
  ): Promise<SatelliteMosaicResult> {
    parseSelectedDate(input.selectedDate);
    const viewport = validateSatelliteViewport(input.viewport);
    let endDate = input.selectedDate;
    const selectionAccumulator = new SatelliteMosaicSelectionAccumulator(viewport);

    try {
      for (;;) {
        signal.throwIfAborted();
        const monthStart = `${endDate.slice(0, 7)}-01`;
        const startDate = monthStart.startsWith(sentinelArchiveStartDate.slice(0, 7))
          ? sentinelArchiveStartDate
          : monthStart;
        const reachedArchiveStart = startDate === sentinelArchiveStartDate;
        const result = await this.searchScenes.executeViewport(
          {
            viewport,
            startDate,
            endDate,
            productLevel: input.productLevel,
            maxCloudCoverPercent: null,
          },
          signal,
        );
        signal.throwIfAborted();
        const selection = selectionAccumulator.addGroups(result.groups);

        if (selectionAccumulator.limitReached) {
          throw new SatelliteSearchError(
            'result-limit-exceeded',
            'This area needs too many Sentinel images. Zoom in and try again.',
          );
        }
        if (
          selection.coveragePercent >= satelliteMosaicCompleteCoveragePercent ||
          reachedArchiveStart
        ) {
          return {
            ...selection,
            archiveExhausted: reachedArchiveStart,
          };
        }

        const monthStartTimestamp = Date.parse(`${monthStart}T00:00:00.000Z`);
        endDate = new Date(monthStartTimestamp - millisecondsPerDay)
          .toISOString()
          .slice(0, 10);
      }
    } catch (error) {
      if (error instanceof SatelliteGeometryError) {
        throw new SatelliteSearchError(
          'invalid-scene-geometry',
          'A returned scene has geometry that cannot be measured.',
        );
      }
      throw error;
    }
  }
}
