import {
  type WorkerRpcEndpoint,
  WorkerRpcServer,
  type WorkerRpcTransferResult,
} from '@/infrastructure/runtime/WorkerRpc';
import { terrainShadowTileRequestSchema } from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import { TerrainShadowRenderer } from '@/infrastructure/terrainShadow/TerrainShadowRenderer';

export const terrainShadowWorkerMethods = {
  renderTile: 'terrain-shadow.render-tile',
} as const;

/** Validates worker messages and transfers rendered shade masks without copying them. */
export class TerrainShadowWorkerServer {
  readonly #rpc: WorkerRpcServer;

  public constructor(
    endpoint: WorkerRpcEndpoint,
    renderer: Pick<
      TerrainShadowRenderer,
      'render' | 'dispose'
    > = new TerrainShadowRenderer(),
  ) {
    this.#rpc = new WorkerRpcServer(
      endpoint,
      {
        [terrainShadowWorkerMethods.renderTile]: async (
          payload,
          { signal },
        ): Promise<WorkerRpcTransferResult> => {
          const request = terrainShadowTileRequestSchema.parse(payload);
          const result = await renderer.render(request, signal);
          if (signal.aborted) {
            // The RPC server drops canceled results, so release the GPU-backed bitmap here.
            result.bitmap.close();
            throw new DOMException(
              'Terrain shadow tile request canceled.',
              'AbortError',
            );
          }
          return { value: result, transfer: [result.bitmap] };
        },
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
