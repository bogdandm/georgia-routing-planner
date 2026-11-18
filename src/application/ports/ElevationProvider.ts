import type {
  TerrainElevationSampler,
  TerrainMarchOptions,
} from '@/domain/terrain/terrainShadow';

export interface ElevationCoordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export type ElevationSample =
  | { readonly status: 'available'; readonly meters: number }
  | { readonly status: 'unavailable' };

/**
 * Reports newly resolved samples. A sample resolves once all source data it depends
 * on has loaded; the first event reports zero completed samples.
 */
export interface ElevationSamplingProgress {
  readonly completedSamples: number;
  readonly totalSamples: number;
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

/** Loaded DEM heights for synchronous horizon marches, with their march options. */
export interface LoadedTerrainSampler
  extends TerrainElevationSampler, TerrainMarchOptions {}

/** Loads raster DEM around route coordinates for the CPU sunlight march. */
export interface TerrainSamplerSource {
  /**
   * Loads every DEM tile within the terrain-shadow reach of `coordinates`: full detail
   * near them and coarser levels farther away, like the map's sun shadows. Rejects when
   * a tile fails, since missing far terrain would silently read as sunlight.
   */
  loadTerrainSampler(
    coordinates: readonly ElevationCoordinate[],
    signal: AbortSignal,
  ): Promise<LoadedTerrainSampler>;
}
