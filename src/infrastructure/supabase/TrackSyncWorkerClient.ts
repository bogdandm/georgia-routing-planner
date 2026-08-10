import {
  WorkerRpcClient,
  type WorkerRpcEndpoint,
  type WorkerRpcRemoteError,
} from '@/infrastructure/runtime/WorkerRpc';
import type {
  RemoteMarkerDeletionCandidate,
  RemoteTrackDeletionCandidate,
  UserDataSyncProgress,
} from '@/application/user/UserDataService';

export const trackSyncWorkerMethods = {
  synchronize: 'track-sync.synchronize',
} as const;

export const trackSyncWorkerEventNames = {
  progress: 'track-sync.progress',
  tracksChanged: 'track-sync.tracks-changed',
  markersChanged: 'track-sync.markers-changed',
} as const;

export interface UserDataSyncChangedEvent {
  readonly userId: string;
  readonly sessionRevision: number;
}

export interface TrackSyncWorkerRequest {
  readonly accessToken: string;
  readonly userId: string;
  readonly sessionRevision: number;
}

export interface TrackSyncWorkerResult {
  readonly usage: {
    readonly usedBytes: number;
    readonly reservedBytes: number;
    readonly limitBytes: number;
  };
  readonly changed: { readonly tracks: boolean; readonly markers: boolean };
  readonly remoteTrackDeletions: readonly RemoteTrackDeletionCandidate[];
  readonly remoteMarkerDeletions: readonly RemoteMarkerDeletionCandidate[];
}

export class TrackSyncWorkerError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | 'auth-expired'
      | 'invalid-remote'
      | 'network'
      | 'quota'
      | 'limit'
      | 'revision-exhausted'
      | 'concurrent-change',
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
  if (typeof value !== 'object' || value === null) return false;
  const { completedItems, totalItems } = value as Record<string, unknown>;
  return (
    typeof completedItems === 'number' &&
    Number.isSafeInteger(completedItems) &&
    completedItems >= 0 &&
    typeof totalItems === 'number' &&
    Number.isSafeInteger(totalItems) &&
    totalItems >= 0 &&
    completedItems <= totalItems
  );
}

/** Owns the one worker channel used by the existing user-data service. */
export class TrackSyncWorkerClient {
  readonly #rpc: WorkerRpcClient;

  public constructor(workerFactory: TrackSyncWorkerFactory = defaultWorkerFactory) {
    this.#rpc = new WorkerRpcClient(workerFactory());
  }

  public synchronize(
    userId: string,
    accessToken: string,
    sessionRevision: number,
    signal: AbortSignal,
  ): Promise<TrackSyncWorkerResult> {
    return this.#rpc.request<TrackSyncWorkerResult>(
      trackSyncWorkerMethods.synchronize,
      { accessToken, userId, sessionRevision } satisfies TrackSyncWorkerRequest,
      signal,
    );
  }

  public subscribeTracksChanged(
    listener: (event: UserDataSyncChangedEvent) => void,
  ): () => void {
    return this.#rpc.subscribeEvent(
      trackSyncWorkerEventNames.tracksChanged,
      (payload) => {
        if (isSyncChangedEvent(payload)) listener(payload);
      },
    );
  }

  public subscribeMarkersChanged(
    listener: (event: UserDataSyncChangedEvent) => void,
  ): () => void {
    return this.#rpc.subscribeEvent(
      trackSyncWorkerEventNames.markersChanged,
      (payload) => {
        if (isSyncChangedEvent(payload)) listener(payload);
      },
    );
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

function isSyncChangedEvent(value: unknown): value is UserDataSyncChangedEvent {
  if (typeof value !== 'object' || value === null) return false;
  const { userId, sessionRevision } = value as Record<string, unknown>;
  return (
    typeof userId === 'string' &&
    userId.length > 0 &&
    userId.length <= 200 &&
    typeof sessionRevision === 'number' &&
    Number.isSafeInteger(sessionRevision) &&
    sessionRevision >= 0
  );
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
  if (code === 'limit') {
    return 'Cloud marker limit reached. Delete a synchronized marker and try again.';
  }
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
