import { TerrainComputeWorkerServer } from '@/infrastructure/elevation/TerrainComputeWorkerServer';
import type { WorkerRpcEndpoint } from '@/infrastructure/runtime/WorkerRpc';

new TerrainComputeWorkerServer(globalThis as unknown as WorkerRpcEndpoint);
