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

export type SatelliteCatalogErrorCode =
  | 'provider-timeout'
  | 'provider-rate-limited'
  | 'provider-network'
  | 'provider-http'
  | 'provider-invalid-response'
  | 'provider-pagination'
  | 'result-limit-exceeded';

/** Safe infrastructure failure contract returned by catalog gateway implementations. */
export class SatelliteCatalogError extends Error {
  public constructor(
    public readonly code: SatelliteCatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SatelliteCatalogError';
  }
}

/** Searches one configured Sentinel catalog without leaking STAC transport into use cases. */
export interface SatelliteCatalogGateway {
  search(
    query: SatelliteCatalogQuery,
    context: SatelliteCatalogRequestContext,
  ): Promise<SatelliteCatalogResult>;
}
