import type {
  TerrainShadowAvailability,
  TerrainShadowMetricsSnapshot,
  TerrainShadowTileProvider,
} from '@/presentation/map/TerrainShadowTileProvider';

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
  public metrics: TerrainShadowMetricsSnapshot = emptyMetrics;
  #availability: TerrainShadowAvailability;
  readonly #listeners = new Set<(value: TerrainShadowAvailability) => void>();

  public constructor(availability: TerrainShadowAvailability = 'available') {
    this.#availability = availability;
  }

  public createTileUrl(instantMs: number): string {
    return `terrain-shadow://${String(Math.floor(instantMs / 60_000))}/{z}/{x}/{y}`;
  }

  public setInteractionActive(active: boolean): void {
    this.interactionActive = active;
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
