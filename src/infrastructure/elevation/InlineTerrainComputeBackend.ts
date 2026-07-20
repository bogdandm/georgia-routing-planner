import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type {
  TerrainComputeBackend,
  TerrainComputeMetrics,
  TerrainComputeQueueState,
  TerrainComputeStatus,
  TerrainContourOptions,
  TerrainContourTile,
  TerrainDecodedDemTile,
  TerrainDemResponse,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import {
  TerrainComputeEngine,
  type TerrainComputeEngineOptions,
} from '@/infrastructure/elevation/TerrainComputeEngine';

/** Executes the shared engine on the window thread only as a compatibility fallback. */
export class InlineTerrainComputeBackend implements TerrainComputeBackend {
  readonly loaded: Promise<void>;
  readonly #engine: TerrainComputeEngine;

  public constructor(
    terrain: MapProviderConfiguration['terrain'],
    requestTimeoutMs: number,
    logger: DiagnosticLogger,
    options: TerrainComputeEngineOptions = {},
  ) {
    this.#engine = new TerrainComputeEngine(terrain, requestTimeoutMs, logger, options);
    this.loaded = this.#engine.loaded;
  }

  public fetchTile(
    zoom: number,
    x: number,
    y: number,
    abortController: AbortController,
  ): Promise<TerrainDemResponse> {
    return this.#engine.fetchTile(zoom, x, y, abortController);
  }

  public fetchAndParseTile(
    zoom: number,
    x: number,
    y: number,
    abortController: AbortController,
  ): Promise<TerrainDecodedDemTile> {
    return this.#engine.fetchAndParseTile(zoom, x, y, abortController);
  }

  public fetchContourTile(
    zoom: number,
    x: number,
    y: number,
    options: TerrainContourOptions,
    abortController: AbortController,
  ): Promise<TerrainContourTile> {
    return this.#engine.fetchContourTile(zoom, x, y, options, abortController);
  }

  public setFilterEnabled(enabled: boolean): void {
    this.#engine.setFilterEnabled(enabled);
  }

  public setInteractionActive(active: boolean): void {
    void active;
  }

  public getStatus(): TerrainComputeStatus {
    return 'inline';
  }

  public getQueueState(): TerrainComputeQueueState {
    return {
      executionMode: 'inline',
      activeCount: 0,
      queuedContourCount: 0,
      queueCapacity: 0,
    };
  }

  public subscribeStatus(
    _listener: (status: TerrainComputeStatus) => void,
  ): () => void {
    return () => undefined;
  }

  public subscribeQueueState(
    _listener: (state: TerrainComputeQueueState) => void,
  ): () => void {
    return () => undefined;
  }

  public subscribeMetrics(
    _listener: (metrics: TerrainComputeMetrics) => void,
  ): () => void {
    return () => undefined;
  }

  public subscribeDiagnostic(): () => void {
    return () => undefined;
  }

  public dispose(): void {
    this.#engine.dispose();
  }
}
