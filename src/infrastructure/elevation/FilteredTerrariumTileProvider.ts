import type {
  DiagnosticLevel,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import {
  BrowserTerrariumPngCodec,
  type TerrariumPngCodec,
} from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
import {
  filterTerrariumTile,
  type DecodedTerrariumTile,
  type TerrariumRepairCounts,
  type TerrariumTileGrid,
} from '@/infrastructure/elevation/TerrariumDemFilter';
import type { TerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';

interface SourceTile {
  readonly blob: Blob;
  readonly cacheControl: string | null;
  readonly expires: string | null;
}

interface LoadedTile extends SourceTile {
  readonly decoded: DecodedTerrariumTile;
}

interface SharedLoadedTileRequest {
  readonly controller: AbortController;
  readonly promise: Promise<LoadedTile>;
  consumers: number;
}

type DemProcessingStatus =
  'success' | 'partial' | 'disabled' | 'canceled' | 'timed-out' | 'failed';

interface DemDiagnosticAggregate {
  count: number;
  durationMs: number;
  noDataCount: number;
  sentinelCount: number;
  impossibleCount: number;
  spikeCount: number;
  repairedCount: number;
  unrepairedCount: number;
  status: DemProcessingStatus;
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

const emptyRepairCounts: TerrariumRepairCounts = {
  noDataCount: 0,
  sentinelCount: 0,
  impossibleCount: 0,
  spikeCount: 0,
  repairedCount: 0,
  unrepairedCount: 0,
};

const diagnosticBatchSize = 32;
const diagnosticIntervalMs = 5_000;
const diagnosticStatusPriority: Readonly<Record<DemProcessingStatus, number>> = {
  disabled: 0,
  success: 1,
  canceled: 2,
  partial: 3,
  'timed-out': 4,
  failed: 5,
};

/**
 * Fetches a 3x3 tile neighborhood, repairs only rejected center pixels, and retains a
 * bounded LRU of completed PNGs. Coordinates and URLs never cross the diagnostics port.
 */
export class FilteredTerrariumTileProvider {
  readonly #cache = new Map<string, FilteredTerrariumResponse>();
  readonly #decodedTileCache = new Map<string, LoadedTile>();
  readonly #decodedTileRequests = new Map<string, SharedLoadedTileRequest>();
  readonly #tileRequests = new Set<AbortController>();
  #enabled = true;
  #revision = 0;
  #disposed = false;
  #diagnosticAggregate: DemDiagnosticAggregate | null = null;
  #lastDiagnosticAt: number | null = null;

  public constructor(
    private readonly configuration: TerrainComputeConfiguration,
    private readonly logger: DiagnosticLogger,
    private readonly codec: TerrariumPngCodec = new BrowserTerrariumPngCodec(),
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(
      globalThis,
    ),
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {}

  /** Changes processing mode and invalidates all mode-dependent tile results. */
  public setEnabled(enabled: boolean): void {
    this.assertActive();
    if (this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.#revision += 1;
    this.#cache.clear();
    this.#decodedTileCache.clear();
    for (const controller of this.#tileRequests) {
      controller.abort(new DOMException('DEM filter mode changed.', 'AbortError'));
    }
    for (const request of this.#decodedTileRequests.values()) {
      request.controller.abort(
        new DOMException('DEM filter mode changed.', 'AbortError'),
      );
    }
    this.#decodedTileRequests.clear();
  }

  public async getTile(
    zoom: number,
    x: number,
    y: number,
    parentAbortController: AbortController,
  ): Promise<FilteredTerrariumResponse> {
    this.assertActive();
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
    this.#tileRequests.add(controller);
    const handleAbort = () => {
      controller.abort(parentAbortController.signal.reason);
    };
    parentAbortController.signal.addEventListener('abort', handleAbort, { once: true });
    const timeout = setTimeout(() => {
      controller.abort(
        new DOMException('Terrarium tile request timed out.', 'TimeoutError'),
      );
    }, this.configuration.requestTimeoutMs);

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
        this.recordDiagnostic(
          'disabled',
          this.monotonicNow() - startedAt,
          emptyRepairCounts,
        );
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
      const filtered = filterTerrariumTile(decodedGrid, this.configuration.filter);
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
      this.recordDiagnostic(
        filtered.counts.unrepairedCount === 0 ? 'success' : 'partial',
        this.monotonicNow() - startedAt,
        filtered.counts,
      );
      return response;
    } catch (error) {
      const timedOut =
        controller.signal.reason instanceof DOMException &&
        controller.signal.reason.name === 'TimeoutError';
      const canceled =
        !timedOut && (isAbortError(error) || parentAbortController.signal.aborted);
      this.recordDiagnostic(
        timedOut ? 'timed-out' : canceled ? 'canceled' : 'failed',
        this.monotonicNow() - startedAt,
        emptyRepairCounts,
      );
      throw error;
    } finally {
      this.#tileRequests.delete(controller);
      clearTimeout(timeout);
      parentAbortController.signal.removeEventListener('abort', handleAbort);
    }
  }

  /** Cancels all work and clears bounded state owned by this provider. */
  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const controller of this.#tileRequests) {
      controller.abort(new DOMException('Terrain compute disposed.', 'AbortError'));
    }
    for (const request of this.#decodedTileRequests.values()) {
      request.controller.abort(
        new DOMException('Terrain compute disposed.', 'AbortError'),
      );
    }
    this.#tileRequests.clear();
    this.#decodedTileRequests.clear();
    this.#cache.clear();
    this.#decodedTileCache.clear();
    this.flushDiagnostics();
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
    let request = this.#decodedTileRequests.get(key);
    if (request === undefined) {
      const controller = new AbortController();
      const promise = this.fetchSourceTile(zoom, x, y, controller.signal).then(
        async (sourceTile) => {
          const loaded = {
            ...sourceTile,
            decoded: await this.codec.decode(sourceTile.blob, controller.signal),
          };
          this.#decodedTileCache.set(key, loaded);
          this.trimCache(this.#decodedTileCache);
          return loaded;
        },
      );
      request = { controller, promise, consumers: 0 };
      this.#decodedTileRequests.set(key, request);
      void promise
        .finally(() => {
          if (this.#decodedTileRequests.get(key) === request) {
            this.#decodedTileRequests.delete(key);
          }
        })
        .catch(() => undefined);
    }
    return this.waitForSharedTile(key, request, signal);
  }

  private waitForSharedTile(
    key: string,
    request: SharedLoadedTileRequest,
    signal: AbortSignal,
  ): Promise<LoadedTile> {
    request.consumers += 1;
    return new Promise((resolve, reject) => {
      let active = true;
      const release = () => {
        if (!active) return;
        active = false;
        signal.removeEventListener('abort', handleAbort);
        request.consumers -= 1;
        if (request.consumers === 0 && this.#decodedTileRequests.get(key) === request) {
          this.#decodedTileRequests.delete(key);
          request.controller.abort(
            new DOMException('Terrarium tile request canceled.', 'AbortError'),
          );
        }
      };
      const handleAbort = () => {
        release();
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('Terrarium tile request canceled.', 'AbortError'),
        );
      };
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener('abort', handleAbort, { once: true });
      void request.promise.then(
        (tile) => {
          if (!active) return;
          release();
          resolve(tile);
        },
        (error: unknown) => {
          if (!active) return;
          release();
          reject(
            error instanceof Error ? error : new Error('DEM tile request failed.'),
          );
        },
      );
    });
  }

  private async fetchSourceTile(
    zoom: number,
    x: number,
    y: number,
    signal: AbortSignal,
  ): Promise<SourceTile> {
    const url = this.configuration.tileUrl
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
    while (cache.size > this.configuration.filter.cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) return;
      cache.delete(oldest);
    }
  }

  private recordDiagnostic(
    status: DemProcessingStatus,
    durationMs: number,
    counts: TerrariumRepairCounts,
  ): void {
    const aggregate = this.#diagnosticAggregate ?? {
      ...emptyRepairCounts,
      count: 0,
      durationMs: 0,
      status,
    };
    if (diagnosticStatusPriority[status] > diagnosticStatusPriority[aggregate.status]) {
      aggregate.status = status;
    }
    aggregate.count += 1;
    aggregate.durationMs += durationMs;
    aggregate.noDataCount += counts.noDataCount;
    aggregate.sentinelCount += counts.sentinelCount;
    aggregate.impossibleCount += counts.impossibleCount;
    aggregate.spikeCount += counts.spikeCount;
    aggregate.repairedCount += counts.repairedCount;
    aggregate.unrepairedCount += counts.unrepairedCount;
    this.#diagnosticAggregate = aggregate;
    const now = this.monotonicNow();
    if (
      this.#lastDiagnosticAt === null ||
      aggregate.count >= diagnosticBatchSize ||
      now - this.#lastDiagnosticAt >= diagnosticIntervalMs
    ) {
      this.flushDiagnostics();
    }
  }

  private flushDiagnostics(): void {
    const aggregate = this.#diagnosticAggregate;
    if (aggregate === null) return;
    const level: DiagnosticLevel =
      aggregate.status === 'failed' ||
      aggregate.status === 'timed-out' ||
      aggregate.status === 'partial'
        ? 'warn'
        : 'debug';
    this.logger.log({
      level,
      name: 'map.dem.tiles-processed',
      data: {
        count: aggregate.count,
        durationMs: Math.round(aggregate.durationMs),
        noDataCount: aggregate.noDataCount,
        sentinelCount: aggregate.sentinelCount,
        impossibleCount: aggregate.impossibleCount,
        spikeCount: aggregate.spikeCount,
        repairedCount: aggregate.repairedCount,
        unrepairedCount: aggregate.unrepairedCount,
        status: aggregate.status,
      },
    });
    this.#diagnosticAggregate = null;
    this.#lastDiagnosticAt = this.monotonicNow();
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error('Filtered Terrarium provider is disposed.');
  }
}
