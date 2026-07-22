import type { SatelliteCatalogErrorCode } from '@/application/ports/SatelliteCatalogGateway';

type SatelliteSearchErrorCode =
  | SatelliteCatalogErrorCode
  | 'invalid-viewport'
  | 'invalid-date'
  | 'date-range-reversed'
  | 'date-range-too-large'
  | 'invalid-cloud-cover'
  | 'invalid-scene-geometry'
  | 'provider-capability';

/** A safe, user-actionable failure at the satellite application boundary. */
export class SatelliteSearchError extends Error {
  public constructor(
    public readonly code: SatelliteSearchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SatelliteSearchError';
  }
}
