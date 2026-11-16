import { addProtocol, removeProtocol, type AddProtocolAction } from 'maplibre-gl';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  type WorkerRpcEndpoint,
  WorkerRpcClient,
  WorkerRpcRemoteError,
  WorkerRpcTransportError,
} from '@/infrastructure/runtime/WorkerRpc';
import {
  isTerrainShadowTileMetrics,
  isTerrainShadowTileResult,
  type TerrainShadowTileMetrics,
  type TerrainShadowTileRequest,
  terrainShadowUnavailableErrorCode,
} from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import { terrainShadowWorkerMethods } from '@/infrastructure/terrainShadow/TerrainShadowWorkerServer';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';

export type TerrainShadowAvailability = 'unknown' | 'available' | 'unavailable';

export interface TerrainShadowMetricsSnapshot {
  /** Tiles computed on the GPU (worker cache misses). */
  readonly tilesRendered: number;
  readonly tilesFromCache: number;
  readonly tilesFailed: number;
  /** Requests waiting for the interaction gate or the worker. */
  readonly pendingTiles: number;
  readonly totalComputeMs: number;
  readonly maxComputeMs: number;
  readonly totalDemFetchMs: number;
  readonly demTilesFetched: number;
  /** Latest worker memory estimate (GPU textures plus cached shade masks); kept across `resetMetrics`. */
  readonly memoryBytes: number;
}

export interface TerrainShadowTileAddress {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface TerrainShadowPrefetchProgress {
  /** Completed tile requests out of `total` (tiles × instants). */
  readonly completed: number;
  readonly total: number;
  /** Leading instants whose tiles are all cached, so playback may show them. */
  readonly readyFrames: number;
}

export interface TerrainShadowTileProvider {
  /** Raster tile template for one sun instant, quantized to whole minutes. */
  createTileUrl(instantMs: number): string;
  /** While true, queued tile requests wait (map drag/zoom/rotate in progress). */
  setInteractionActive(active: boolean): void;
  /**
   * Renders and caches every tile for every instant without handing tiles to MapLibre; at
   * most `terrainShadowPrefetchConcurrency` requests in flight. Instants are taken in the
   * given order in blocks of `terrainShadowPrefetchBlockFrames`, tile-major inside each
   * block, so leading frames become ready first. Rejects with an AbortError on `signal`, or
   * with the first tile failure.
   */
  prefetch(
    tiles: readonly TerrainShadowTileAddress[],
    instantsMs: readonly number[],
    signal: AbortSignal,
    onProgress: (progress: TerrainShadowPrefetchProgress) => void,
  ): Promise<void>;
  getAvailability(): TerrainShadowAvailability;
  subscribeAvailability(
    listener: (value: TerrainShadowAvailability) => void,
  ): () => void;
  getMetrics(): TerrainShadowMetricsSnapshot;
  resetMetrics(): void;
  dispose(): void;
}

export const terrainShadowProtocolId = 'terrain-shadow';
/** Prefetch keeps the single GPU queue fed while the next DEM tiles download. */
const terrainShadowPrefetchConcurrency = 4;
/**
 * Consecutive instants a prefetch block computes per tile. Larger blocks reuse a tile's
 * mosaics and DEM tiles longer; smaller ones make the first frames ready sooner.
 */
export const terrainShadowPrefetchBlockFrames = 6;

type TerrainShadowWorkerFactory = () => WorkerRpcEndpoint;

interface ParsedTileAddress extends TerrainShadowTileAddress {
  readonly epochMinute: number;
}

interface GateWaiter {
  readonly release: () => void;
  readonly reject: (error: Error) => void;
}

/** Accumulated counters; `pendingTiles` is live state added by `getMetrics`. */
type MutableMetrics = {
  -readonly [
    Key in Exclude<keyof TerrainShadowMetricsSnapshot, 'pendingTiles'>
  ]: TerrainShadowMetricsSnapshot[Key];
};

const millisecondsPerMinute = 60_000;
const tileAddressPattern = new RegExp(
  `^${terrainShadowProtocolId}://(-?\\d+)/(\\d+)/(\\d+)/(\\d+)$`,
  'u',
);

/** Channels 0–255 of an opaque `#RRGGBB` sun-shadow or sun-sky palette color. */
export function parseShadowColor(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error('The sun shadow palette color must be #RRGGBB.');
  }
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ];
}

