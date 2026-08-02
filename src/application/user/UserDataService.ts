export type UserDataStatus =
  'unconfigured' | 'loading' | 'signed-out' | 'signed-in' | 'error';

export type UserDataSyncStatus = 'idle' | 'syncing' | 'error';

export interface UserDataSnapshot {
  readonly busy: boolean;
  readonly email: string | null;
  readonly errorMessage: string | null;
  readonly noticeMessage: string | null;
  readonly status: UserDataStatus;
  readonly syncEnabled: boolean;
  readonly syncStatus: UserDataSyncStatus;
  readonly syncUsage: {
    readonly limitBytes: number;
    readonly reservedBytes: number;
    readonly usedBytes: number;
  };
}

/** Owns browser authentication state and the official persisted Supabase session. */
export interface UserDataService {
  getSnapshot(): UserDataSnapshot;
  subscribe(listener: () => void): () => void;
  setSyncEnabled(enabled: boolean): Promise<void>;
  synchronizeNow(): Promise<void>;
  trackSaved(trackId: string): Promise<void>;
  trackMetadataChanged(trackId: string): Promise<void>;
  trackDeleted(trackId: string): Promise<void>;
  subscribeTracksChanged(listener: () => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  dispose(): void;
}

export const unconfiguredUserDataSnapshot: UserDataSnapshot = {
  busy: false,
  email: null,
  errorMessage: null,
  noticeMessage: null,
  status: 'unconfigured',
  syncEnabled: false,
  syncStatus: 'idle',
  syncUsage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
};

/** A deterministic, side-effect-free service for builds and tests without configuration. */
export function createUnconfiguredUserDataService(): UserDataService {
  return {
    dispose: () => undefined,
    getSnapshot: () => unconfiguredUserDataSnapshot,
    setSyncEnabled: () => Promise.resolve(),
    signIn: () => Promise.resolve(),
    signUp: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
    subscribeTracksChanged: () => () => undefined,
    synchronizeNow: () => Promise.resolve(),
    trackDeleted: () => Promise.resolve(),
    trackMetadataChanged: () => Promise.resolve(),
    trackSaved: () => Promise.resolve(),
  };
}
