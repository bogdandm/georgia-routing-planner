import {
  WorkerRpcClient,
  type WorkerRpcEndpoint,
  type WorkerRpcRemoteError,
} from '@/infrastructure/runtime/WorkerRpc';
import type { UserDataSyncProgress } from '@/application/user/UserDataService';

export const trackSyncWorkerMethods = {
  synchronize: 'track-sync.synchronize',
} as const;

export const trackSyncWorkerEventNames = {
  progress: 'track-sync.progress',
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
function isSyncProgress(value: unknown): value is UserDataSyncProgress {
  return (
    typeof value === 'object' &&
    value !== null &&
    'completedTracks' in value &&
    typeof value.completedTracks === 'number' &&
    Number.isFinite(value.completedTracks) &&
    Number.isInteger(value.completedTracks) &&
    value.completedTracks >= 0 &&
    'totalTracks' in value &&
    typeof value.totalTracks === 'number' &&
    Number.isFinite(value.totalTracks) &&
    Number.isInteger(value.totalTracks) &&
    value.totalTracks >= 0 &&
    value.completedTracks <= value.totalTracks
  );
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

  public subscribeProgress(
    listener: (progress: UserDataSyncProgress) => void,
  ): () => void {
    return this.#rpc.subscribeEvent(trackSyncWorkerEventNames.progress, (payload) => {
      if (isSyncProgress(payload)) listener(payload);
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

export function syncWorkerErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const code = (error as WorkerRpcRemoteError).code;
  if (
    code !== 'auth-expired' &&
    code !== 'invalid-remote' &&
    code !== 'network' &&
    code !== 'quota'
  ) {
    return null;
  }
  return error.message.length <= 200 ? error.message : null;
}
