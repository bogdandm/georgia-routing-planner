import type {
  TerrainShadowAvailability,
  TerrainShadowMetricsSnapshot,
  TerrainShadowPrefetchProgress,
  TerrainShadowTileAddress,
  TerrainShadowTileProvider,
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
  public skyOcclusion = true;
  public disposed = false;
  public readonly prefetchCalls: FakePrefetchCall[] = [];
  public metrics: TerrainShadowMetricsSnapshot = emptyMetrics;
  #availability: TerrainShadowAvailability;
  readonly #listeners = new Set<(value: TerrainShadowAvailability) => void>();

  public constructor(availability: TerrainShadowAvailability = 'available') {
    this.#availability = availability;
  }

  public createTileUrl(instantMs: number): string {
    const variant = this.skyOcclusion ? '' : '?sky=flat';
    return `terrain-shadow://${String(Math.floor(instantMs / 60_000))}/{z}/{x}/{y}${variant}`;
  }

  public setSkyOcclusion(enabled: boolean): void {
    this.skyOcclusion = enabled;
  }

  public setInteractionActive(active: boolean): void {
    this.interactionActive = active;
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
