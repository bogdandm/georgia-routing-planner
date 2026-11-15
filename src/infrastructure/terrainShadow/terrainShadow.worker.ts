import type { WorkerRpcEndpoint } from '@/infrastructure/runtime/WorkerRpc';
import { TerrainShadowWorkerServer } from '@/infrastructure/terrainShadow/TerrainShadowWorkerServer';

new TerrainShadowWorkerServer(globalThis as unknown as WorkerRpcEndpoint);
