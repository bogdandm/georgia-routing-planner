import {
  defaultTerrainShadowShading,
  type TerrainShadowAvailability,
  type TerrainShadowMetricsSnapshot,
  type TerrainShadowPrefetchProgress,
  type TerrainShadowShading,
  type TerrainShadowTileAddress,
  type TerrainShadowTileProvider,
} from '@/presentation/map/TerrainShadowTileProvider';

/** One recorded prefetch; the test settles it, and aborting its signal rejects it. */
export interface FakePrefetchCall {
  readonly tiles: readonly TerrainShadowTileAddress[];
  readonly instantsMs: readonly number[];
  readonly signal: AbortSignal;
  readonly onProgress: (progress: TerrainShadowPrefetchProgress) => void;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

const emptyMetrics: TerrainShadowMetricsSnapshot = {
  tilesRendered: 0,
  tilesFromCache: 0,
  tilesFailed: 0,
  pendingTiles: 0,
  totalComputeMs: 0,
  maxComputeMs: 0,
  totalDemFetchMs: 0,
  demTilesFetched: 0,
  memoryBytes: 0,
};

/** Shadow provider without a worker; tests switch availability and read interaction. */
export class FakeTerrainShadowTileProvider implements TerrainShadowTileProvider {
  public interactionActive = false;
  public disposed = false;
  public readonly prefetchCalls: FakePrefetchCall[] = [];
  public metrics: TerrainShadowMetricsSnapshot = emptyMetrics;
  public shading: TerrainShadowShading = defaultTerrainShadowShading;
  #availability: TerrainShadowAvailability;
  readonly #listeners = new Set<(value: TerrainShadowAvailability) => void>();
  readonly #shadingIndexByKey = new Map([
    [JSON.stringify(defaultTerrainShadowShading), 0],
  ]);

  public constructor(availability: TerrainShadowAvailability = 'available') {
    this.#availability = availability;
  }

  /** Like the real provider, every distinct shading gets its own `?shading=` URL. */
  public createTileUrl(instantMs: number, fullQuality = false): string {
    const key = JSON.stringify(this.shading);
    const index = this.#shadingIndexByKey.get(key) ?? this.#shadingIndexByKey.size;
    this.#shadingIndexByKey.set(key, index);
    const shading = index === 0 ? '' : `?shading=${String(index)}`;
    const quality = fullQuality ? `${shading === '' ? '?' : '&'}quality=full` : '';
    return `terrain-shadow://${String(Math.floor(instantMs / 60_000))}/{z}/{x}/{y}${shading}${quality}`;
  }

  public takeDraftTile(_tileUrl: string, _tile: TerrainShadowTileAddress): boolean {
    return false;
  }

  public setInteractionActive(active: boolean): void {
    this.interactionActive = active;
  }

  public setShading(shading: TerrainShadowShading): void {
    this.shading = shading;
  }

  public prefetch(
    tiles: readonly TerrainShadowTileAddress[],
    instantsMs: readonly number[],
    signal: AbortSignal,
    onProgress: (progress: TerrainShadowPrefetchProgress) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new DOMException('Prefetch canceled.', 'AbortError'));
        },
        { once: true },
      );
      this.prefetchCalls.push({
        tiles,
        instantsMs,
        signal,
        onProgress,
        resolve,
        reject,
      });
    });
  }

  public getAvailability(): TerrainShadowAvailability {
    return this.#availability;
  }

  public subscribeAvailability(
    listener: (value: TerrainShadowAvailability) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public setAvailability(value: TerrainShadowAvailability): void {
    this.#availability = value;
    for (const listener of this.#listeners) listener(value);
  }

  public getMetrics(): TerrainShadowMetricsSnapshot {
    return this.metrics;
  }

  public resetMetrics(): void {
    this.metrics = emptyMetrics;
  }

  public dispose(): void {
    this.disposed = true;
  }
}
