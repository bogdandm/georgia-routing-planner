import area from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { feature, featureCollection, lineString, point, polygon } from '@turf/helpers';
import intersect from '@turf/intersect';
import pointToLineDistance from '@turf/point-to-line-distance';
import type { MultiPolygon, Polygon, Position } from 'geojson';

import { SatelliteGeometryError } from '@/domain/satellite/SatelliteGeometryError';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';
import type { SatelliteSceneCoverage } from '@/domain/satellite/SatelliteSearchResult';

export const satelliteEdgeWarningDistanceKm = 2;

function assertFiniteGeometry(geometry: Polygon | MultiPolygon): void {
  const visitRing = (ring: Position[]) => {
    if (ring.length < 4) {
      throw new SatelliteGeometryError('Scene footprint has an incomplete ring.');
    }
    for (const coordinate of ring) {
      const longitude = coordinate[0];
      const latitude = coordinate[1];
      if (
        typeof longitude !== 'number' ||
        typeof latitude !== 'number' ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude)
      ) {
        throw new SatelliteGeometryError(
          'Scene footprint contains a non-finite coordinate.',
        );
      }
    }
  };

  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(visitRing);
    return;
  }
  geometry.coordinates.forEach((polygonCoordinates) => {
    polygonCoordinates.forEach(visitRing);
  });
}

function footprintRings(geometry: Polygon | MultiPolygon): readonly Position[][] {
  return geometry.type === 'Polygon'
    ? geometry.coordinates
    : geometry.coordinates.flatMap((polygonCoordinates) => polygonCoordinates);
}

/** Calculates display evidence against the immutable viewport submitted with a search. */
export function calculateSatelliteCoverage(
  viewport: SatelliteSearchViewport,
  footprint: Polygon | MultiPolygon,
): SatelliteSceneCoverage {
  assertFiniteGeometry(footprint);

  try {
    const viewportFeature = polygon([
      [
        [viewport.bounds.west, viewport.bounds.south],
        [viewport.bounds.east, viewport.bounds.south],
        [viewport.bounds.east, viewport.bounds.north],
        [viewport.bounds.west, viewport.bounds.north],
        [viewport.bounds.west, viewport.bounds.south],
      ],
    ]);
    const footprintFeature = feature(footprint);
    const viewportArea = area(viewportFeature);
    if (!Number.isFinite(viewportArea) || viewportArea <= 0) {
      throw new SatelliteGeometryError('Submitted viewport has no measurable area.');
    }

    const overlap = intersect(
      featureCollection<Polygon | MultiPolygon>([viewportFeature, footprintFeature]),
    );
    const overlapArea = overlap === null ? 0 : area(overlap);
    const viewportCoveragePercent = Math.min(
      100,
      Math.max(0, (overlapArea / viewportArea) * 100),
    );

    const interestPoint = point([viewport.center.longitude, viewport.center.latitude]);
    const isInsideOrBoundary = booleanPointInPolygon(interestPoint, footprintFeature);
    const isStrictlyInside = booleanPointInPolygon(interestPoint, footprintFeature, {
      ignoreBoundary: true,
    });
    const interestPointRelation = isStrictlyInside
      ? ('inside' as const)
      : isInsideOrBoundary
        ? ('boundary' as const)
        : ('outside' as const);

    const distanceToSceneEdgeKm = Math.min(
      ...footprintRings(footprint).map((ring) =>
        pointToLineDistance(interestPoint, lineString(ring), {
          units: 'kilometers',
          method: 'geodesic',
        }),
      ),
    );
    if (!Number.isFinite(distanceToSceneEdgeKm)) {
      throw new SatelliteGeometryError(
        'Scene footprint boundary distance is not finite.',
      );
    }

    return {
      viewportCoveragePercent,
      interestPointRelation,
      distanceToSceneEdgeKm,
      hasEdgeWarning:
        interestPointRelation !== 'inside' ||
        distanceToSceneEdgeKm <= satelliteEdgeWarningDistanceKm,
    };
  } catch (error) {
    if (error instanceof SatelliteGeometryError) throw error;
    throw new SatelliteGeometryError('Scene footprint is not a valid polygon.');
  }
}
