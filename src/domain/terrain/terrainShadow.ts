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
  /**
   * Higher of the marched terrain horizon and the sea-level horizon; only the latter when
   * the Sun is below it and the march was skipped.
   */
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

/**
 * Horizon angle of the sea-level sphere seen from `elevationMeters`, with the same
 * curvature-minus-refraction model as the march: −atan(2·√(h·c)), 0 at or below sea level.
 * No terrain lies below it, so the Sun is hidden there even beyond the march cap; from a
 * 5000 m summit it lies about 2.1° below the observer's level.
 */
export function seaLevelHorizonDegrees(elevationMeters: number): number {
  return (
    -Math.atan(2 * Math.sqrt(Math.max(elevationMeters, 0) * curvatureFactor)) *
    degreesPerRadian
  );
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

/** Sky-view pass constants shared by `skyViewFactor` and the GPU sky-view shader. */
export const terrainSkyViewModel = {
  /** Horizon directions per sky-view sample. */
  directions: 16,
  /** Terrain farther than this does not hide sky; deep valleys are a few kilometres wide. */
  maximumDistanceMeters: 20_000,
  /** Each march step grows by this fraction of the distance travelled. */
  stepFraction: 0.08,
  /** Terrain heights are exaggerated like the sky light's slopes. */
  reliefExaggeration: 1.5,
} as const;

/**
 * Share of a level surface's cosine-weighted sky that the surrounding terrain leaves open:
 * 1 on open ground and ridges, lower in valleys and gorges. CPU mirror of the sky-view
 * shader: each direction keeps its highest exaggerated terrain angle h, and the result
 * averages cos²(max(h, 0)). Missing DEM coverage ends a direction's march.
 */
export function skyViewFactor(
  sampler: TerrainElevationSampler,
  observer: TerrainObserver,
  options: TerrainMarchOptions,
): number {
  const { directions, maximumDistanceMeters, stepFraction, reliefExaggeration } =
    terrainSkyViewModel;
  const baseStep = options.baseResolutionMeters;
  const headroom = options.maximumElevationMeters - observer.elevationMeters;
  let openSky = 0;
  for (let direction = 0; direction < directions; direction += 1) {
    const azimuth = (360 * (direction + 0.5)) / directions;
    let slope = 0;
    for (
      let distance = baseStep;
      distance <= maximumDistanceMeters;
      distance += Math.max(baseStep, distance * stepFraction)
    ) {
      // Nothing farther can rise above the horizon found so far.
      if (
        (distance * slope) / reliefExaggeration + curvatureDropMeters(distance) >
        headroom
      ) {
        break;
      }
      const point = destinationPoint(
        observer.latitudeDegrees,
        observer.longitudeDegrees,
        azimuth,
        distance,
      );
      const elevation = sampler.elevationAt(
        point.latitudeDegrees,
        point.longitudeDegrees,
        distance,
      );
      if (elevation === null) break;
      const relativeHeight =
        elevation - observer.elevationMeters - curvatureDropMeters(distance);
      slope = Math.max(slope, (reliefExaggeration * relativeHeight) / distance);
    }
    openSky += 1 / (1 + slope * slope);
  }
  return openSky / directions;
}

/** Visible fraction of a uniform solar disk whose center is `apparentElevationDegrees` above a straight horizon edge. */
export function visibleSolarDiskFraction(
  apparentElevationDegrees: number,
  horizonDegrees: number,
): number {
  const radius = terrainShadowModel.solarDiskRadiusDegrees;
  const u = Math.min(
    1,
    Math.max(-1, (apparentElevationDegrees - horizonDegrees) / radius),
  );
  return 0.5 + (u * Math.sqrt(1 - u * u) + Math.asin(u)) / Math.PI;
}

/**
 * Sun position and terrain-cast sunlight at one ground point. The horizon is never below
 * the sea-level horizon, so summits stay lit while the Sun is just below the observer's
 * level; the march is skipped once the whole disk is below that horizon.
 */
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
  const seaLevelHorizon = seaLevelHorizonDegrees(observer.elevationMeters);
  if (
    sun.apparentElevationDegrees + terrainShadowModel.solarDiskRadiusDegrees <=
    seaLevelHorizon
  ) {
    return {
      sun,
      horizonDegrees: seaLevelHorizon,
      sunlitFraction: 0,
      coverageLimited: false,
    };
  }
  const horizon = horizonAngleTowardSun(sampler, observer, sun.azimuthDegrees, {
    baseResolutionMeters: options.baseResolutionMeters,
    maximumElevationMeters: options.maximumElevationMeters,
    apparentSunElevationDegrees: sun.apparentElevationDegrees,
  });
  const horizonDegrees = Math.max(horizon.horizonDegrees, seaLevelHorizon);
  return {
    sun,
    horizonDegrees,
    sunlitFraction: visibleSolarDiskFraction(
      sun.apparentElevationDegrees,
      horizonDegrees,
    ),
    coverageLimited: horizon.coverageLimited,
  };
}
