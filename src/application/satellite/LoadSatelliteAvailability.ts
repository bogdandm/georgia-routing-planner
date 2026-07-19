import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import {
  SatelliteCatalogError,
  type SatelliteCatalogGateway,
} from '@/application/ports/SatelliteCatalogGateway';
import type { SentinelQueryDiagnostics } from '@/application/ports/SentinelQueryDiagnostics';
import { maximumSatelliteSearchResults } from '@/application/satellite/SearchSatelliteScenes';
import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
import { SentinelQueryOperation } from '@/application/satellite/SentinelQueryOperation';
import {
  validateSatelliteSearchCriteria,
  validateSatelliteViewport,
} from '@/application/satellite/validateSatelliteSearchCriteria';
import type {
  SatelliteProductLevel,
  SatelliteSearchViewport,
} from '@/domain/satellite/SatelliteSearchCriteria';
import type {
  SatelliteAvailabilityDate,
  SatelliteAvailabilityResult,
} from '@/domain/satellite/SatelliteSearchResult';
import { satelliteSceneKey } from '@/domain/satellite/SatelliteScene';

export interface SatelliteAvailabilityInput {
  readonly viewport: SatelliteSearchViewport;
  readonly month: string;
  readonly productLevel: SatelliteProductLevel;
  readonly maxCloudCoverPercent: number;
}

const monthPattern = /^(\d{4})-(\d{2})$/u;

function monthDateRange(month: string): {
  readonly startDate: string;
  readonly endDate: string;
} {
  const match = monthPattern.exec(month);
  const year = Number(match?.[1]);
  const monthNumber = Number(match?.[2]);
  if (
    match === null ||
    !Number.isInteger(year) ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12
  ) {
    throw new SatelliteSearchError('invalid-date', 'Choose a valid calendar month.');
  }
  const finalDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${String(finalDay).padStart(2, '0')}`,
  };
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/** Loads bounded per-day acquisition hints for one visible UTC calendar month. */
export class LoadSatelliteAvailability {
  public constructor(
    private readonly gateway: SatelliteCatalogGateway,
    private readonly diagnostics: SentinelQueryDiagnostics,
    private readonly logger: DiagnosticLogger,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  public async execute(
    input: SatelliteAvailabilityInput,
    signal: AbortSignal,
  ): Promise<SatelliteAvailabilityResult> {
    const operation = new SentinelQueryOperation(
      this.idGenerator.generate(),
      this.diagnostics,
    );
    const startedAt = this.clock.monotonicNow();
    this.logger.log({
      level: 'info',
      name: 'satellite.availability.started',
      data: { operationId: operation.id },
    });

    try {
      signal.throwIfAborted();
      operation.beginStep('capture-viewport');
      const viewport = validateSatelliteViewport(input.viewport);
      operation.completeStep();

      operation.beginStep('build-search-criteria');
      const range = monthDateRange(input.month);
      const criteria = validateSatelliteSearchCriteria({
        viewport,
        ...range,
        productLevel: input.productLevel,
        maxCloudCoverPercent: input.maxCloudCoverPercent,
      });
      operation.completeStep();

      const catalogResult = await this.gateway.search(
        { criteria, maximumItems: maximumSatelliteSearchResults },
        { operationId: operation.id, signal },
      );
      signal.throwIfAborted();
      if (
        !Number.isInteger(catalogResult.totalMatched) ||
        catalogResult.totalMatched < 0 ||
        catalogResult.totalMatched > maximumSatelliteSearchResults ||
        catalogResult.scenes.length > maximumSatelliteSearchResults
      ) {
        throw new SatelliteSearchError(
          'result-limit-exceeded',
          'Too many acquisitions matched. Reduce the cloud limit or zoom in.',
        );
      }

      operation.beginStep('calculate-coverage');
      const uniqueScenes = new Map(
        catalogResult.scenes.map((scene) => [satelliteSceneKey(scene), scene]),
      );
      if (
        [...uniqueScenes.values()].some(
          (scene) => scene.productLevel !== criteria.productLevel,
        )
      ) {
        throw new SatelliteSearchError(
          'provider-capability',
          'The catalog mixed product levels in one availability result.',
        );
      }
      const byDate = new Map<string, number[]>();
      for (const scene of uniqueScenes.values()) {
        const timestamp = Date.parse(scene.acquiredAt);
        if (!Number.isFinite(timestamp)) {
          throw new SatelliteSearchError(
            'provider-capability',
            'The catalog returned an invalid acquisition time.',
          );
        }
        const date = new Date(timestamp).toISOString().slice(0, 10);
        const clouds = byDate.get(date) ?? [];
        clouds.push(scene.cloudCoverPercent);
        byDate.set(date, clouds);
      }
      const dates: readonly SatelliteAvailabilityDate[] = [...byDate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, clouds]) => ({
          date,
          sceneCount: clouds.length,
          cloudSummaryPercent: Math.min(...clouds),
        }));
      operation.complete();

      const result: SatelliteAvailabilityResult = {
        month: input.month,
        dates,
        totalMatched: catalogResult.totalMatched,
      };
      this.logger.log({
        level: 'info',
        name: 'satellite.availability.completed',
        data: {
          operationId: operation.id,
          count: dates.length,
          durationMs: Math.max(0, this.clock.monotonicNow() - startedAt),
        },
      });
      return result;
    } catch (error) {
      if (isCancellation(error, signal)) {
        operation.cancel();
        this.logger.log({
          level: 'info',
          name: 'satellite.availability.cancelled',
          data: { operationId: operation.id },
        });
        throw error;
      }
      operation.fail();
      const safeError =
        error instanceof SatelliteSearchError
          ? error
          : error instanceof SatelliteCatalogError
            ? new SatelliteSearchError(error.code, error.message)
            : new SatelliteSearchError(
                'provider-capability',
                'The satellite catalog could not load acquisition dates.',
              );
      this.logger.log({
        level: 'error',
        name: 'satellite.availability.failed',
        data: { operationId: operation.id, code: safeError.code },
      });
      throw safeError;
    }
  }
}
