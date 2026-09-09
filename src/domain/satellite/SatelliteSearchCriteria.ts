export type SatelliteProductLevel = 'L1C' | 'L2A';

export interface SatelliteSearchViewport {
  readonly bounds: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  };
  readonly center: {
    readonly longitude: number;
    readonly latitude: number;
  };
}
export type SatelliteViewportValidationIssue =
  'non-finite' | 'unsupported-boundary' | 'center-outside';

export function satelliteViewportValidationIssue(
  viewport: SatelliteSearchViewport,
): SatelliteViewportValidationIssue | null {
  const { west, south, east, north } = viewport.bounds;
  const { longitude, latitude } = viewport.center;
  if (
    [west, south, east, north, longitude, latitude].some(
      (value) => !Number.isFinite(value),
    )
  ) {
    return 'non-finite';
  }
  if (
    west < -180 ||
    east > 180 ||
    south < -85 ||
    north > 85 ||
    west >= east ||
    south >= north ||
    east - west >= 180
  ) {
    return 'unsupported-boundary';
  }
  if (longitude < west || longitude > east || latitude < south || latitude > north) {
    return 'center-outside';
  }
  return null;
}

export interface SatelliteSearchCriteriaInput {
  readonly viewport: SatelliteSearchViewport;
  readonly startDate: string;
  readonly endDate: string;
  readonly productLevel: SatelliteProductLevel;
  readonly maxCloudCoverPercent: number | null;
}

export interface SatelliteSearchCriteria extends SatelliteSearchCriteriaInput {
  readonly inclusiveDayCount: number;
}
