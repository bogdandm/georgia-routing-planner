export type PlaceSearchKind =
  'settlement' | 'administrative-area' | 'mountain' | 'water' | 'other';

export interface PlaceSearchResult {
  readonly id: string;
  readonly label: string;
  readonly coordinate: {
    readonly longitude: number;
    readonly latitude: number;
  };
  readonly category: string;
  /** Provider-independent grouping used for the map search's default relevance filter. */
  readonly kind: PlaceSearchKind;
  /** Non-node OSM results expose their provider-validated geographic extent. */
  readonly bounds: PlaceSearchBounds | null;
}

export interface PlaceSearchBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

type PlaceSearchFailureCode =
  'network' | 'timeout' | 'rate-limited' | 'invalid-response' | 'provider';

export class PlaceSearchFailure extends Error {
  public constructor(
    public readonly code: PlaceSearchFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlaceSearchFailure';
  }
}

/** Searches a replaceable geocoder without exposing its wire format. */
export interface PlaceSearchGateway {
  search(
    query: string,
    bounds: PlaceSearchBounds,
    signal: AbortSignal,
  ): Promise<readonly PlaceSearchResult[]>;
  reverse?(
    coordinate: { readonly longitude: number; readonly latitude: number },
    signal: AbortSignal,
  ): Promise<PlaceSearchResult | null>;
}
