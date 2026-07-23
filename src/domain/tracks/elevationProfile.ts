import type { TrackPoint } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';

export interface ElevationProfilePoint {
  readonly distanceMeters: number;
  readonly elevationMeters: number;
  readonly gradientPercent: number;
}

export interface TrackClimb {
  readonly startMeters: number;
  readonly endMeters: number;
  readonly distanceMeters: number;
  readonly gainMeters: number;
  readonly averageGradientPercent: number;
  readonly category: 'uncategorized' | '4' | '3' | '2' | '1' | 'hors-category';
}

export interface ElevationProfile {
  readonly points: readonly ElevationProfilePoint[];
  readonly ascentMeters: number;
  readonly descentMeters: number;
  readonly minimumMeters: number;
  readonly maximumMeters: number;
  readonly climbs: readonly TrackClimb[];
}

function climbCategory(
  distanceMeters: number,
  averageGradientPercent: number,
): TrackClimb['category'] {
  const score = distanceMeters * averageGradientPercent;
  if (score >= 80_000) return 'hors-category';
  if (score >= 64_000) return '1';
  if (score >= 32_000) return '2';
  if (score >= 16_000) return '3';
  if (score >= 8_000) return '4';
  return 'uncategorized';
}

export function calculateElevationProfile(
  segments: readonly (readonly TrackPoint[])[],
  thresholdMeters = 3,
): ElevationProfile | null {
  const profile: ElevationProfilePoint[] = [];
  let ascentMeters = 0;
  let descentMeters = 0;
  let totalDistance = 0;
  for (const segment of segments) {
    let previous: TrackPoint | undefined;
    let filteredElevation: number | undefined;
    for (const point of segment) {
      if (point.elevationMeters === undefined) {
        previous = undefined;
        filteredElevation = undefined;
        continue;
      }
      if (previous?.elevationMeters !== undefined) {
        totalDistance += geodesicDistanceMeters(previous.coordinate, point.coordinate);
      }
      const delta =
        filteredElevation === undefined ? 0 : point.elevationMeters - filteredElevation;
      const acceptedDelta = Math.abs(delta) >= thresholdMeters ? delta : 0;
      filteredElevation =
        filteredElevation === undefined
          ? point.elevationMeters
          : filteredElevation + acceptedDelta;
      if (acceptedDelta > 0) ascentMeters += acceptedDelta;
      if (acceptedDelta < 0) descentMeters += -acceptedDelta;
      const previousProfile = profile.at(-1);
      const profileDistance =
        previous === undefined && previousProfile !== undefined
          ? previousProfile.distanceMeters
          : totalDistance;
      const distanceDelta =
        previousProfile === undefined
          ? 0
          : profileDistance - previousProfile.distanceMeters;
      profile.push({
        distanceMeters: profileDistance,
        elevationMeters: filteredElevation,
        gradientPercent: distanceDelta <= 0 ? 0 : (acceptedDelta / distanceDelta) * 100,
      });
      previous = point;
    }
  }
  if (profile.length < 2) return null;
  const elevations = profile.map((point) => point.elevationMeters);
  const climbs: TrackClimb[] = [];
  let climbStart: number | null = null;
  for (let index = 1; index <= profile.length; index += 1) {
    const point = profile[index];
    if (point !== undefined && point.gradientPercent >= 3) {
      climbStart ??= index - 1;
      continue;
    }
    if (climbStart !== null) {
      const start = profile[climbStart];
      const end = profile[index - 1];
      if (start !== undefined && end !== undefined) {
        const distanceMeters = end.distanceMeters - start.distanceMeters;
        const gainMeters = end.elevationMeters - start.elevationMeters;
        if (distanceMeters >= 500 && gainMeters > 0) {
          const averageGradientPercent = (gainMeters / distanceMeters) * 100;
          climbs.push({
            startMeters: start.distanceMeters,
            endMeters: end.distanceMeters,
            distanceMeters,
            gainMeters,
            averageGradientPercent,
            category: climbCategory(distanceMeters, averageGradientPercent),
          });
        }
      }
      climbStart = null;
    }
  }
  return {
    points: profile,
    ascentMeters,
    descentMeters,
    minimumMeters: Math.min(...elevations),
    maximumMeters: Math.max(...elevations),
    climbs,
  };
}
