import {
  solarDiskRadiusDegrees,
  solarPosition,
  type SolarPosition,
} from '@/domain/terrain/solarPosition';

/** Physical constants shared by this CPU reference and the GPU shadow shader. */
export const terrainShadowModel = {
  /** Mean Earth sphere. */
  earthRadiusMeters: 6_371_008.8,
  /** Terrestrial refraction coefficient k; lines of sight curve with radius R / k. */
  terrestrialRefractionCoefficient: 0.13,
  solarDiskRadiusDegrees,
  /** Hard march cap; farther terrain never casts a shadow (disclosed accuracy limit). */
  maximumShadowDistanceMeters: 100_000,
  /** March step grows as `distance * angularStepRadians`, never below the base step. */
  angularStepRadians: 0.0015,
} as const;

/**
 * Terrain heights in meters for the horizon march. `distanceMeters` from the observer lets
 * an implementation choose a DEM level of detail; `null` means no coverage and ends the
 * march as coverage-limited.
 */
export interface TerrainElevationSampler {
  elevationAt(
    latitudeDegrees: number,
    longitudeDegrees: number,
    distanceMeters: number,
  ): number | null;
}

export interface TerrainObserver {
  readonly latitudeDegrees: number;
  readonly longitudeDegrees: number;
  /** Ground elevation at the observer. */
  readonly elevationMeters: number;
}

export interface TerrainHorizon {
  /** Highest terrain angle toward the azimuth; −90 when nothing was sampled. */
  readonly horizonDegrees: number;
  /** Distance of the last sample taken (0 when none). */
  readonly reachedMeters: number;
  /** The sampler ran out of data before the march finished. */
  readonly coverageLimited: boolean;
}

export interface TerrainSunlight {
  readonly sun: SolarPosition;
  /** −90 when the march was skipped because the sun is below the horizon. */
  readonly horizonDegrees: number;
  /** Visible fraction of the solar disk in [0, 1]; shade alpha is `1 − sunlitFraction`. */
  readonly sunlitFraction: number;
  readonly coverageLimited: boolean;
}

export interface TerrainMarchOptions {
  /** Finest DEM ground pixel size at the observer; first sample distance and minimum step. */
  readonly baseResolutionMeters: number;
  /** Upper bound of every terrain height the sampler can return (enables early exit). */
  readonly maximumElevationMeters: number;
}

const radiansPerDegree = Math.PI / 180;
const degreesPerRadian = 180 / Math.PI;
const curvatureFactor =
  (1 - terrainShadowModel.terrestrialRefractionCoefficient) /
  (2 * terrainShadowModel.earthRadiusMeters);

/** Apparent drop of distant terrain below the observer's level from curvature minus refraction. */
export function curvatureDropMeters(distanceMeters: number): number {
  return distanceMeters * distanceMeters * curvatureFactor;
}

/** Exact great-circle destination on the model sphere; longitude normalized to [−180, 180). */
export function destinationPoint(
  latitudeDegrees: number,
  longitudeDegrees: number,
  azimuthDegrees: number,
  distanceMeters: number,
): { readonly latitudeDegrees: number; readonly longitudeDegrees: number } {
  const latitude = latitudeDegrees * radiansPerDegree;
  const azimuth = azimuthDegrees * radiansPerDegree;
  const angularDistance = distanceMeters / terrainShadowModel.earthRadiusMeters;
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinDistance = Math.sin(angularDistance);
  const cosDistance = Math.cos(angularDistance);

  const sinDestinationLatitude =
    sinLatitude * cosDistance + cosLatitude * sinDistance * Math.cos(azimuth);
  const destinationLatitude = Math.asin(
    Math.min(1, Math.max(-1, sinDestinationLatitude)),
  );
  const destinationLongitude =
    longitudeDegrees +
    Math.atan2(
      Math.sin(azimuth) * sinDistance * cosLatitude,
      cosDistance - sinLatitude * sinDestinationLatitude,
    ) *
      degreesPerRadian;

  return {
    latitudeDegrees: destinationLatitude * degreesPerRadian,
    longitudeDegrees: ((((destinationLongitude + 180) % 360) + 360) % 360) - 180,
  };
}

