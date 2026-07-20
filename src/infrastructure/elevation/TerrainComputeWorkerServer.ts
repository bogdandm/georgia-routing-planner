import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type {
  TerrainComputeMetrics,
  TerrainContourOptions,
  TerrainContourTile,
  TerrainDemResponse,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import { defaultTerrainContourQueueCapacity } from '@/infrastructure/elevation/TerrainComputeBackend';
import type { TerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';
import { TerrainComputeEngine } from '@/infrastructure/elevation/TerrainComputeEngine';
import {
  parseTerrainWorkerContourRequest,
  parseTerrainWorkerInitializeRequest,
  parseTerrainWorkerInteractionRequest,
  parseTerrainWorkerSetFilterRequest,
  parseTerrainWorkerTileRequest,
  terrainWorkerEventNames,
  type TerrainWorkerContourResult,
  type TerrainWorkerDemResult,
} from '@/infrastructure/elevation/TerrainComputeProtocol';
import {
  type WorkerRpcEndpoint,
  WorkerRpcServer,
  type WorkerRpcTransferResult,
} from '@/infrastructure/runtime/WorkerRpc';

interface TerrainWorkerEngine {
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

interface QueuedContour {
  readonly signal: AbortSignal;
  readonly run: () => Promise<WorkerRpcTransferResult>;
  readonly resolve: (result: WorkerRpcTransferResult) => void;
  readonly reject: (error: Error) => void;
  readonly handleAbort: () => void;
}

export type TerrainWorkerEngineFactory = (
  configuration: TerrainComputeConfiguration,
  logger: DiagnosticLogger,
) => TerrainWorkerEngine;

function linkedAbortController(signal: AbortSignal): {
  readonly controller: AbortController;
  readonly release: () => void;
} {
  const controller = new AbortController();
  const handleAbort = () => {
    controller.abort(signal.reason);
  };
  if (signal.aborted) handleAbort();
  else signal.addEventListener('abort', handleAbort, { once: true });
  return {
    controller,
    release: () => {
      signal.removeEventListener('abort', handleAbort);
    },
  };
}

function operationStatus(error: unknown): TerrainComputeMetrics['status'] {
  return error instanceof DOMException && error.name === 'AbortError'
    ? 'canceled'
    : 'failed';
}

/** Executes validated terrain RPC requests inside one dedicated module worker. */
export class TerrainComputeWorkerServer {
  readonly #rpc: WorkerRpcServer;
  #engine: TerrainWorkerEngine | null = null;
  #revision = 0;
  #pendingCount = 0;
  #interactionActive = false;
  #contourRunning = false;
  readonly #contourQueue: QueuedContour[] = [];

  public constructor(
    endpoint: WorkerRpcEndpoint,
    private readonly engineFactory: TerrainWorkerEngineFactory = (
      configuration,
      logger,
    ) => new TerrainComputeEngine(configuration, logger),
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly maximumQueuedContours = defaultTerrainContourQueueCapacity,
  ) {
    if (maximumQueuedContours < 1) {
      throw new RangeError('The terrain contour queue must accept at least one job.');
    }
    const logger: DiagnosticLogger = {
      log: (input) => {
        this.#rpc.publishEvent(terrainWorkerEventNames.diagnostic, input);
      },
      getEvents: () => [],
    };
    this.#rpc = new WorkerRpcServer(
      endpoint,
      {
        initialize: (payload) => {
          const request = parseTerrainWorkerInitializeRequest(payload);
          this.#engine?.dispose();
          this.#engine = this.engineFactory(request.configuration, logger);
          this.#revision = request.revision;
          this.#interactionActive = request.interactionActive;
          this.#engine.setFilterEnabled(request.filterEnabled);
          this.publishQueueState();
          return { initialized: true };
        },
        dem: async (payload, context) => {
          const request = parseTerrainWorkerTileRequest(payload);
          this.assertCurrentRevision(request.revision);
          return this.execute('dem', context.signal, async (abortController) => {
            const response = await this.requireEngine().fetchTile(
              request.zoom,
              request.x,
              request.y,
              abortController,
            );
            this.assertCurrentRevision(request.revision);
            const data = await response.data.arrayBuffer();
            const value: TerrainWorkerDemResult = {
              kind: 'dem',
              data,
              ...(response.cacheControl === undefined
                ? {}
                : { cacheControl: response.cacheControl }),
              ...(response.expires === undefined ? {} : { expires: response.expires }),
            };
            return { value, transfer: [data] } satisfies WorkerRpcTransferResult;
          });
        },
        contour: async (payload, context) => {
          const request = parseTerrainWorkerContourRequest(payload);
          this.assertCurrentRevision(request.revision);
          const queuedAt = this.monotonicNow();
          return this.scheduleContour(context.signal, () =>
            this.execute(
              'contour',
              context.signal,
              async (abortController) => {
                this.assertCurrentRevision(request.revision);
                const response = await this.requireEngine().fetchContourTile(
                  request.zoom,
                  request.x,
                  request.y,
                  request.options,
                  abortController,
                );
                this.assertCurrentRevision(request.revision);
                // The engine cache retains its buffer; only the owned copy is transferred.
                const data = response.arrayBuffer.slice(0);
                const value: TerrainWorkerContourResult = { kind: 'contour', data };
                return {
                  value,
                  transfer: [data],
                } satisfies WorkerRpcTransferResult;
              },
              queuedAt,
            ),
          );
        },
        'set-filter': (payload) => {
          const request = parseTerrainWorkerSetFilterRequest(payload);
          if (request.revision <= this.#revision) return { revision: this.#revision };
          this.cancelQueuedContours(
            new DOMException('Terrain request revision is obsolete.', 'AbortError'),
          );
          this.#revision = request.revision;
          this.requireEngine().setFilterEnabled(request.enabled);
          return { revision: this.#revision };
        },
        interaction: (payload) => {
          const request = parseTerrainWorkerInteractionRequest(payload);
          this.#interactionActive = request.active;
          if (!request.active) this.drainContourQueue();
          else this.publishQueueState();
          return { active: request.active };
        },
      },
      () => {
        this.cancelQueuedContours(
          new DOMException('Terrain worker disposed.', 'AbortError'),
        );
        this.#engine?.dispose();
        this.#engine = null;
      },
    );
  }

  public dispose(): void {
    this.#rpc.dispose();
  }

  private async execute(
    operation: TerrainComputeMetrics['operation'],
    signal: AbortSignal,
    execute: (abortController: AbortController) => Promise<WorkerRpcTransferResult>,
    queuedAt = this.monotonicNow(),
  ): Promise<WorkerRpcTransferResult> {
    this.#pendingCount += 1;
    this.publishQueueState();
    const { controller, release } = linkedAbortController(signal);
    const startedAt = this.monotonicNow();
    try {
      const result = await execute(controller);
      this.publishMetrics({
        operation,
        status: 'success',
        queueDurationMs: startedAt - queuedAt,
        computeDurationMs: this.monotonicNow() - startedAt,
      });
      return result;
    } catch (error) {
      this.publishMetrics({
        operation,
        status: operationStatus(error),
        queueDurationMs: startedAt - queuedAt,
        computeDurationMs: this.monotonicNow() - startedAt,
      });
      throw error;
    } finally {
      release();
      this.#pendingCount -= 1;
      this.publishQueueState();
    }
  }

  private publishMetrics(
    metrics: Pick<
      TerrainComputeMetrics,
      'operation' | 'status' | 'queueDurationMs' | 'computeDurationMs'
    >,
  ): void {
    this.#rpc.publishEvent(terrainWorkerEventNames.metrics, {
      ...metrics,
      executionMode: 'worker',
      pendingCount: this.#pendingCount + this.#contourQueue.length,
    } satisfies TerrainComputeMetrics);
  }

  private publishQueueState(): void {
    this.#rpc.publishEvent(terrainWorkerEventNames.queueState, {
      executionMode: 'worker',
      activeCount: this.#pendingCount,
      queuedContourCount: this.#contourQueue.length,
      queueCapacity: this.maximumQueuedContours,
    });
  }

  private requireEngine(): TerrainWorkerEngine {
    if (this.#engine === null) throw new Error('Terrain worker is not initialized.');
    return this.#engine;
  }

  private scheduleContour(
    signal: AbortSignal,
    run: () => Promise<WorkerRpcTransferResult>,
  ): Promise<WorkerRpcTransferResult> {
    if (signal.aborted) {
      return Promise.reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Terrain contour request canceled.', 'AbortError'),
      );
    }
    return new Promise((resolve, reject) => {
      const item: QueuedContour = {
        signal,
        run,
        resolve,
        reject,
        handleAbort: () => {
          this.removeQueuedContour(item);
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException('Terrain contour request canceled.', 'AbortError'),
          );
        },
      };
      signal.addEventListener('abort', item.handleAbort, { once: true });
      if (this.#contourQueue.length >= this.maximumQueuedContours) {
        const superseded = this.#contourQueue.shift();
        if (superseded !== undefined) {
          superseded.signal.removeEventListener('abort', superseded.handleAbort);
          superseded.reject(
            new DOMException(
              'Terrain contour request was superseded by a newer viewport.',
              'AbortError',
            ),
          );
        }
      }
      this.#contourQueue.push(item);
      this.publishQueueState();
      this.drainContourQueue();
    });
  }

  private drainContourQueue(): void {
    if (this.#interactionActive || this.#contourRunning) return;
    const item = this.#contourQueue.shift();
    if (item === undefined) return;
    this.publishQueueState();
    item.signal.removeEventListener('abort', item.handleAbort);
    if (item.signal.aborted) {
      item.reject(
        item.signal.reason instanceof Error
          ? item.signal.reason
          : new DOMException('Terrain contour request canceled.', 'AbortError'),
      );
      this.drainContourQueue();
      return;
    }
    this.#contourRunning = true;
    void item
      .run()
      .then(item.resolve, item.reject)
      .finally(() => {
        this.#contourRunning = false;
        this.drainContourQueue();
      });
  }

  private removeQueuedContour(item: QueuedContour): void {
    const index = this.#contourQueue.indexOf(item);
    if (index >= 0) {
      this.#contourQueue.splice(index, 1);
      this.publishQueueState();
    }
  }

  private cancelQueuedContours(reason: Error): void {
    for (const item of this.#contourQueue.splice(0)) {
      item.signal.removeEventListener('abort', item.handleAbort);
      item.reject(reason);
    }
    this.publishQueueState();
  }

  private assertCurrentRevision(revision: number): void {
    if (revision !== this.#revision) {
      throw new DOMException('Terrain request revision is obsolete.', 'AbortError');
    }
  }
}
