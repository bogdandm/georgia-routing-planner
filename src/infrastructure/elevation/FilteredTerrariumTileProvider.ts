import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  BrowserTerrariumPngCodec,
  type TerrariumPngCodec,
} from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
import {
  filterTerrariumTile,
  type DecodedTerrariumTile,
  type TerrariumTileGrid,
} from '@/infrastructure/elevation/TerrariumDemFilter';

interface SourceTile {
  readonly blob: Blob;
  readonly cacheControl: string | null;
  readonly expires: string | null;
}

interface LoadedTile extends SourceTile {
  readonly decoded: DecodedTerrariumTile;
}

export interface FilteredTerrariumResponse {
  readonly data: Blob;
  readonly cacheControl?: string;
  readonly expires?: string;
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Fetches a 3x3 tile neighborhood, repairs only rejected center pixels, and retains a
 * bounded LRU of completed PNGs. Coordinates and URLs never cross the diagnostics port.
 */
export class FilteredTerrariumTileProvider {
  readonly #cache = new Map<string, FilteredTerrariumResponse>();
  readonly #decodedTileCache = new Map<string, LoadedTile>();
  #enabled = true;
  #revision = 0;

  public constructor(
    private readonly terrain: MapProviderConfiguration['terrain'],
    private readonly requestTimeoutMs: number,
    private readonly logger: DiagnosticLogger,
    private readonly codec: TerrariumPngCodec = new BrowserTerrariumPngCodec(),
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(
      globalThis,
    ),
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {}

  /** Changes processing mode and invalidates all mode-dependent tile results. */
  public setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.#revision += 1;
    this.#cache.clear();
    this.#decodedTileCache.clear();
  }

  public async getTile(
    zoom: number,
    x: number,
    y: number,
    parentAbortController: AbortController,
  ): Promise<FilteredTerrariumResponse> {
    const revision = this.#revision;
    const filterEnabled = this.#enabled;
    const key = `${String(revision)}/${String(zoom)}/${String(x)}/${String(y)}`;
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return cached;
    }

    const startedAt = this.monotonicNow();
    const controller = new AbortController();
    const handleAbort = () => {
      controller.abort(parentAbortController.signal.reason);
    };
    parentAbortController.signal.addEventListener('abort', handleAbort, { once: true });
    const timeout = setTimeout(() => {
      controller.abort(
        new DOMException('Terrarium tile request timed out.', 'TimeoutError'),
      );
    }, this.requestTimeoutMs);

