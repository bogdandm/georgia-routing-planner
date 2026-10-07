import maplibreContour from 'maplibre-contour';

import type { TerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';

type LocalDemManager = InstanceType<typeof maplibreContour.LocalDemManager>;
type FetchContourParameters = Parameters<LocalDemManager['fetchContourTile']>;
type FetchContourResult = ReturnType<LocalDemManager['fetchContourTile']>;

/**
 * Owns the raw DEM, parsed DEM, and contour caches for one terrain runtime. Both worker
 * and inline backends use this same engine so recovery cannot fork the contour algorithm.
 * The library fetches provider tiles directly and decodes WebP or PNG with
 * createImageBitmap.
 */
export class TerrainComputeEngine {
  readonly loaded: Promise<void>;
  readonly #manager: LocalDemManager;
  #disposed = false;

  public constructor(configuration: TerrainComputeConfiguration) {
    this.#manager = new maplibreContour.LocalDemManager(
      configuration.tileUrl,
      configuration.contourCacheSize,
      configuration.encoding,
      configuration.maximumSourceZoom,
      configuration.requestTimeoutMs,
    );
    this.loaded = this.#manager.loaded;
  }

  public fetchContourTile(...parameters: FetchContourParameters): FetchContourResult {
    if (this.#disposed) throw new Error('Terrain compute engine is disposed.');
    return this.#manager.fetchContourTile(...parameters);
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#manager.tileCache.clear();
    this.#manager.parsedCache.clear();
    this.#manager.contourCache.clear();
  }
}
