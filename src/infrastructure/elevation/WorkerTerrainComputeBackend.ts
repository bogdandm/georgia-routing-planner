import type {
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type {
  TerrainComputeBackend,
  TerrainComputeMetrics,
  TerrainComputeStatus,
  TerrainContourOptions,
  TerrainContourTile,
  TerrainDecodedDemTile,
  TerrainDemResponse,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import { InlineTerrainComputeBackend } from '@/infrastructure/elevation/InlineTerrainComputeBackend';
import {
  isTerrainWorkerContourResult,
  isTerrainWorkerDemResult,
  terrainWorkerEventNames,
  type TerrainWorkerContourRequest,
  type TerrainWorkerInitializeRequest,
  type TerrainWorkerSetFilterRequest,
  type TerrainWorkerTileRequest,
} from '@/infrastructure/elevation/TerrainComputeProtocol';
import {
  type WorkerRpcEndpoint,
  WorkerRpcClient,
  WorkerRpcTransportError,
} from '@/infrastructure/runtime/WorkerRpc';

export type TerrainWorkerFactory = () => WorkerRpcEndpoint;
export type TerrainInlineBackendFactory = () => TerrainComputeBackend;

function defaultWorkerFactory(): WorkerRpcEndpoint {
  return new Worker(new URL('./terrainCompute.worker.ts', import.meta.url), {
    type: 'module',
    name: 'terrain-compute',
  });
}

function isDiagnosticInput(value: unknown): value is DiagnosticInput {
  if (typeof value !== 'object' || value === null) return false;
  if (!('level' in value) || !('name' in value)) return false;
  return (
    (value.level === 'debug' ||
      value.level === 'info' ||
      value.level === 'warn' ||
      value.level === 'error') &&
    typeof value.name === 'string'
  );
}

function isMetrics(value: unknown): value is TerrainComputeMetrics {
  return (
    typeof value === 'object' &&
    value !== null &&
    'executionMode' in value &&
    value.executionMode === 'worker' &&
    'operation' in value &&
    (value.operation === 'dem' || value.operation === 'contour') &&
    'queueDurationMs' in value &&
    typeof value.queueDurationMs === 'number' &&
    'computeDurationMs' in value &&
    typeof value.computeDurationMs === 'number' &&
    'pendingCount' in value &&
    typeof value.pendingCount === 'number' &&
    'status' in value &&
    (value.status === 'success' ||
      value.status === 'failed' ||
      value.status === 'canceled')
  );
}

function staleRequestError(): DOMException {
  return new DOMException('Terrain request revision is obsolete.', 'AbortError');
}

/**
 * Runs terrain work in one recoverable module worker and permanently selects the shared
 * inline engine for the page session only after the single restart also fails.
 */
export class WorkerTerrainComputeBackend implements TerrainComputeBackend {
  public readonly loaded: Promise<void>;
  readonly #statusListeners = new Set<(status: TerrainComputeStatus) => void>();
  readonly #metricsListeners = new Set<(metrics: TerrainComputeMetrics) => void>();
  readonly #diagnosticListeners = new Set<(input: DiagnosticInput) => void>();
  #status: TerrainComputeStatus = 'worker';
  #rpc: WorkerRpcClient | null = null;
  #inline: TerrainComputeBackend | null = null;
  #restartAttempted = false;
  #recovery: Promise<void> | null = null;
  #control: Promise<void> = Promise.resolve();
  #filterEnabled = true;
  #revision = 0;
  #interactionActive = false;
  #disposed = false;

  public constructor(
    private readonly terrain: MapProviderConfiguration['terrain'],
    private readonly requestTimeoutMs: number,
    private readonly logger: DiagnosticLogger,
    private readonly workerFactory: TerrainWorkerFactory = defaultWorkerFactory,
    private readonly inlineFactory: TerrainInlineBackendFactory = () =>
      new InlineTerrainComputeBackend(terrain, requestTimeoutMs, logger),
  ) {
    try {
      this.#rpc = this.createChannel();
      this.loaded = this.initializeInitialChannel();
    } catch {
      this.activateInline();
      this.loaded = Promise.resolve();
    }
  }

  public async fetchTile(
    zoom: number,
    x: number,
    y: number,
    abortController: AbortController,
  ): Promise<TerrainDemResponse> {
    const revision = this.#revision;
    const request: TerrainWorkerTileRequest = {
      zoom,
      x,
      y,
      revision,
      priority: 'high',
    };
    const result = await this.executeWithRecovery(
      (rpc) => rpc.request('dem', request, abortController.signal),
      (inline) => inline.fetchTile(zoom, x, y, abortController),
      abortController.signal,
    );
    if (revision !== this.#revision) throw staleRequestError();
    if (result instanceof Object && 'data' in result && result.data instanceof Blob) {
      return result as TerrainDemResponse;
    }
    if (!isTerrainWorkerDemResult(result)) {
      throw new WorkerRpcTransportError(
        'The terrain worker returned an invalid DEM result.',
      );
    }
    return {
      data: new Blob([result.data], { type: 'image/png' }),
      ...(result.cacheControl === undefined
        ? {}
        : { cacheControl: result.cacheControl }),
      ...(result.expires === undefined ? {} : { expires: result.expires }),
    };
  }

  public fetchAndParseTile(
    _zoom: number,
    _x: number,
    _y: number,
    _abortController: AbortController,
  ): Promise<TerrainDecodedDemTile> {
    return Promise.reject(
      new Error('Parsed terrain tiles are internal to the terrain compute backend.'),
    );
  }

  public async fetchContourTile(
    zoom: number,
    x: number,
    y: number,
    options: TerrainContourOptions,
    abortController: AbortController,
  ): Promise<TerrainContourTile> {
    const revision = this.#revision;
    const request: TerrainWorkerContourRequest = {
      zoom,
      x,
      y,
      options,
      revision,
      priority: 'low',
    };
    const result = await this.executeWithRecovery(
      (rpc) => rpc.request('contour', request, abortController.signal),
      (inline) => inline.fetchContourTile(zoom, x, y, options, abortController),
      abortController.signal,
    );
    if (revision !== this.#revision) throw staleRequestError();
    if (
      result instanceof Object &&
      'arrayBuffer' in result &&
      result.arrayBuffer instanceof ArrayBuffer
    ) {
      return result as TerrainContourTile;
    }
    if (!isTerrainWorkerContourResult(result)) {
      throw new WorkerRpcTransportError(
        'The terrain worker returned an invalid contour result.',
      );
    }
    return { arrayBuffer: result.data };
  }

  public setFilterEnabled(enabled: boolean): void {
    if (this.#filterEnabled === enabled || this.#disposed) return;
    this.#filterEnabled = enabled;
    this.#revision += 1;
    const request: TerrainWorkerSetFilterRequest = {
      enabled,
      revision: this.#revision,
    };
    this.queueControl(
      (rpc) => rpc.request('set-filter', request),
      (inline) => {
        inline.setFilterEnabled(enabled);
      },
    );
  }

  public setInteractionActive(active: boolean): void {
    if (this.#interactionActive === active || this.#disposed) return;
    this.#interactionActive = active;
    this.queueControl(
      (rpc) => rpc.request('interaction', { active }),
      (inline) => {
        inline.setInteractionActive(active);
      },
    );
  }

  public getStatus(): TerrainComputeStatus {
    return this.#status;
  }

  public subscribeStatus(listener: (status: TerrainComputeStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => {
      this.#statusListeners.delete(listener);
    };
  }

  public subscribeMetrics(
    listener: (metrics: TerrainComputeMetrics) => void,
  ): () => void {
    this.#metricsListeners.add(listener);
    return () => {
      this.#metricsListeners.delete(listener);
    };
  }

  public subscribeDiagnostic(listener: (input: DiagnosticInput) => void): () => void {
    this.#diagnosticListeners.add(listener);
    return () => {
      this.#diagnosticListeners.delete(listener);
    };
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rpc?.dispose();
    this.#rpc = null;
    this.#inline?.dispose();
    this.#inline = null;
    this.#statusListeners.clear();
    this.#metricsListeners.clear();
    this.#diagnosticListeners.clear();
  }

  private async initializeInitialChannel(): Promise<void> {
    try {
      await this.initializeChannel(this.requireRpc());
    } catch {
      await this.recover();
    }
  }

  private createChannel(): WorkerRpcClient {
    const rpc = new WorkerRpcClient(this.workerFactory());
    rpc.subscribeEvent(terrainWorkerEventNames.diagnostic, (payload) => {
      if (!isDiagnosticInput(payload)) return;
      this.logger.log(payload);
      for (const listener of this.#diagnosticListeners) listener(payload);
    });
    rpc.subscribeEvent(terrainWorkerEventNames.metrics, (payload) => {
      if (!isMetrics(payload)) return;
      for (const listener of this.#metricsListeners) listener(payload);
    });
    rpc.subscribeTransportFailure(() => {
      if (!this.#disposed && this.#rpc === rpc) void this.recover();
    });
    return rpc;
  }

  private initializeChannel(rpc: WorkerRpcClient): Promise<unknown> {
    const request: TerrainWorkerInitializeRequest = {
      terrain: this.terrain,
      requestTimeoutMs: this.requestTimeoutMs,
      filterEnabled: this.#filterEnabled,
      revision: this.#revision,
      interactionActive: this.#interactionActive,
    };
    return rpc.request('initialize', request);
  }

  private async executeWithRecovery<TResult>(
    workerOperation: (rpc: WorkerRpcClient) => Promise<TResult>,
    inlineOperation: (inline: TerrainComputeBackend) => Promise<TResult>,
    signal: AbortSignal,
  ): Promise<TResult> {
    await this.loaded;
    await this.#control;
    for (;;) {
      if (signal.aborted) throw staleRequestError();
      const inline = this.#inline;
      if (inline !== null) return inlineOperation(inline);
      try {
        return await workerOperation(this.requireRpc());
      } catch (error) {
        if (!(error instanceof WorkerRpcTransportError)) throw error;
        await this.recover();
      }
    }
  }

  private queueControl(
    workerOperation: (rpc: WorkerRpcClient) => Promise<unknown>,
    inlineOperation: (inline: TerrainComputeBackend) => void,
  ): void {
    this.#control = this.#control.then(async () => {
      await this.loaded;
      while (!this.#disposed) {
        const inline = this.#inline;
        if (inline !== null) {
          inlineOperation(inline);
          return;
        }
        try {
          await workerOperation(this.requireRpc());
          return;
        } catch (error) {
          if (!(error instanceof WorkerRpcTransportError)) throw error;
          await this.recover();
        }
      }
    });
  }

  private async recover(): Promise<void> {
    if (this.#disposed || this.#inline !== null) return;
    if (this.#recovery !== null) return this.#recovery;
    this.#recovery = this.recoverInternal().finally(() => {
      this.#recovery = null;
    });
    return this.#recovery;
  }

  private async recoverInternal(): Promise<void> {
    if (!this.#restartAttempted) {
      this.#restartAttempted = true;
      this.setStatus('restarting');
      this.logger.log({
        level: 'warn',
        name: 'map.terrain-worker.restarting',
        data: { count: 1, status: 'restarting' },
      });
      this.#rpc?.dispose();
      try {
        const rpc = this.createChannel();
        this.#rpc = rpc;
        await this.initializeChannel(rpc);
        this.setStatus('worker');
        return;
      } catch {
        this.#rpc?.dispose();
        this.#rpc = null;
      }
    }
    this.activateInline();
  }

  private activateInline(): void {
    if (this.#inline !== null) return;
    this.#rpc?.dispose();
    this.#rpc = null;
    const inline = this.inlineFactory();
    if (!this.#filterEnabled) inline.setFilterEnabled(false);
    inline.setInteractionActive(this.#interactionActive);
    this.#inline = inline;
    this.setStatus('inline');
    this.logger.log({
      level: 'warn',
      name: 'map.terrain-worker.fallback',
      data: { count: 1, status: 'inline' },
    });
  }

  private setStatus(status: TerrainComputeStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  private requireRpc(): WorkerRpcClient {
    if (this.#rpc === null) throw new WorkerRpcTransportError();
    return this.#rpc;
  }
}
