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

export interface SatelliteSearchCriteriaInput {
  readonly viewport: SatelliteSearchViewport;
  readonly startDate: string;
  readonly endDate: string;
  readonly productLevel: SatelliteProductLevel;
  readonly maxCloudCoverPercent: number;
}

export interface SatelliteSearchCriteria extends SatelliteSearchCriteriaInput {
  readonly inclusiveDayCount: number;
}
