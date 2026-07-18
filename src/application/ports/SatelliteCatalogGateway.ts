import type { SatelliteSearchCriteria } from '@/domain/satellite/SatelliteSearchCriteria';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';

export interface SatelliteCatalogQuery {
  readonly criteria: SatelliteSearchCriteria;
  readonly maximumItems: number;
}

export interface SatelliteCatalogRequestContext {
  readonly operationId: string;
  readonly signal: AbortSignal;
}

export interface SatelliteCatalogResult {
  readonly scenes: readonly SatelliteScene[];
  readonly totalMatched: number;
}

/** Searches one configured Sentinel catalog without leaking STAC transport into use cases. */
export interface SatelliteCatalogGateway {
  search(
    query: SatelliteCatalogQuery,
    context: SatelliteCatalogRequestContext,
  ): Promise<SatelliteCatalogResult>;
}
