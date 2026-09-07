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

class MosaicCoverageAccumulator {
  readonly #viewportFeature: Feature<Polygon>;
  readonly #viewportArea: number;
  #coverageGeometry: Feature<Polygon | MultiPolygon> | null = null;

  public constructor(viewport: SatelliteSearchViewport) {
    this.#viewportFeature = createViewportFeature(viewport);
    this.#viewportArea = area(this.#viewportFeature);
    if (!Number.isFinite(this.#viewportArea) || this.#viewportArea <= 0) {
      throw new SatelliteGeometryError('Submitted viewport has no measurable area.');
    }
  }

  public add(scene: SatelliteScene): boolean {
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
      if (clipped === null) return false;
      if (this.#coverageGeometry === null) {
        this.#coverageGeometry = clipped;
      } else {
        const combined: Feature<Polygon | MultiPolygon> | null = union(
          featureCollection<Polygon | MultiPolygon>([this.#coverageGeometry, clipped]),
        );
        if (combined === null) {
          throw new SatelliteGeometryError('Scene footprints could not be combined.');
        }
        this.#coverageGeometry = combined;
      }
      return true;
    } catch (error) {
      if (error instanceof SatelliteGeometryError) throw error;
      throw new SatelliteGeometryError('Scene footprint could not be composed.');
    }
  }

  public coveragePercent(): number {
    const coverageArea =
      this.#coverageGeometry === null ? 0 : area(this.#coverageGeometry);
    if (!Number.isFinite(coverageArea) || coverageArea < 0) {
      throw new SatelliteGeometryError('Mosaic coverage could not be measured.');
    }
    return Math.min(100, Math.max(0, (coverageArea / this.#viewportArea) * 100));
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
  const composition = new MosaicCoverageAccumulator(viewport);
  const scenes: SatelliteScene[] = [];
  const acceptedBounds = new Set<string>();
  let coveragePercent = 0;
  let oldestAcquisitionDate: string | null = null;

  for (const group of groups.toSorted((left, right) =>
    right.date.localeCompare(left.date),
  )) {
    let acceptedFromGroup = false;
    for (const match of group.scenes) {
      const { scene } = match;
      if (scene.productLevel !== 'L2A') continue;

      const boundsKey = satelliteSceneBoundsKey(scene);
      if (acceptedBounds.has(boundsKey) || !composition.add(scene)) continue;

      acceptedBounds.add(boundsKey);
      scenes.push(scene);
      acceptedFromGroup = true;
    }

    if (acceptedFromGroup) oldestAcquisitionDate = group.date;
    coveragePercent = composition.coveragePercent();
    if (coveragePercent >= satelliteMosaicCompleteCoveragePercent) break;
  }

  return { scenes, coveragePercent, oldestAcquisitionDate };
}
