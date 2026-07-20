import maplibreContour from 'maplibre-contour';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  BrowserTerrariumPngCodec,
  type TerrariumPngCodec,
} from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
import { FilteredTerrariumTileProvider } from '@/infrastructure/elevation/FilteredTerrariumTileProvider';
import type { TerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';

type LocalDemManager = InstanceType<typeof maplibreContour.LocalDemManager>;
type FetchTileParameters = Parameters<LocalDemManager['fetchTile']>;
type FetchTileResult = ReturnType<LocalDemManager['fetchTile']>;
type FetchContourParameters = Parameters<LocalDemManager['fetchContourTile']>;
type FetchContourResult = ReturnType<LocalDemManager['fetchContourTile']>;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface TerrainComputeEngineOptions {
  readonly codec?: TerrariumPngCodec;
  readonly fetchImplementation?: FetchImplementation;
  readonly monotonicNow?: () => number;
}

/**
 * Owns the shared filtered-PNG, parsed DEM, and contour caches for one terrain runtime.
 * Both worker and inline backends use this same engine so recovery cannot fork the
 * filtering or contour algorithms.
 */
export class TerrainComputeEngine {
  readonly loaded: Promise<void>;
  readonly #manager: LocalDemManager;
  readonly #filteredTiles: FilteredTerrariumTileProvider | null;
  #filterEnabled = true;
  #disposed = false;

  public constructor(
    configuration: TerrainComputeConfiguration,
    logger: DiagnosticLogger,
    options: TerrainComputeEngineOptions = {},
  ) {
    this.#manager = new maplibreContour.LocalDemManager(
      configuration.tileUrl,
      configuration.contourCacheSize,
      configuration.encoding,
      configuration.maximumSourceZoom,
      configuration.requestTimeoutMs,
    );
    this.loaded = this.#manager.loaded;
    this.#filteredTiles =
      configuration.encoding === 'terrarium'
        ? new FilteredTerrariumTileProvider(
            configuration,
            logger,
            options.codec ?? new BrowserTerrariumPngCodec(),
            options.fetchImplementation ?? globalThis.fetch.bind(globalThis),
            options.monotonicNow ?? (() => performance.now()),
          )
        : null;
    if (this.#filteredTiles !== null) {
      const filteredTiles = this.#filteredTiles;
      this.#manager.fetchTile = (zoom, x, y, abortController) =>
        filteredTiles.getTile(zoom, x, y, abortController);
    }
  }

  public fetchTile(...parameters: FetchTileParameters): FetchTileResult {
    this.assertActive();
    return this.#manager.fetchTile(...parameters);
  }

  public fetchContourTile(...parameters: FetchContourParameters): FetchContourResult {
    this.assertActive();
    return this.#manager.fetchContourTile(...parameters);
  }

  /** Changes the filter revision and atomically invalidates every dependent cache. */
  public setFilterEnabled(enabled: boolean): void {
    this.assertActive();
    if (this.#filterEnabled === enabled) return;
    this.#filterEnabled = enabled;
    this.#filteredTiles?.setEnabled(enabled);
    this.clearCaches();
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#filteredTiles?.dispose();
    this.clearCaches();
  }

  private clearCaches(): void {
    this.#manager.tileCache.clear();
    this.#manager.parsedCache.clear();
    this.#manager.contourCache.clear();
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error('Terrain compute engine is disposed.');
  }
}
