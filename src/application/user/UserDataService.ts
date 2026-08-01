export type UserDataStatus =
  'unconfigured' | 'loading' | 'signed-out' | 'signed-in' | 'error';

export interface UserDataSnapshot {
  readonly busy: boolean;
  readonly email: string | null;
  readonly errorMessage: string | null;
  readonly noticeMessage: string | null;
  readonly status: UserDataStatus;
}

/** Owns browser authentication state and the official persisted Supabase session. */
export interface UserDataService {
  getSnapshot(): UserDataSnapshot;
  subscribe(listener: () => void): () => void;
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
};

/** A deterministic, side-effect-free service for builds and tests without configuration. */
export function createUnconfiguredUserDataService(): UserDataService {
  return {
    dispose: () => undefined,
    getSnapshot: () => unconfiguredUserDataSnapshot,
    signIn: () => Promise.resolve(),
    signUp: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}
