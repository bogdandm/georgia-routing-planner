import { describe, expect, it } from 'vitest';

import {
  curvatureDropMeters,
  destinationPoint,
  evaluateTerrainSunlight,
  horizonAngleTowardSun,
  terrainShadowModel,
  type TerrainElevationSampler,
  type TerrainObserver,
  visibleSolarDiskFraction,
} from '@/domain/terrain/terrainShadow';

const observer: TerrainObserver = {
  latitudeDegrees: 42,
  longitudeDegrees: 44,
  elevationMeters: 0,
};
const metersPerDegree = (terrainShadowModel.earthRadiusMeters * Math.PI) / 180;
const radius = terrainShadowModel.solarDiskRadiusDegrees;
const south = 180;
const north = 0;

/** Flat sea-level ground with an east–west wall south of the observer, between two distances. */
function southWall(
  startMeters: number,
  endMeters: number,
  heightMeters: number,
): TerrainElevationSampler {
  return {
    elevationAt(latitudeDegrees) {
      const southMeters =
        (observer.latitudeDegrees - latitudeDegrees) * metersPerDegree;
      return southMeters >= startMeters && southMeters <= endMeters ? heightMeters : 0;
    },
  };
}

function wallAngleDegrees(heightMeters: number, distanceMeters: number): number {
  return (
    Math.atan2(heightMeters - curvatureDropMeters(distanceMeters), distanceMeters) *
    (180 / Math.PI)
  );
}

describe('destinationPoint', () => {
  it('follows meridians exactly and wraps longitude across the antimeridian', () => {
    const northward = destinationPoint(10, 20, 0, metersPerDegree);
    const eastward = destinationPoint(0, 179.5, 90, metersPerDegree);

    expect(northward.latitudeDegrees).toBeCloseTo(11, 9);
    expect(northward.longitudeDegrees).toBeCloseTo(20, 9);
    expect(eastward.latitudeDegrees).toBeCloseTo(0, 9);
    expect(eastward.longitudeDegrees).toBeCloseTo(-179.5, 9);
  });
});

