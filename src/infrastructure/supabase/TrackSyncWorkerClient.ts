import {
  WorkerRpcClient,
  type WorkerRpcEndpoint,
  type WorkerRpcRemoteError,
} from '@/infrastructure/runtime/WorkerRpc';

export const trackSyncWorkerMethods = {
  synchronize: 'track-sync.synchronize',
} as const;

export const trackSyncWorkerEventNames = {
  tracksChanged: 'track-sync.tracks-changed',
} as const;

export interface TrackSyncWorkerRequest {
  readonly accessToken: string;
}

export interface TrackSyncWorkerResult {
  readonly usage: {
    readonly usedBytes: number;
    readonly reservedBytes: number;
    readonly limitBytes: number;
  };
  readonly changed: boolean;
}

export class TrackSyncWorkerError extends Error {
  public constructor(
    message: string,
    public readonly code: 'auth-expired' | 'invalid-remote' | 'network' | 'quota',
  ) {
    super(message);
    this.name = 'TrackSyncWorkerError';
  }
}

type TrackSyncWorkerFactory = () => WorkerRpcEndpoint;

function defaultWorkerFactory(): WorkerRpcEndpoint {
  return new Worker(new URL('./trackSync.worker.ts', import.meta.url), {
    type: 'module',
    name: 'track-sync',
  });
}

/** Owns the one worker channel used by the existing user-data service. */
export class TrackSyncWorkerClient {
  readonly #rpc: WorkerRpcClient;

  public constructor(workerFactory: TrackSyncWorkerFactory = defaultWorkerFactory) {
    this.#rpc = new WorkerRpcClient(workerFactory());
  }

  public synchronize(
    accessToken: string,
    signal: AbortSignal,
  ): Promise<TrackSyncWorkerResult> {
    return this.#rpc.request<TrackSyncWorkerResult>(
      trackSyncWorkerMethods.synchronize,
      { accessToken } satisfies TrackSyncWorkerRequest,
      signal,
    );
  }

  public subscribeTracksChanged(listener: () => void): () => void {
    return this.#rpc.subscribeEvent(trackSyncWorkerEventNames.tracksChanged, () => {
      listener();
    });
  }

  public dispose(): void {
    this.#rpc.dispose();
  }
}

export function isAuthExpiredWorkerError(error: unknown): boolean {
  return (
    error instanceof Error && (error as WorkerRpcRemoteError).code === 'auth-expired'
  );
}

export function isQuotaWorkerError(error: unknown): boolean {
  return error instanceof Error && (error as WorkerRpcRemoteError).code === 'quota';
}