/**
 * Marches the great circle from the observer toward `azimuthDegrees` and returns the highest
 * curvature- and refraction-corrected terrain angle. Stops early once the disk is fully
 * hidden, or once no terrain up to `maximumElevationMeters` could rise above
 * max(horizon, sun − r); that bound is applied only where it grows with distance, so an
 * observer above every sample cannot miss a later horizon dip.
 */
export function horizonAngleTowardSun(
  sampler: TerrainElevationSampler,
  observer: TerrainObserver,
  azimuthDegrees: number,
  options: TerrainMarchOptions & { readonly apparentSunElevationDegrees: number },
): TerrainHorizon {
  const baseStep = options.baseResolutionMeters;
  if (!(Number.isFinite(baseStep) && baseStep > 0)) {
    throw new RangeError(
      `Base resolution must be a positive distance, got ${String(baseStep)}.`,
    );
  }
  const fullyHiddenDegrees =
    options.apparentSunElevationDegrees + terrainShadowModel.solarDiskRadiusDegrees;
  const firstHidingDegrees =
    options.apparentSunElevationDegrees - terrainShadowModel.solarDiskRadiusDegrees;
  const terrainHeadroomMeters =
    options.maximumElevationMeters - observer.elevationMeters;

  let horizonDegrees = -90;
  let reachedMeters = 0;
  let coverageLimited = false;

  for (
    let distance = baseStep;
    distance <= terrainShadowModel.maximumShadowDistanceMeters;
    distance += Math.max(baseStep, distance * terrainShadowModel.angularStepRadians)
  ) {
    const thresholdSlope = Math.tan(
      Math.max(horizonDegrees, firstHidingDegrees) * radiansPerDegree,
    );
    if (
      distance * thresholdSlope + curvatureDropMeters(distance) >
        terrainHeadroomMeters &&
      thresholdSlope + 2 * curvatureFactor * distance >= 0
    ) {
      break;
    }

    const point = destinationPoint(
      observer.latitudeDegrees,
      observer.longitudeDegrees,
      azimuthDegrees,
      distance,
    );
    const elevation = sampler.elevationAt(
      point.latitudeDegrees,
      point.longitudeDegrees,
      distance,
    );
    if (elevation === null) {
      coverageLimited = true;
      break;
    }
    reachedMeters = distance;
    const relativeHeight =
      elevation - observer.elevationMeters - curvatureDropMeters(distance);
    horizonDegrees = Math.max(
      horizonDegrees,
      Math.atan2(relativeHeight, distance) * degreesPerRadian,
    );
    if (horizonDegrees >= fullyHiddenDegrees) break;
  }

  return { horizonDegrees, reachedMeters, coverageLimited };
}

/** Visible fraction of a uniform solar disk whose center is `apparentElevationDegrees` above a straight horizon edge. */
export function visibleSolarDiskFraction(
  apparentElevationDegrees: number,
  horizonDegrees: number,
): number {
  const radius = terrainShadowModel.solarDiskRadiusDegrees;
  if (apparentElevationDegrees <= -radius) return 0;
  const u = Math.min(
    1,
    Math.max(-1, (apparentElevationDegrees - horizonDegrees) / radius),
  );
  return 0.5 + (u * Math.sqrt(1 - u * u) + Math.asin(u)) / Math.PI;
}

/** Sun position and terrain-cast sunlight at one ground point; skips the march at night. */
export function evaluateTerrainSunlight(
  sampler: TerrainElevationSampler,
  observer: TerrainObserver,
  instant: Date,
  options: TerrainMarchOptions,
): TerrainSunlight {
  const sun = solarPosition(
    instant,
    observer.latitudeDegrees,
    observer.longitudeDegrees,
  );
  if (sun.apparentElevationDegrees <= -terrainShadowModel.solarDiskRadiusDegrees) {
    return { sun, horizonDegrees: -90, sunlitFraction: 0, coverageLimited: false };
  }
  const horizon = horizonAngleTowardSun(sampler, observer, sun.azimuthDegrees, {
    baseResolutionMeters: options.baseResolutionMeters,
    maximumElevationMeters: options.maximumElevationMeters,
    apparentSunElevationDegrees: sun.apparentElevationDegrees,
  });
  return {
    sun,
    horizonDegrees: horizon.horizonDegrees,
    sunlitFraction: visibleSolarDiskFraction(
      sun.apparentElevationDegrees,
      horizon.horizonDegrees,
    ),
    coverageLimited: horizon.coverageLimited,
  };
}
