import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type {
  TerrainComputeMetrics,
  TerrainContourOptions,
  TerrainContourTile,
  TerrainDemResponse,
} from '@/infrastructure/elevation/TerrainComputeBackend';
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

export type TerrainWorkerEngineFactory = (
  terrain: MapProviderConfiguration['terrain'],
  requestTimeoutMs: number,
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

  public constructor(
    endpoint: WorkerRpcEndpoint,
    private readonly engineFactory: TerrainWorkerEngineFactory = (
      terrain,
      requestTimeoutMs,
      logger,
    ) => new TerrainComputeEngine(terrain, requestTimeoutMs, logger),
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {
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
          this.#engine = this.engineFactory(
            request.terrain,
            request.requestTimeoutMs,
            logger,
          );
          this.#revision = request.revision;
          this.#engine.setFilterEnabled(request.filterEnabled);
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
          return this.execute('contour', context.signal, async (abortController) => {
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
            return { value, transfer: [data] } satisfies WorkerRpcTransferResult;
          });
        },
        'set-filter': (payload) => {
          const request = parseTerrainWorkerSetFilterRequest(payload);
          if (request.revision <= this.#revision) return { revision: this.#revision };
          this.#revision = request.revision;
          this.requireEngine().setFilterEnabled(request.enabled);
          return { revision: this.#revision };
        },
        interaction: (payload) => {
          parseTerrainWorkerInteractionRequest(payload);
          return { accepted: true };
        },
      },
      () => {
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
  ): Promise<WorkerRpcTransferResult> {
    const queuedAt = this.monotonicNow();
    this.#pendingCount += 1;
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
      pendingCount: this.#pendingCount,
    } satisfies TerrainComputeMetrics);
  }

  private requireEngine(): TerrainWorkerEngine {
    if (this.#engine === null) throw new Error('Terrain worker is not initialized.');
    return this.#engine;
  }

  private assertCurrentRevision(revision: number): void {
    if (revision !== this.#revision) {
      throw new DOMException('Terrain request revision is obsolete.', 'AbortError');
    }
  }
}
