import type { WorkerRpcEndpoint } from '@/infrastructure/runtime/WorkerRpc';
import { SatelliteCogWorkerServer } from '@/infrastructure/satellite/SatelliteCogWorkerServer';

new SatelliteCogWorkerServer(globalThis as unknown as WorkerRpcEndpoint);
