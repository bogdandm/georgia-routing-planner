export interface ElevationCoordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export type ElevationSample =
  | { readonly status: 'available'; readonly meters: number }
  | { readonly status: 'unavailable' };

export interface ElevationSamplingProgress {
  readonly completedTiles: number;
  readonly totalTiles: number;
  readonly indices: readonly number[];
  readonly samples: readonly ElevationSample[];
}

export type ElevationSamplingProgressListener = (
  progress: ElevationSamplingProgress,
) => void;

/** Samples bare-earth elevation without exposing provider or image-decoding details. */
export interface ElevationProvider {
  sample(
    coordinate: ElevationCoordinate,
    signal: AbortSignal,
  ): Promise<ElevationSample>;
  sampleMany(
    coordinates: readonly ElevationCoordinate[],
    signal: AbortSignal,
    onProgress?: ElevationSamplingProgressListener,
  ): Promise<readonly ElevationSample[]>;
}
