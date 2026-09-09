import area from '@turf/area';
import { feature, featureCollection, polygon } from '@turf/helpers';
import intersect from '@turf/intersect';
import union from '@turf/union';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

import { SatelliteGeometryError } from '@/domain/satellite/SatelliteGeometryError';
import {
  satelliteViewportValidationIssue,
  type SatelliteSearchViewport,
} from '@/domain/satellite/SatelliteSearchCriteria';
import type { SatelliteAcquisitionGroup } from '@/domain/satellite/SatelliteSearchResult';
import {
  satelliteSceneBoundsKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';

export const satelliteMosaicCompleteCoveragePercent = 100 - 1e-6;
export const maximumSatelliteMosaicSceneCount = 128;

export interface SatelliteMosaicSelection {
  readonly scenes: readonly SatelliteScene[];
  readonly coveragePercent: number;
  readonly oldestAcquisitionDate: string | null;
}

function createViewportFeature(viewport: SatelliteSearchViewport): Feature<Polygon> {
  const issue = satelliteViewportValidationIssue(viewport);
  if (issue !== null) {
    throw new SatelliteGeometryError('Submitted viewport has invalid bounds.');
  }
  const { west, south, east, north } = viewport.bounds;

  return polygon([
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ]);
}

interface MosaicCoverageUpdate {
  readonly geometry: Feature<Polygon | MultiPolygon>;
  readonly area: number;
}

class MosaicCoverageAccumulator {
  readonly #viewportFeature: Feature<Polygon>;
  readonly #viewportArea: number;
  #coverageGeometry: Feature<Polygon | MultiPolygon> | null = null;
  #coverageArea = 0;

  public constructor(viewport: SatelliteSearchViewport) {
    this.#viewportFeature = createViewportFeature(viewport);
    this.#viewportArea = area(this.#viewportFeature);
    if (!Number.isFinite(this.#viewportArea) || this.#viewportArea <= 0) {
      throw new SatelliteGeometryError('Submitted viewport has no measurable area.');
    }
  }

  public add(scene: SatelliteScene): boolean {
    const update = this.calculateUpdate(scene);
    if (update === null) return false;
    this.#coverageGeometry = update.geometry;
    this.#coverageArea = update.area;
    return true;
  }

  public wouldIncreaseCoverage(scene: SatelliteScene): boolean {
    return this.calculateUpdate(scene) !== null;
  }

  private calculateUpdate(scene: SatelliteScene): MosaicCoverageUpdate | null {
    const footprintFeature = feature(scene.footprint);
    try {
      const footprintArea = area(footprintFeature);
      if (!Number.isFinite(footprintArea) || footprintArea <= 0) {
        throw new SatelliteGeometryError('Scene footprint has no measurable area.');
      }
      const clipped = intersect(
        featureCollection<Polygon | MultiPolygon>([
          this.#viewportFeature,
          footprintFeature,
        ]),
      );
      if (clipped === null) return null;

      const minimumIncreaseArea =
        (this.#viewportArea * (100 - satelliteMosaicCompleteCoveragePercent)) / 100;
      if (this.#coverageGeometry === null) {
        const clippedArea = area(clipped);
        if (!Number.isFinite(clippedArea) || clippedArea < 0) {
          throw new SatelliteGeometryError('Scene footprint could not be measured.');
        }
        return clippedArea <= minimumIncreaseArea
          ? null
          : { geometry: clipped, area: clippedArea };
      }

      const combined: Feature<Polygon | MultiPolygon> | null = union(
        featureCollection<Polygon | MultiPolygon>([this.#coverageGeometry, clipped]),
      );
      if (combined === null) {
        throw new SatelliteGeometryError('Scene footprints could not be combined.');
      }
      const combinedArea = area(combined);
      if (!Number.isFinite(combinedArea) || combinedArea < 0) {
        throw new SatelliteGeometryError('Mosaic coverage could not be measured.');
      }
      return combinedArea - this.#coverageArea <= minimumIncreaseArea
        ? null
        : { geometry: combined, area: combinedArea };
    } catch (error) {
      if (error instanceof SatelliteGeometryError) throw error;
      throw new SatelliteGeometryError('Scene footprint could not be composed.');
    }
  }

  public coveragePercent(): number {
    return Math.min(100, Math.max(0, (this.#coverageArea / this.#viewportArea) * 100));
  }
}

/**
 * Retains only the bounded selection and union geometry while older catalog months arrive.
 * The scene cap also bounds the number of native MapLibre raster caches in one Mosaic.
 */
export class SatelliteMosaicSelectionAccumulator {
  readonly #composition: MosaicCoverageAccumulator;
  readonly #scenes: SatelliteScene[] = [];
  readonly #acceptedBounds = new Set<string>();
  #coveragePercent = 0;
  #oldestAcquisitionDate: string | null = null;
  #limitReached = false;

  public constructor(viewport: SatelliteSearchViewport) {
    this.#composition = new MosaicCoverageAccumulator(viewport);
  }

  public get limitReached(): boolean {
    return this.#limitReached;
  }

  public addGroups(
    groups: readonly SatelliteAcquisitionGroup[],
  ): SatelliteMosaicSelection {
    if (
      this.#limitReached ||
      this.#coveragePercent >= satelliteMosaicCompleteCoveragePercent
    ) {
      return this.snapshot();
    }

    for (const group of groups.toSorted((left, right) =>
      right.date.localeCompare(left.date),
    )) {
      let acceptedFromGroup = false;
      for (const match of group.scenes) {
        const { scene } = match;
        if (scene.productLevel !== 'L2A') continue;

        const boundsKey = satelliteSceneBoundsKey(scene);
        if (this.#acceptedBounds.has(boundsKey)) continue;
        if (this.#scenes.length >= maximumSatelliteMosaicSceneCount) {
          if (!this.#composition.wouldIncreaseCoverage(scene)) continue;
          this.#limitReached = true;
          break;
        }
        if (!this.#composition.add(scene)) continue;

        this.#acceptedBounds.add(boundsKey);
        this.#scenes.push(scene);
        acceptedFromGroup = true;
        this.#coveragePercent = this.#composition.coveragePercent();
        if (this.#coveragePercent >= satelliteMosaicCompleteCoveragePercent) break;
      }

      if (acceptedFromGroup) this.#oldestAcquisitionDate = group.date;
      this.#coveragePercent = this.#composition.coveragePercent();
      if (
        this.#limitReached ||
        this.#coveragePercent >= satelliteMosaicCompleteCoveragePercent
      ) {
        break;
      }
    }

    return this.snapshot();
  }

  private snapshot(): SatelliteMosaicSelection {
    return {
      scenes: [...this.#scenes],
      coveragePercent: this.#coveragePercent,
      oldestAcquisitionDate: this.#oldestAcquisitionDate,
    };
  }
}

export function calculateSatelliteMosaicCoveragePercent(
  viewport: SatelliteSearchViewport,
  scenes: readonly SatelliteScene[],
): number {
  const composition = new MosaicCoverageAccumulator(viewport);
  const acceptedBounds = new Set<string>();
  for (const scene of scenes) {
    const boundsKey = satelliteSceneBoundsKey(scene);
    if (acceptedBounds.has(boundsKey)) continue;
    if (composition.add(scene)) acceptedBounds.add(boundsKey);
  }
  return composition.coveragePercent();
}

/** Selects newest unique Sentinel bounds until their clipped union fills the viewport. */
export function selectSatelliteMosaicScenes(
  viewport: SatelliteSearchViewport,
  groups: readonly SatelliteAcquisitionGroup[],
): SatelliteMosaicSelection {
  return new SatelliteMosaicSelectionAccumulator(viewport).addGroups(groups);
}
