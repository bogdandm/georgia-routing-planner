import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';

import {
  calculateSatelliteCoverage,
  satelliteEdgeWarningDistanceKm,
} from '@/domain/satellite/calculateSatelliteCoverage';
import { SatelliteGeometryError } from '@/domain/satellite/SatelliteGeometryError';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';

const viewport: SatelliteSearchViewport = {
  bounds: { west: 0, south: 0, east: 2, north: 2 },
  center: { longitude: 1, latitude: 1 },
};

function rectangle(west: number, south: number, east: number, north: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

describe('calculateSatelliteCoverage', () => {
  it('reports complete viewport coverage and an interior interest point', () => {
    const result = calculateSatelliteCoverage(viewport, rectangle(-1, -1, 3, 3));

    expect(result.viewportCoveragePercent).toBeCloseTo(100, 6);
    expect(result.interestPointRelation).toBe('inside');
    expect(result.distanceToSceneEdgeKm).toBeGreaterThan(100);
    expect(result.hasEdgeWarning).toBe(false);
  });

  it('reports partial coverage and a point exactly on the scene boundary', () => {
    const result = calculateSatelliteCoverage(viewport, rectangle(0, 0, 1, 2));

    expect(result.viewportCoveragePercent).toBeCloseTo(50, 1);
    expect(result.interestPointRelation).toBe('boundary');
    expect(result.distanceToSceneEdgeKm).toBeCloseTo(0, 6);
    expect(result.hasEdgeWarning).toBe(true);
  });

  it('reports zero area when footprints only touch the viewport boundary', () => {
    const result = calculateSatelliteCoverage(viewport, rectangle(2, 0, 3, 2));

    expect(result.viewportCoveragePercent).toBe(0);
    expect(result.interestPointRelation).toBe('outside');
    expect(result.distanceToSceneEdgeKm).toBeGreaterThan(80);
    expect(result.hasEdgeWarning).toBe(false);
  });

  it('warns when an outside search anchor is less than five kilometres from the border', () => {
    const result = calculateSatelliteCoverage(viewport, rectangle(1.02, 0, 3, 2));

    expect(result.interestPointRelation).toBe('outside');
    expect(result.distanceToSceneEdgeKm).toBeLessThan(satelliteEdgeWarningDistanceKm);
    expect(result.hasEdgeWarning).toBe(true);
  });

  it('warns when an interior interest point is close to an edge', () => {
    const result = calculateSatelliteCoverage(viewport, rectangle(0.99, 0, 3, 2));

    expect(result.interestPointRelation).toBe('inside');
    expect(result.distanceToSceneEdgeKm).toBeLessThan(satelliteEdgeWarningDistanceKm);
    expect(result.hasEdgeWarning).toBe(true);
  });

  it('rejects an invalid provider footprint with a typed geometry error', () => {
    const invalid: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    };

    expect(() => calculateSatelliteCoverage(viewport, invalid)).toThrow(
      SatelliteGeometryError,
    );
  });
});
