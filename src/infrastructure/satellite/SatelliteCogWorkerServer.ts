import {
  satelliteCogTileRequestSchema,
  type SatelliteCogTileResult,
} from '@/infrastructure/satellite/SatelliteCogProtocol';
import { SatelliteCogRasterizer } from '@/infrastructure/satellite/SatelliteCogRasterizer';
import {
  type WorkerRpcEndpoint,
  WorkerRpcServer,
  type WorkerRpcTransferResult,
} from '@/infrastructure/runtime/WorkerRpc';

export const satelliteCogWorkerMethods = {
  renderTile: 'satellite-cog.render-tile',
} as const;

/** Validates worker messages and transfers rendered WebP tiles without copying them. */
export class SatelliteCogWorkerServer {
  readonly #rpc: WorkerRpcServer;
  readonly #rasterizer: Pick<SatelliteCogRasterizer, 'render'>;

  public constructor(
    endpoint: WorkerRpcEndpoint,
    rasterizer: Pick<SatelliteCogRasterizer, 'render'> = new SatelliteCogRasterizer(),
  ) {
    this.#rasterizer = rasterizer;
    this.#rpc = new WorkerRpcServer(endpoint, {
      [satelliteCogWorkerMethods.renderTile]: async (
        payload,
        { signal },
      ): Promise<WorkerRpcTransferResult> => {
        const request = satelliteCogTileRequestSchema.parse(payload);
        const data = await this.#rasterizer.render(request, signal);
        return {
          value: { data } satisfies SatelliteCogTileResult,
          transfer: [data],
        };
      },
    });
  }

  public dispose(): void {
    this.#rpc.dispose();
  }
}