const shadowColor = parseShadowColor(mapVisualPalette.terrain.sunShadow);
const highlightColor = parseShadowColor(mapVisualPalette.terrain.sunHighlight);
const lowSunShadowColor = parseShadowColor(mapVisualPalette.terrain.sunLowShadow);

function defaultWorkerFactory(): WorkerRpcEndpoint {
  return new Worker(
    new URL(
      '../../infrastructure/terrainShadow/terrainShadow.worker.ts',
      import.meta.url,
    ),
    { type: 'module', name: 'terrain-shadow-renderer' },
  );
}

function parseTileAddress(url: string): ParsedTileAddress | null {
  const match = tileAddressPattern.exec(url);
  if (match === null) return null;
  const [epochMinute, z, x, y] = match.slice(1).map(Number);
  if (
    epochMinute === undefined ||
    z === undefined ||
    x === undefined ||
    y === undefined ||
    !Number.isSafeInteger(epochMinute)
  ) {
    return null;
  }
  return { epochMinute, z, x, y };
}

function emptyMetrics(memoryBytes: number): MutableMetrics {
  return {
    tilesRendered: 0,
    tilesFromCache: 0,
    tilesFailed: 0,
    totalComputeMs: 0,
    maxComputeMs: 0,
    totalDemFetchMs: 0,
    demTilesFetched: 0,
    memoryBytes,
  };
}

function abortError(): DOMException {
  return new DOMException('Terrain shadow tile request canceled.', 'AbortError');
}

/**
 * Owns the `terrain-shadow://` MapLibre protocol and its lazily created GPU worker. Tiles
 * wait while the map is being dragged, zoomed, or rotated, and availability becomes
 * `unavailable` once the worker reports missing WebGL2 float support or its transport fails.
 */
export class MapLibreTerrainShadowTileProvider implements TerrainShadowTileProvider {
  readonly #terrain: MapProviderConfiguration['terrain'];
  readonly #workerFactory: TerrainShadowWorkerFactory;
  readonly #availabilityListeners = new Set<
    (value: TerrainShadowAvailability) => void
  >();
  readonly #gateWaiters = new Set<GateWaiter>();
  #rpc: WorkerRpcClient | null = null;
  #availability: TerrainShadowAvailability;
  #metrics = emptyMetrics(0);
  #pendingTiles = 0;
  #interactionActive = false;
  #disposed = false;

  public constructor(
    terrain: MapProviderConfiguration['terrain'],
    workerFactory: TerrainShadowWorkerFactory = defaultWorkerFactory,
  ) {
    this.#terrain = terrain;
    this.#workerFactory = workerFactory;
    // The GPU decoder and mosaics implement 512 px Terrarium DEM tiles only.
    this.#availability =
      terrain.encoding === 'terrarium' && terrain.tileSize === 512
        ? 'unknown'
        : 'unavailable';
    addProtocol(terrainShadowProtocolId, this.loadTile);
  }

  public createTileUrl(instantMs: number): string {
    if (!Number.isFinite(instantMs))
      throw new RangeError('The sun instant must be finite.');
    const epochMinute = Math.floor(instantMs / millisecondsPerMinute);
    return `${terrainShadowProtocolId}://${String(epochMinute)}/{z}/{x}/{y}`;
  }

