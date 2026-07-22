import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';

type SatelliteInterestPointRelation = 'inside' | 'boundary' | 'outside';

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
