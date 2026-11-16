import {
  type WorkerRpcEndpoint,
  WorkerRpcServer,
  type WorkerRpcTransferResult,
} from '@/infrastructure/runtime/WorkerRpc';
import { terrainShadowTileRequestSchema } from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import { TerrainShadowRenderer } from '@/infrastructure/terrainShadow/TerrainShadowRenderer';

export const terrainShadowWorkerMethods = {
  renderTile: 'terrain-shadow.render-tile',
  renderDraft: 'terrain-shadow.render-draft',
  /** Caches one tile's shade mask and answers with its metrics only. */
  prefetchTile: 'terrain-shadow.prefetch-tile',
} as const;

/** Validates worker messages and transfers rendered shade masks without copying them. */
export class TerrainShadowWorkerServer {
  readonly #rpc: WorkerRpcServer;

  public constructor(
    endpoint: WorkerRpcEndpoint,
    renderer: Pick<
      TerrainShadowRenderer,
      'render' | 'renderDraft' | 'prefetch' | 'dispose'
    > = new TerrainShadowRenderer(),
  ) {
    const renderTile = async (
      payload: unknown,
      signal: AbortSignal,
      draft: boolean,
    ): Promise<WorkerRpcTransferResult> => {
      const request = terrainShadowTileRequestSchema.parse(payload);
      const result = draft
        ? await renderer.renderDraft(request, signal)
        : await renderer.render(request, signal);
      if (signal.aborted) {
        result.bitmap.close();
        throw new DOMException('Terrain shadow tile request canceled.', 'AbortError');
      }
      return { value: result, transfer: [result.bitmap] };
    };
    this.#rpc = new WorkerRpcServer(
      endpoint,
      {
        [terrainShadowWorkerMethods.renderTile]: (payload, { signal }) =>
          renderTile(payload, signal, false),
        [terrainShadowWorkerMethods.renderDraft]: (payload, { signal }) =>
          renderTile(payload, signal, true),
        [terrainShadowWorkerMethods.prefetchTile]: async (payload, { signal }) =>
          renderer.prefetch(terrainShadowTileRequestSchema.parse(payload), signal),
      },
      () => {
        renderer.dispose();
      },
    );
  }

  public dispose(): void {
    this.#rpc.dispose();
  }
}
