import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type {
  TerrainComputeBackend,
  TerrainComputeMetrics,
  TerrainComputeQueueState,
  TerrainComputeStatus,
  TerrainContourOptions,
  TerrainContourTile,
  TerrainDemResponse,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import type { TerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';
import {
  TerrainComputeEngine,
  type TerrainComputeEngineOptions,
} from '@/infrastructure/elevation/TerrainComputeEngine';

/** Executes the shared engine on the window thread only as a compatibility fallback. */
export class InlineTerrainComputeBackend implements TerrainComputeBackend {
  readonly loaded: Promise<void>;
  readonly #engine: InlineTerrainComputeEngine;

  public constructor(
    configuration: TerrainComputeConfiguration,
    logger: DiagnosticLogger,
    options: TerrainComputeEngineOptions = {},
    engineFactory: InlineTerrainComputeEngineFactory = (
      engineConfiguration,
      engineLogger,
      engineOptions,
    ) => new TerrainComputeEngine(engineConfiguration, engineLogger, engineOptions),
  ) {
    this.#engine = engineFactory(configuration, logger, options);
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

  public async fetchContourTile(
    zoom: number,
    x: number,
    y: number,
    options: TerrainContourOptions,
    abortController: AbortController,
  ): Promise<TerrainContourTile> {
    const response = await this.#engine.fetchContourTile(
      zoom,
      x,
      y,
      options,
      abortController,
    );
    // MapLibre transfers delivered buffers. Keep the engine's cached copy owned here.
    return { arrayBuffer: response.arrayBuffer.slice(0) };
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

  public dispose(): void {
    this.#engine.dispose();
  }
}

interface InlineTerrainComputeEngine {
  readonly loaded: Promise<void>;
  fetchTile(
    zoom: number,
    x: number,
    y: number,
    abortController: AbortController,
  ): Promise<TerrainDemResponse>;
  fetchContourTile(
    zoom: number,
    x: number,
    y: number,
    options: TerrainContourOptions,
    abortController: AbortController,
  ): Promise<TerrainContourTile>;
  setFilterEnabled(enabled: boolean): void;
  dispose(): void;
}

export type InlineTerrainComputeEngineFactory = (
  configuration: TerrainComputeConfiguration,
  logger: DiagnosticLogger,
  options: TerrainComputeEngineOptions,
) => InlineTerrainComputeEngine;
