import { RoutingWorkerServer } from '@/infrastructure/routing/RoutingWorkerServer';
import type { WorkerRpcEndpoint } from '@/infrastructure/runtime/WorkerRpc';

new RoutingWorkerServer(globalThis as unknown as WorkerRpcEndpoint);
