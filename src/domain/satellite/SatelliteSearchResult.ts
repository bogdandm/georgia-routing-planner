import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';

export type SatelliteInterestPointRelation = 'inside' | 'boundary' | 'outside';

export interface SatelliteSceneCoverage {
  readonly viewportCoveragePercent: number;
  readonly interestPointRelation: SatelliteInterestPointRelation;
  readonly distanceToSceneEdgeKm: number;
  readonly hasEdgeWarning: boolean;
}

export interface SatelliteSceneMatch {
  readonly scene: SatelliteScene;
  readonly coverage: SatelliteSceneCoverage;
}

export interface SatelliteAcquisitionGroup {
  readonly date: string;
  readonly scenes: readonly SatelliteSceneMatch[];
}

export interface SatelliteSearchResult {
  readonly groups: readonly SatelliteAcquisitionGroup[];
  readonly sceneCount: number;
  readonly acquisitionDateCount: number;
  readonly totalMatched: number;
}

export interface SatelliteAvailabilityDate {
  readonly date: string;
  readonly sceneCount: number;
  readonly cloudSummaryPercent: number;
}

export interface SatelliteAvailabilityResult {
  readonly month: string;
  readonly dates: readonly SatelliteAvailabilityDate[];
  readonly totalMatched: number;
}
