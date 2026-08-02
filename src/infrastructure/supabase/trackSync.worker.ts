import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { WorkerRpcEndpoint } from '@/infrastructure/runtime/WorkerRpc';

import { TrackSyncWorkerServer } from './TrackSyncWorkerServer';

const workerLogger: DiagnosticLogger = {
  getEvents: () => [],
  log: () => undefined,
};

new TrackSyncWorkerServer(
  globalThis as unknown as WorkerRpcEndpoint,
  new AppDatabase(workerLogger),
);
