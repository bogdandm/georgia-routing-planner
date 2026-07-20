export interface ElevationCoordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export type ElevationSample =
  | { readonly status: 'available'; readonly meters: number }
  | { readonly status: 'unavailable' };

/** Samples bare-earth elevation without exposing provider or image-decoding details. */
export interface ElevationProvider {
  sample(
    coordinate: ElevationCoordinate,
    signal: AbortSignal,
  ): Promise<ElevationSample>;
}
