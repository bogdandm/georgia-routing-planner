import type { TrackCoordinate, TrackPoint } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';

export interface ElevationProfilePoint {
  readonly coordinate: TrackCoordinate;
  readonly distanceMeters: number;
  readonly elevationMeters: number;
}

export interface ElevationProfile {
  readonly points: readonly ElevationProfilePoint[];
  readonly minimumMeters: number;
  readonly maximumMeters: number;
}

export function calculateElevationProfile(
  segments: readonly (readonly TrackPoint[])[],
): ElevationProfile | null {
  const profile: ElevationProfilePoint[] = [];
  let totalDistance = 0;
  for (const segment of segments) {
    let previous: TrackPoint | undefined;
    for (const point of segment) {
      if (point.elevationMeters === undefined) {
        previous = undefined;
        continue;
      }
      if (previous?.elevationMeters !== undefined) {
        totalDistance += geodesicDistanceMeters(previous.coordinate, point.coordinate);
      }
      const previousProfile = profile.at(-1);
      const profileDistance =
        previous === undefined && previousProfile !== undefined
          ? previousProfile.distanceMeters
          : totalDistance;
      profile.push({
        coordinate: point.coordinate,
        distanceMeters: profileDistance,
        elevationMeters: point.elevationMeters,
      });
      previous = point;
    }
  }
  if (profile.length < 2) return null;
  const elevations = profile.map((point) => point.elevationMeters);
  return {
    points: profile,
    minimumMeters: Math.min(...elevations),
    maximumMeters: Math.max(...elevations),
  };
}