describe('horizonAngleTowardSun', () => {
  it('shades by the curvature-corrected wall angle and halves the disk at equality', () => {
    const sampler = southWall(1999, 2100, 300);
    const wallDegrees = wallAngleDegrees(300, 2000);

    const horizon = horizonAngleTowardSun(sampler, observer, south, {
      baseResolutionMeters: 10,
      maximumElevationMeters: 300,
      apparentSunElevationDegrees: wallDegrees,
    });

    expect(horizon.horizonDegrees).toBeCloseTo(wallDegrees, 9);
    expect(horizon.coverageLimited).toBe(false);
    expect(visibleSolarDiskFraction(wallDegrees, horizon.horizonDegrees)).toBeCloseTo(
      0.5,
      12,
    );
    expect(
      visibleSolarDiskFraction(wallDegrees - 0.05, horizon.horizonDegrees),
    ).toBeLessThan(0.5);
    expect(
      visibleSolarDiskFraction(wallDegrees + 0.05, horizon.horizonDegrees),
    ).toBeGreaterThan(0.5);
    expect(visibleSolarDiskFraction(wallDegrees - radius, horizon.horizonDegrees)).toBe(
      0,
    );
    expect(visibleSolarDiskFraction(wallDegrees + radius, horizon.horizonDegrees)).toBe(
      1,
    );
  });

  it('stops at the shading wall once the whole disk is hidden', () => {
    const sampler = southWall(1999, 2100, 300);
    const sunDegrees = wallAngleDegrees(300, 2000) - radius - 0.01;

    const horizon = horizonAngleTowardSun(sampler, observer, south, {
      baseResolutionMeters: 10,
      maximumElevationMeters: 1e9,
      apparentSunElevationDegrees: sunDegrees,
    });

    expect(horizon.reachedMeters).toBe(2000);
    expect(visibleSolarDiskFraction(sunDegrees, horizon.horizonDegrees)).toBe(0);
  });

  it('lets Earth curvature hide a distant ridge that would shade on a flat Earth', () => {
    const sunDegrees = 0.3;
    const flatEarthRidgeDegrees = Math.atan2(150, 50_000) * (180 / Math.PI);

    const horizon = horizonAngleTowardSun(
      southWall(50_000, 50_500, 150),
      observer,
      south,
      {
        baseResolutionMeters: 30,
        maximumElevationMeters: 1e9,
        apparentSunElevationDegrees: sunDegrees,
      },
    );

    expect(visibleSolarDiskFraction(sunDegrees, flatEarthRidgeDegrees)).toBeLessThan(
      0.9,
    );
    expect(horizon.horizonDegrees).toBeLessThan(0);
    expect(visibleSolarDiskFraction(sunDegrees, horizon.horizonDegrees)).toBe(1);
  });

  it('ignores a ridge behind the observer', () => {
    const sampler = southWall(1999, 2100, 300);
    const options = {
      baseResolutionMeters: 10,
      maximumElevationMeters: 300,
      apparentSunElevationDegrees: 5,
    };

    const towardRidge = horizonAngleTowardSun(sampler, observer, south, options);
    const awayFromRidge = horizonAngleTowardSun(sampler, observer, north, options);

    expect(visibleSolarDiskFraction(5, towardRidge.horizonDegrees)).toBe(0);
    expect(awayFromRidge.horizonDegrees).toBeLessThan(0);
    expect(visibleSolarDiskFraction(5, awayFromRidge.horizonDegrees)).toBe(1);
  });

  it('ends at the coverage limit without inventing terrain beyond it', () => {
    const sampler: TerrainElevationSampler = {
      elevationAt: (_latitude, _longitude, distanceMeters) =>
        distanceMeters > 5000 ? null : 0,
    };

    const horizon = horizonAngleTowardSun(sampler, observer, south, {
      baseResolutionMeters: 10,
      maximumElevationMeters: 9000,
      apparentSunElevationDegrees: 5,
    });

    expect(horizon.coverageLimited).toBe(true);
    expect(horizon.reachedMeters).toBe(5000);
    expect(horizon.horizonDegrees).toBeLessThan(0);
    expect(visibleSolarDiskFraction(5, horizon.horizonDegrees)).toBe(1);
  });

  it('caps the march at the maximum shadow distance', () => {
    const options = {
      baseResolutionMeters: 30,
      maximumElevationMeters: 2000,
      apparentSunElevationDegrees: 0.3,
    };

    const withinCap = horizonAngleTowardSun(
      southWall(95_000, 95_500, 2000),
      observer,
      south,
      options,
    );
    const beyondCap = horizonAngleTowardSun(
      southWall(100_500, 101_000, 2000),
      observer,
      south,
      options,
    );

    expect(visibleSolarDiskFraction(0.3, withinCap.horizonDegrees)).toBe(0);
    expect(beyondCap.coverageLimited).toBe(false);
    expect(beyondCap.reachedMeters).toBeLessThanOrEqual(
      terrainShadowModel.maximumShadowDistanceMeters,
    );
    expect(beyondCap.reachedMeters).toBeGreaterThan(99_000);
    expect(visibleSolarDiskFraction(0.3, beyondCap.horizonDegrees)).toBe(1);
  });

  it('exits early on the elevation bound without changing a partial shadow', () => {
    const sampler = southWall(1999, 2100, 300);
    const sunDegrees = wallAngleDegrees(300, 2000) + 0.1;
    const march = (maximumElevationMeters: number) =>
      horizonAngleTowardSun(sampler, observer, south, {
        baseResolutionMeters: 10,
        maximumElevationMeters,
        apparentSunElevationDegrees: sunDegrees,
      });

    const bounded = march(300);
    const unbounded = march(1e9);

    expect(bounded.reachedMeters).toBeLessThan(3000);
    expect(unbounded.reachedMeters).toBeGreaterThan(99_000);
    expect(bounded.horizonDegrees).toBe(unbounded.horizonDegrees);
    expect(
      visibleSolarDiskFraction(sunDegrees, bounded.horizonDegrees),
    ).toBeGreaterThan(0.5);
    expect(visibleSolarDiskFraction(sunDegrees, bounded.horizonDegrees)).toBeLessThan(
      1,
    );
  });

  it('keeps marching when the observer stands above every sample and the bound still dips', () => {
    // A summit observer above the reported maximum: the low-sun threshold first falls below
    // the bound, so the ridge at 30 km must still be found.
    const summit: TerrainObserver = { ...observer, elevationMeters: 1000 };
    const sampler: TerrainElevationSampler = {
      elevationAt(latitudeDegrees) {
        const southMeters =
          (summit.latitudeDegrees - latitudeDegrees) * metersPerDegree;
        return southMeters >= 30_000 && southMeters <= 30_500 ? 950 : 0;
      },
    };

    const horizon = horizonAngleTowardSun(sampler, summit, south, {
      baseResolutionMeters: 30,
      maximumElevationMeters: 950,
      apparentSunElevationDegrees: 0,
    });

    // Ridge at 30 km: atan((950 − 1000 − 61.5) / 30000) ≈ −0.21°; flat ground there is ≈ −2°.
    expect(horizon.horizonDegrees).toBeGreaterThan(-0.25);
  });
});

describe('evaluateTerrainSunlight', () => {
  const tbilisi: TerrainObserver = {
    latitudeDegrees: 41.7151,
    longitudeDegrees: 44.8271,
    elevationMeters: 0,
  };
  const options = { baseResolutionMeters: 30, maximumElevationMeters: 5000 };

  it('lights a flat plain fully at noon', () => {
    const result = evaluateTerrainSunlight(
      { elevationAt: () => 0 },
      tbilisi,
      new Date('2026-06-21T09:02:29Z'),
      options,
    );

    expect(result.sun.apparentElevationDegrees).toBeGreaterThan(70);
    expect(result.sunlitFraction).toBe(1);
    expect(result.coverageLimited).toBe(false);
  });

  it('returns full shade at night without sampling terrain', () => {
    let samples = 0;
    const sampler: TerrainElevationSampler = {
      elevationAt() {
        samples += 1;
        return 0;
      },
    };

    const result = evaluateTerrainSunlight(
      sampler,
      tbilisi,
      new Date('2026-06-21T22:00:00Z'),
      options,
    );

    expect(result.sunlitFraction).toBe(0);
    expect(samples).toBe(0);
  });
});