    try {
      if (parentAbortController.signal.aborted) handleAbort();
      if (!filterEnabled) {
        const sourceTile = await this.fetchSourceTile(zoom, x, y, controller.signal);
        const response: FilteredTerrariumResponse = {
          data: sourceTile.blob,
          ...(sourceTile.cacheControl === null
            ? {}
            : { cacheControl: sourceTile.cacheControl }),
          ...(sourceTile.expires === null ? {} : { expires: sourceTile.expires }),
        };
        if (revision === this.#revision) this.putCache(key, response);
        return response;
      }
      const loaded = await this.loadNeighborhood(zoom, x, y, controller.signal);
      const center = loaded[1][1];
      const decodedGrid: TerrariumTileGrid = [
        [
          loaded[0][0]?.decoded ?? null,
          loaded[0][1]?.decoded ?? null,
          loaded[0][2]?.decoded ?? null,
        ],
        [loaded[1][0]?.decoded ?? null, center.decoded, loaded[1][2]?.decoded ?? null],
        [
          loaded[2][0]?.decoded ?? null,
          loaded[2][1]?.decoded ?? null,
          loaded[2][2]?.decoded ?? null,
        ],
      ];
      const filtered = filterTerrariumTile(decodedGrid, this.terrain.filter);
      const data =
        filtered.counts.repairedCount === 0
          ? center.blob
          : await this.codec.encode(filtered.tile, controller.signal);
      const response: FilteredTerrariumResponse = {
        data,
        ...(center.cacheControl === null ? {} : { cacheControl: center.cacheControl }),
        ...(center.expires === null ? {} : { expires: center.expires }),
      };
      if (revision === this.#revision) this.putCache(key, response);
      this.logger.log({
        level: filtered.counts.unrepairedCount === 0 ? 'debug' : 'warn',
        name: 'map.dem.tile-filtered',
        data: {
          durationMs: Math.round(this.monotonicNow() - startedAt),
          noDataCount: filtered.counts.noDataCount,
          sentinelCount: filtered.counts.sentinelCount,
          impossibleCount: filtered.counts.impossibleCount,
          spikeCount: filtered.counts.spikeCount,
          repairedCount: filtered.counts.repairedCount,
          unrepairedCount: filtered.counts.unrepairedCount,
          status: filtered.counts.unrepairedCount === 0 ? 'success' : 'partial',
        },
      });
      return response;
    } catch (error) {
      const timedOut =
        controller.signal.reason instanceof DOMException &&
        controller.signal.reason.name === 'TimeoutError';
      const canceled =
        !timedOut && (isAbortError(error) || parentAbortController.signal.aborted);
      this.logger.log({
        level: canceled ? 'debug' : 'warn',
        name: timedOut
          ? 'map.dem.tile-timeout'
          : canceled
            ? 'map.dem.tile-canceled'
            : 'map.dem.tile-filter-failed',
        data: {
          durationMs: Math.round(this.monotonicNow() - startedAt),
          status: timedOut ? 'timed-out' : canceled ? 'canceled' : 'failed',
        },
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      parentAbortController.signal.removeEventListener('abort', handleAbort);
    }
  }

  private async loadNeighborhood(
    zoom: number,
    x: number,
    y: number,
    signal: AbortSignal,
  ): Promise<
    readonly [
      readonly [LoadedTile | null, LoadedTile | null, LoadedTile | null],
      readonly [LoadedTile | null, LoadedTile, LoadedTile | null],
      readonly [LoadedTile | null, LoadedTile | null, LoadedTile | null],
    ]
  > {
    const tileCount = 2 ** zoom;
    const requests: Promise<LoadedTile | null>[] = [];
    for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
      for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
        const neighborY = y + deltaY;
        requests.push(
          neighborY < 0 || neighborY >= tileCount
            ? Promise.resolve(null)
            : this.loadTile(
                zoom,
                (x + deltaX + tileCount) % tileCount,
                neighborY,
                signal,
              ),
        );
      }
    }
    const loaded = await Promise.all(requests);
    const north = loaded.slice(0, 3);
    const center = loaded.slice(3, 6);
    const south = loaded.slice(6, 9);
    if (center[1] === undefined || center[1] === null) {
      throw new Error('Terrarium tile neighborhood is incomplete.');
    }
    return [
      [north[0] ?? null, north[1] ?? null, north[2] ?? null],
      [center[0] ?? null, center[1], center[2] ?? null],
      [south[0] ?? null, south[1] ?? null, south[2] ?? null],
    ];
  }

  private async loadTile(
    zoom: number,
    x: number,
    y: number,
    signal: AbortSignal,
  ): Promise<LoadedTile> {
    const key = `${String(zoom)}/${String(x)}/${String(y)}`;
    const cached = this.#decodedTileCache.get(key);
    if (cached !== undefined) {
      this.#decodedTileCache.delete(key);
      this.#decodedTileCache.set(key, cached);
      return cached;
    }
    const sourceTile = await this.fetchSourceTile(zoom, x, y, signal);
    const loaded = {
      ...sourceTile,
      decoded: await this.codec.decode(sourceTile.blob, signal),
    };
    this.#decodedTileCache.set(key, loaded);
    this.trimCache(this.#decodedTileCache);
    return loaded;
  }

  private async fetchSourceTile(
    zoom: number,
    x: number,
    y: number,
    signal: AbortSignal,
  ): Promise<SourceTile> {
    const url = this.terrain.tileUrl
      .replace('{z}', String(zoom))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    const response = await this.fetchImplementation(url, { signal });
    if (!response.ok)
      throw new Error(`Terrarium provider returned HTTP ${String(response.status)}.`);
    const blob = await response.blob();
    return {
      blob,
      cacheControl: response.headers.get('cache-control'),
      expires: response.headers.get('expires'),
    };
  }

  private putCache(key: string, value: FilteredTerrariumResponse): void {
    this.#cache.set(key, value);
    this.trimCache(this.#cache);
  }

  private trimCache<T>(cache: Map<string, T>): void {
    while (cache.size > this.terrain.filter.cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) return;
      cache.delete(oldest);
    }
  }
}
