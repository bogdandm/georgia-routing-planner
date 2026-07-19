import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import {
  SatelliteCatalogError,
  type SatelliteCatalogGateway,
} from '@/application/ports/SatelliteCatalogGateway';
import type { SentinelQueryDiagnostics } from '@/application/ports/SentinelQueryDiagnostics';
import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
import { SentinelQueryOperation } from '@/application/satellite/SentinelQueryOperation';
import {
  validateSatelliteSearchCriteria,
  validateSatelliteViewport,
} from '@/application/satellite/validateSatelliteSearchCriteria';
import { calculateSatelliteCoverage } from '@/domain/satellite/calculateSatelliteCoverage';
import { SatelliteGeometryError } from '@/domain/satellite/SatelliteGeometryError';
import type { SatelliteSearchCriteriaInput } from '@/domain/satellite/SatelliteSearchCriteria';
import type {
  SatelliteAcquisitionGroup,
  SatelliteSceneMatch,
  SatelliteSearchResult,
} from '@/domain/satellite/SatelliteSearchResult';
import {
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';

export const maximumSatelliteSearchResults = 1_000;

function sceneTimestamp(scene: SatelliteScene): number {
  const timestamp = Date.parse(scene.acquiredAt);
  if (!Number.isFinite(timestamp)) {
    throw new SatelliteSearchError(
      'provider-capability',
      'The catalog returned a scene with an invalid acquisition time.',
    );
  }
  return timestamp;
}

function stableSceneOrder(left: SatelliteScene, right: SatelliteScene): number {
  return (
    sceneTimestamp(right) - sceneTimestamp(left) || left.id.localeCompare(right.id)
  );
}

function deduplicateScenes(
  scenes: readonly SatelliteScene[],
): readonly SatelliteScene[] {
  const byKey = new Map<string, SatelliteScene>();
  for (const scene of scenes) {
    if (!byKey.has(satelliteSceneKey(scene))) {
      byKey.set(satelliteSceneKey(scene), scene);
    }
  }
  return [...byKey.values()].sort(stableSceneOrder);
}

function groupMatches(
  matches: readonly SatelliteSceneMatch[],
): readonly SatelliteAcquisitionGroup[] {
  const byDate = new Map<string, SatelliteSceneMatch[]>();
  for (const match of matches) {
    const date = new Date(sceneTimestamp(match.scene)).toISOString().slice(0, 10);
    const group = byDate.get(date) ?? [];
    group.push(match);
    byDate.set(date, group);
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, scenes]) => ({
      date,
      scenes: scenes.toSorted((left, right) =>
        stableSceneOrder(left.scene, right.scene),
      ),
    }));
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/** Validates one submitted viewport search and returns deterministic date-grouped scenes. */
export class SearchSatelliteScenes {
  public constructor(
    private readonly gateway: SatelliteCatalogGateway,
    private readonly diagnostics: SentinelQueryDiagnostics,
    private readonly logger: DiagnosticLogger,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  public async execute(
    input: SatelliteSearchCriteriaInput,
    signal: AbortSignal,
  ): Promise<SatelliteSearchResult> {
    const operation = new SentinelQueryOperation(
      this.idGenerator.generate(),
      this.diagnostics,
    );
    const startedAt = this.clock.monotonicNow();
    this.logger.log({
      level: 'info',
      name: 'satellite.search.started',
      data: { operationId: operation.id },
    });

    try {
      signal.throwIfAborted();
      operation.beginStep('capture-viewport');
      const viewport = validateSatelliteViewport(input.viewport);
      operation.completeStep();

      operation.beginStep('build-search-criteria');
      const criteria = validateSatelliteSearchCriteria({ ...input, viewport });
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
          'This point matches more imagery than can be loaded safely.',
        );
      }

      operation.beginStep('calculate-coverage');
      const scenes = deduplicateScenes(catalogResult.scenes);
      if (scenes.some((scene) => scene.productLevel !== criteria.productLevel)) {
        throw new SatelliteSearchError(
          'provider-capability',
          'The catalog mixed product levels in one search result.',
        );
      }
      const matches = scenes.map((scene) => ({
        scene,
        coverage: calculateSatelliteCoverage(criteria.viewport, scene.footprint),
      }));
      const groups = groupMatches(matches);
      operation.complete();

      const result: SatelliteSearchResult = {
        groups,
        sceneCount: matches.length,
        acquisitionDateCount: groups.length,
        totalMatched: catalogResult.totalMatched,
      };
      this.logger.log({
        level: 'info',
        name: 'satellite.search.completed',
        data: {
          operationId: operation.id,
          count: result.sceneCount,
          durationMs: Math.max(0, this.clock.monotonicNow() - startedAt),
        },
      });
      return result;
    } catch (error) {
      if (isCancellation(error, signal)) {
        operation.cancel();
        this.logger.log({
          level: 'info',
          name: 'satellite.search.cancelled',
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
            : error instanceof SatelliteGeometryError
              ? new SatelliteSearchError(
                  'invalid-scene-geometry',
                  'A returned scene has geometry that cannot be measured.',
                )
              : new SatelliteSearchError(
                  'provider-capability',
                  'The satellite catalog could not complete this search.',
                );
      this.logger.log({
        level: 'error',
        name: 'satellite.search.failed',
        data: { operationId: operation.id, code: safeError.code },
      });
      throw safeError;
    }
  }
}