  public setInteractionActive(active: boolean): void {
    if (this.#interactionActive === active) return;
    this.#interactionActive = active;
    if (active) return;
    const waiters = [...this.#gateWaiters];
    this.#gateWaiters.clear();
    for (const waiter of waiters) waiter.release();
  }

  public getAvailability(): TerrainShadowAvailability {
    return this.#availability;
  }

  public subscribeAvailability(
    listener: (value: TerrainShadowAvailability) => void,
  ): () => void {
    this.#availabilityListeners.add(listener);
    return () => {
      this.#availabilityListeners.delete(listener);
    };
  }

  public getMetrics(): TerrainShadowMetricsSnapshot {
    return { ...this.#metrics, pendingTiles: this.#pendingTiles };
  }

  public resetMetrics(): void {
    this.#metrics = emptyMetrics(this.#metrics.memoryBytes);
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    removeProtocol(terrainShadowProtocolId);
    const waiters = [...this.#gateWaiters];
    this.#gateWaiters.clear();
    for (const waiter of waiters) waiter.reject(abortError());
    this.#rpc?.dispose();
    this.#rpc = null;
    this.#availabilityListeners.clear();
  }

  private readonly loadTile: AddProtocolAction = async (
    parameters,
    abortController,
  ) => {
    const signal = abortController.signal;
    const address = parseTileAddress(parameters.url);
    if (address === null) throw new Error('Invalid terrain shadow tile address.');
    if (this.#disposed) throw new Error('The terrain shadow provider was disposed.');
    if (this.#availability === 'unavailable') {
      throw new Error('Terrain shadows are unavailable in this browser.');
    }
    this.#pendingTiles += 1;
    try {
      await this.waitForInteractionEnd(signal);
      const result = await this.ensureRpc().request<unknown>(
        terrainShadowWorkerMethods.renderTile,
        this.createRequest(address, address.epochMinute),
        signal,
      );
      if (!isTerrainShadowTileResult(result)) {
        throw new Error('The terrain shadow worker returned an invalid tile.');
      }
      this.recordTile(result.metrics);
      this.setAvailability('available');
      return { data: result.bitmap };
    } catch (error) {
      this.recordTileFailure(error, signal);
      throw error;
    } finally {
      this.#pendingTiles -= 1;
    }
  };

  public async prefetch(
    tiles: readonly TerrainShadowTileAddress[],
    instantsMs: readonly number[],
    signal: AbortSignal,
    onProgress: (progress: TerrainShadowPrefetchProgress) => void,
  ): Promise<void> {
    if (this.#disposed) throw new Error('The terrain shadow provider was disposed.');
    if (this.#availability === 'unavailable') {
      throw new Error('Terrain shadows are unavailable in this browser.');
    }
    signal.throwIfAborted();
    // The interaction gate is ignored: a camera move cancels the whole prefetch instead.
    // Every other block walks the tiles backwards, so the tiles just computed, whose DEM
    // tiles the worker still caches, start the next block.
    const reversedTiles = [...tiles].reverse();
    const requests: {
      readonly frame: number;
      readonly request: TerrainShadowTileRequest;
    }[] = [];
    for (
      let blockStart = 0;
      blockStart < instantsMs.length;
      blockStart += terrainShadowPrefetchBlockFrames
    ) {
      const block = instantsMs.slice(
        blockStart,
        blockStart + terrainShadowPrefetchBlockFrames,
      );
      const blockTiles =
        (blockStart / terrainShadowPrefetchBlockFrames) % 2 === 0
          ? tiles
          : reversedTiles;
      for (const tile of blockTiles) {
        block.forEach((instantMs, offset) => {
          requests.push({
            frame: blockStart + offset,
            request: this.createRequest(
              tile,
              Math.floor(instantMs / millisecondsPerMinute),
            ),
          });
        });
      }
    }
    const pendingTilesByFrame = instantsMs.map(() => tiles.length);
    let readyFrames = 0;
    // One internal signal cancels the remaining requests after the first failure too.
    const controller = new AbortController();
    const forwardAbort = () => {
      controller.abort();
    };
    signal.addEventListener('abort', forwardAbort, { once: true });
    let nextIndex = 0;
    let completed = 0;
    // Each runner takes the next request in order, so requests start in block order.
    const runQueue = async () => {
      while (nextIndex < requests.length && !controller.signal.aborted) {
        const entry = requests[nextIndex];
        nextIndex += 1;
        if (entry === undefined) return;
        try {
          const metrics = await this.ensureRpc().request<unknown>(
            terrainShadowWorkerMethods.prefetchTile,
            entry.request,
            controller.signal,
          );
          if (!isTerrainShadowTileMetrics(metrics)) {
            throw new Error('The terrain shadow worker returned invalid metrics.');
          }
          this.recordTile(metrics);
          this.setAvailability('available');
        } catch (error) {
          this.recordTileFailure(error, controller.signal);
          throw error;
        }
        completed += 1;
        pendingTilesByFrame[entry.frame] = (pendingTilesByFrame[entry.frame] ?? 1) - 1;
        while (
          readyFrames < pendingTilesByFrame.length &&
          pendingTilesByFrame[readyFrames] === 0
        ) {
          readyFrames += 1;
        }
        onProgress({ completed, total: requests.length, readyFrames });
      }
    };
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(terrainShadowPrefetchConcurrency, requests.length) },
          runQueue,
        ),
      );
    } catch (error) {
      controller.abort();
      if (!signal.aborted) throw error;
    } finally {
      signal.removeEventListener('abort', forwardAbort);
    }
    // A caller abort always wins, even when every runner had already stopped cleanly.
    if (signal.aborted) throw abortError();
  }

  private createRequest(
    address: TerrainShadowTileAddress,
    epochMinute: number,
  ): TerrainShadowTileRequest {
    return {
      z: address.z,
      x: address.x,
      y: address.y,
      instantMs: epochMinute * millisecondsPerMinute,
      tileSize: 512,
      demTileUrl: this.#terrain.tileUrl,
      demMinZoom: this.#terrain.minZoom,
      demMaxZoom: this.#terrain.maxZoom,
      shadowColor,
      highlightColor,
      highlightOpacity: mapVisualPalette.terrain.sunHighlightOpacity,
      lowSunShadowColor,
      lowSunShadowLift: mapVisualPalette.terrain.sunLowShadowLift,
      lowSunGlowOpacity: mapVisualPalette.terrain.sunLowGlowOpacity,
    };
  }

  /** Counts a failure unless canceled; a lost or unsupported worker disables shadows. */
  private recordTileFailure(error: unknown, signal: AbortSignal): void {
    if (signal.aborted) return;
    this.#metrics.tilesFailed += 1;
    if (
      error instanceof WorkerRpcTransportError ||
      (error instanceof WorkerRpcRemoteError &&
        error.code === terrainShadowUnavailableErrorCode)
    ) {
      this.setAvailability('unavailable');
    }
  }

  private ensureRpc(): WorkerRpcClient {
    if (this.#rpc !== null) return this.#rpc;
    const rpc = new WorkerRpcClient(this.#workerFactory());
    rpc.subscribeTransportFailure(() => {
      this.setAvailability('unavailable');
    });
    this.#rpc = rpc;
    return rpc;
  }

  private waitForInteractionEnd(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());
    if (!this.#interactionActive) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const handleAbort = () => {
        this.#gateWaiters.delete(waiter);
        reject(abortError());
      };
      const waiter: GateWaiter = {
        release: () => {
          signal.removeEventListener('abort', handleAbort);
          resolve();
        },
        reject: (error) => {
          signal.removeEventListener('abort', handleAbort);
          reject(error);
        },
      };
      this.#gateWaiters.add(waiter);
      signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  private recordTile(tile: TerrainShadowTileMetrics): void {
    const metrics = this.#metrics;
    if (tile.cacheHit) metrics.tilesFromCache += 1;
    else metrics.tilesRendered += 1;
    metrics.totalComputeMs += tile.computeMs;
    metrics.maxComputeMs = Math.max(metrics.maxComputeMs, tile.computeMs);
    metrics.totalDemFetchMs += tile.demFetchMs;
    metrics.demTilesFetched += tile.demTilesFetched;
    metrics.memoryBytes = tile.memoryBytes;
  }

  private setAvailability(value: TerrainShadowAvailability): void {
    if (this.#availability === value || this.#availability === 'unavailable') return;
    this.#availability = value;
    for (const listener of this.#availabilityListeners) listener(value);
  }
}
