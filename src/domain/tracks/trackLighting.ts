import { solarDiskRadiusDegrees, solarPosition } from '@/domain/terrain/solarPosition';
import {
  destinationPoint,
  horizonAngleTowardSun,
  seaLevelHorizonDegrees,
  skyViewFactor,
  visibleSolarDiskFraction,
  type TerrainElevationSampler,
  type TerrainMarchOptions,
} from '@/domain/terrain/terrainShadow';
import type { TrackCoordinate } from '@/domain/tracks/gpx';

export const TRACK_LIGHTING_ALGORITHM_VERSION = 2;

export const trackLightingModel = {
  /** Sunlight is averaged over the ground within this distance of the route. */
  averagingRadiusMeters: 50,
  /**
   * The centre stands for the inner seventh of that disk; six observers on the centroid
   * radius of the remaining annulus stand for the rest, all weighted equally.
   */
  ringObserverCount: 6,
  ringRadiusMeters: 37,
  /**
   * End of civil twilight. Below it a hiker needs a headlamp; above it, after sunset,
   * is the blue hour. The map's sun shadows keep night artificially bright so relief
   * stays readable, so these classes follow the Sun's elevation, never that brightness.
   */
  twilightEndElevationDegrees: -6,
} as const;

/** Sun on the hiker, terrain shade under a risen Sun, the blue hour, and darkness. */
export const trackLightKinds = ['sun', 'shade', 'twilight', 'dark'] as const;
export type TrackLightKind = (typeof trackLightKinds)[number];

/** Lighting at one route station on the hike's timeline. */
export interface TrackLightingSample {
  readonly distanceMeters: number;
  /** Time after the route start at which the hiker passes the station. */
  readonly elapsedSeconds: number;
  /** Visible solar-disk fraction in [0, 1], averaged over the station's disk. */
  readonly sunlitFraction: number;
  /** Apparent elevation of the Sun's centre, refraction included. */
  readonly sunElevationDegrees: number;
  /**
   * Open share of the sky at the station, as the map's sky light uses it: 1 on open
   * ground, lower in valleys, so a gorge's shade is darker than a boulder's.
   */
  readonly skyView: number;
  /** DEM ground height at the station; thinner air above it whitens the sunlight. */
  readonly groundElevationMeters: number;
}

/**
 * Browser-derived lighting of a saved track for one route start; recomputed when the
 * content hash, algorithm version, start instant, or route timing changes.
 */
export interface TrackLightingRecord {
  readonly trackId: string;
  /** `LocalTrackSummary.contentHash` it was derived from; null for legacy rows without a hash. */
  readonly contentHash: string | null;
  readonly algorithmVersion: typeof TRACK_LIGHTING_ALGORITHM_VERSION;
  /** Route start instant the samples are timed from, in epoch milliseconds. */
  readonly startMs: number;
  readonly samples: readonly TrackLightingSample[];
}

type TerrainSampler = TerrainElevationSampler & TerrainMarchOptions;

/**
 * Light at one route position and instant with the terrain-shadow model shared by the
 * map's sun shadows: the visible solar-disk fraction above the marched terrain horizon,
 * averaged over the station's 50 m disk, and the station's open sky. Observers outside
 * DEM coverage are skipped; without any, the ground counts as open sea-level terrain.
 */
export function stationSunlight(
  sampler: TerrainSampler,
  coordinate: TrackCoordinate,
  instant: Date,
): Omit<TrackLightingSample, 'distanceMeters' | 'elapsedSeconds'> {
  const [longitude, latitude] = coordinate;
  const sun = solarPosition(instant, latitude, longitude);
  const observers = [{ latitudeDegrees: latitude, longitudeDegrees: longitude }];
  for (let index = 0; index < trackLightingModel.ringObserverCount; index += 1) {
    observers.push(
      destinationPoint(
        latitude,
        longitude,
        (360 * index) / trackLightingModel.ringObserverCount,
        trackLightingModel.ringRadiusMeters,
      ),
    );
  }
  let sunlit = 0;
  let observed = 0;
  for (const observer of observers) {
    const elevationMeters = sampler.elevationAt(
      observer.latitudeDegrees,
      observer.longitudeDegrees,
      0,
    );
    if (elevationMeters === null) continue;
    observed += 1;
    const seaLevelHorizon = seaLevelHorizonDegrees(elevationMeters);
    if (sun.apparentElevationDegrees + solarDiskRadiusDegrees <= seaLevelHorizon)
      continue;
    const horizon = horizonAngleTowardSun(
      sampler,
      { ...observer, elevationMeters },
      sun.azimuthDegrees,
      {
        baseResolutionMeters: sampler.baseResolutionMeters,
        maximumElevationMeters: sampler.maximumElevationMeters,
        apparentSunElevationDegrees: sun.apparentElevationDegrees,
      },
    );
    sunlit += visibleSolarDiskFraction(
      sun.apparentElevationDegrees,
      Math.max(horizon.horizonDegrees, seaLevelHorizon),
    );
  }
  const groundElevationMeters = sampler.elevationAt(latitude, longitude, 0);
  return {
    sunlitFraction:
      observed > 0
        ? sunlit / observed
        : visibleSolarDiskFraction(sun.apparentElevationDegrees, 0),
    sunElevationDegrees: sun.apparentElevationDegrees,
    skyView:
      groundElevationMeters === null
        ? 1
        : skyViewFactor(
            sampler,
            {
              latitudeDegrees: latitude,
              longitudeDegrees: longitude,
              elevationMeters: groundElevationMeters,
            },
            sampler,
          ),
    groundElevationMeters: groundElevationMeters ?? 0,
  };
}

/**
 * Shares of each light kind at a sample, summing to 1. Direct sunlight counts as sun even
 * on a summit that still sees the Sun after it set at the astronomical horizon; the rest
 * is shade while the upper limb is above that horizon, then the blue hour, then dark.
 */
export function trackLightShares(
  sample: Pick<TrackLightingSample, 'sunlitFraction' | 'sunElevationDegrees'>,
): Readonly<Record<TrackLightKind, number>> {
  const sun = sample.sunlitFraction;
  const unlit = 1 - sun;
  if (sample.sunElevationDegrees > -solarDiskRadiusDegrees) {
    return { sun, shade: unlit, twilight: 0, dark: 0 };
  }
  if (sample.sunElevationDegrees >= trackLightingModel.twilightEndElevationDegrees) {
    return { sun, shade: 0, twilight: unlit, dark: 0 };
  }
  return { sun, shade: 0, twilight: 0, dark: unlit };
}

/** Seconds of the hike spent in each light kind, interpolated linearly between samples. */
export function trackLightDurations(
  samples: readonly TrackLightingSample[],
): Readonly<Record<TrackLightKind, number>> {
  const seconds = { sun: 0, shade: 0, twilight: 0, dark: 0 };
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    if (before === undefined || after === undefined) continue;
    const span = after.elapsedSeconds - before.elapsedSeconds;
    if (span <= 0) continue;
    const beforeShares = trackLightShares(before);
    const afterShares = trackLightShares(after);
    for (const kind of trackLightKinds) {
      seconds[kind] += (span * (beforeShares[kind] + afterShares[kind])) / 2;
    }
  }
  return seconds;
}
