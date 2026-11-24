import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type {
  PlaceSearchBounds,
  PlaceSearchGateway,
  PlaceSearchResult,
} from '@/application/ports/PlaceSearchGateway';
import {
  expandPlaceSearchBounds,
  largerPlaceSearchSideKm,
  limitPlaceSearchBounds,
} from '@/application/map/expandPlaceSearchBounds';

// Doubling reaches the 500 km radius cap from a sub-metre viewport within 32 requests.
// This also prevents a provider cache or future bounds regression from monopolizing
// the browser event loop.
const maximumSearchAttempts = 32;

function resultDisplayIdentity(result: PlaceSearchResult): string {
  return `${result.label.trim().toLocaleLowerCase('en')}|${result.category.toLocaleLowerCase('en')}`;
}

export type PlaceSearchProgress =
  | {
      readonly status: 'expanding';
      readonly attempt: number;
      readonly largerSideKm: number;
      readonly results: readonly PlaceSearchResult[];
    }
  | {
      readonly status: 'completed';
      readonly attempt: number;
      readonly results: readonly PlaceSearchResult[];
    }
  | {
      readonly status: 'exhausted';
      readonly attempt: number;
      readonly largerSideKm: number;
      readonly results: readonly PlaceSearchResult[];
    };

/**
 * Searches increasingly wide provider-bounded areas and preserves inner-area ranking.
 * Results are emitted incrementally and visually equivalent provider records are
 * collapsed because OSM may model one named street as several separate ways.
 */
export class SearchPlaces {
  public constructor(
    private readonly gateway: PlaceSearchGateway,
    private readonly logger: DiagnosticLogger,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  public async execute(
    rawQuery: string,
    bounds: PlaceSearchBounds,
    signal: AbortSignal,
    onProgress?: (progress: PlaceSearchProgress) => void,
  ): Promise<readonly PlaceSearchResult[]> {
    const query = rawQuery.trim().replace(/\s+/gu, ' ').slice(0, 200);
    if (query.length < 2) return [];
    const operationId = this.idGenerator.generate();
    const startedAt = this.clock.monotonicNow();
    this.logger.log({
      level: 'info',
      name: 'place-search.started',
      data: { operationId },
    });
    try {
      let currentBounds = limitPlaceSearchBounds(bounds);
      let attempt = 1;
      const resultsByDisplayIdentity = new Map<string, PlaceSearchResult>();
      for (;;) {
        const page = await this.gateway.search(query, currentBounds, signal);
        for (const result of page) {
          const identity = resultDisplayIdentity(result);
          if (!resultsByDisplayIdentity.has(identity)) {
            resultsByDisplayIdentity.set(identity, result);
          }
        }
        const results = [...resultsByDisplayIdentity.values()];
        const expandedBounds = expandPlaceSearchBounds(currentBounds);
        if (expandedBounds === null || attempt >= maximumSearchAttempts) {
          onProgress?.(
            results.length === 0
              ? {
                  status: 'exhausted',
                  attempt,
                  largerSideKm: largerPlaceSearchSideKm(currentBounds),
                  results,
                }
              : { status: 'completed', attempt, results },
          );
          break;
        }
        attempt += 1;
        currentBounds = expandedBounds;
        onProgress?.({
          status: 'expanding',
          attempt,
          largerSideKm: largerPlaceSearchSideKm(currentBounds),
          results,
        });
      }
      const results = [...resultsByDisplayIdentity.values()];
      this.logger.log({
        level: 'info',
        name: 'place-search.completed',
        data: {
          operationId,
          count: results.length,
          attempts: attempt,
          durationMs: Math.max(0, this.clock.monotonicNow() - startedAt),
        },
      });
      return results;
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        this.logger.log({
          level: 'info',
          name: 'place-search.cancelled',
          data: { operationId },
        });
        throw error;
      }
      this.logger.log({
        level: 'warn',
        name: 'place-search.failed',
        data: { operationId, status: 'provider-error' },
      });
      throw error;
    }
  }
}
