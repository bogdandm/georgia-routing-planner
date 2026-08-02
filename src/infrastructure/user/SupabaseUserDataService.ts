import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';

import type {
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';
import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import {
  isAuthExpiredWorkerError,
  isQuotaWorkerError,
  TrackSyncWorkerClient,
  syncWorkerErrorMessage,
} from '@/infrastructure/supabase/TrackSyncWorkerClient';

const emptyUsage = { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 };
const initialSnapshot: UserDataSnapshot = {
  busy: false,
  email: null,
  errorMessage: null,
  noticeMessage: null,
  status: 'loading',
  syncEnabled: false,
  syncStatus: 'idle',
  syncUsage: emptyUsage,
};
const registrationNotice = 'Check your email to confirm your account, then sign in.';
const signInErrorMessage = 'Unable to sign in. Check your email and password.';
const signUpErrorMessage = 'Unable to create an account. Try again.';
const sessionErrorMessage = 'Unable to restore your account session.';
const signOutErrorMessage = 'Unable to sign out. Try again.';
const syncErrorMessage =
  'Synchronization could not finish. Your local tracks remain available.';
const syncQuotaErrorMessage =
  'Cloud track storage is full. Delete a synchronized track and try again.';
const syncPreferenceErrorMessage =
  'Unable to update synchronization. Your previous setting is unchanged.';

/** Bridges session lifecycle and one cancellable worker run to the serializable UI snapshot. */
export class SupabaseUserDataService implements UserDataService {
  readonly #listeners = new Set<() => void>();
  readonly #trackListeners = new Set<() => void>();
  #worker: TrackSyncWorkerClient | null;
  #snapshot = initialSnapshot;
  #unsubscribe: (() => void) | null = null;
  #syncAbort: AbortController | null = null;
  #syncRun: Promise<void> | null = null;
  #resyncRequested = false;
  #disposed = false;
  #sessionRevision = 0;
  #syncPreferenceRevision = 0;
  #syncPreferenceRun: Promise<void> = Promise.resolve();

  public constructor(
    private readonly client: Pick<SupabaseClient, 'auth'>,
    private readonly database: AppDatabase,
    worker: TrackSyncWorkerClient | null = null,
  ) {
    this.#worker = worker;
    worker?.subscribeTracksChanged(() => {
      for (const listener of this.#trackListeners) listener();
    });
    const { data } = client.auth.onAuthStateChange((event, session) => {
      this.#handleAuthStateChange(event, session);
    });
    this.#unsubscribe = () => {
      data.subscription.unsubscribe();
    };
    void this.#restorePersistentState();
    void this.#restoreSession();
  }

  public getSnapshot(): UserDataSnapshot {
    return this.#snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public subscribeTracksChanged(listener: () => void): () => void {
    this.#trackListeners.add(listener);
    return () => this.#trackListeners.delete(listener);
  }

  public async setSyncEnabled(enabled: boolean): Promise<void> {
    if (this.#disposed) return;
    const revision = ++this.#syncPreferenceRevision;
    const save = this.#syncPreferenceRun.then(() =>
      this.database.saveTrackSyncEnabled(enabled),
    );
    this.#syncPreferenceRun = save.catch(() => undefined);
    try {
      await save;
    } catch {
      if (revision === this.#syncPreferenceRevision) {
        this.#setSnapshot({
          ...this.#snapshot,
          errorMessage: syncPreferenceErrorMessage,
        });
      }
      return;
    }
    if (this.#disposed || revision !== this.#syncPreferenceRevision) return;
    this.#setSnapshot({
      ...this.#snapshot,
      syncEnabled: enabled,
      syncStatus: enabled ? this.#snapshot.syncStatus : 'idle',
      errorMessage: enabled ? this.#snapshot.errorMessage : null,
    });
    if (!enabled) {
      this.#resyncRequested = false;
      this.#syncAbort?.abort(
        new DOMException('Synchronization disabled.', 'AbortError'),
      );
      return;
    }
    await this.synchronizeNow();
  }

  public async synchronizeNow(): Promise<void> {
    if (!this.#canSynchronize()) return;
    if (this.#syncRun !== null) {
      this.#resyncRequested = true;
      return this.#syncRun;
    }
    const controller = new AbortController();
    this.#syncAbort = controller;
    this.#setSnapshot({
      ...this.#snapshot,
      busy: true,
      syncStatus: 'syncing',
      errorMessage: null,
    });
    const run = this.#runSynchronization(controller);
    this.#syncRun = run;
    try {
      await run;
    } finally {
      if (this.#syncRun === run) this.#syncRun = null;
      if (this.#syncAbort === controller) this.#syncAbort = null;
      const shouldResynchronize = this.#resyncRequested && this.#canSynchronize();
      this.#resyncRequested = false;
      if (shouldResynchronize) void this.synchronizeNow();
    }
  }

  public async trackSaved(_trackId: string): Promise<void> {
    await this.synchronizeNow();
  }
  public async trackMetadataChanged(_trackId: string): Promise<void> {
    await this.synchronizeNow();
  }
  public async trackDeleted(_trackId: string): Promise<void> {
    await this.synchronizeNow();
  }

  public async signIn(email: string, password: string): Promise<void> {
    if (this.#disposed) return;
    this.#beginOperation();
    this.#sessionRevision += 1;
    try {
      const { data, error } = await this.client.auth.signInWithPassword({
        email,
        password,
      });
      if (error !== null) {
        this.#setError(signInErrorMessage);
        return;
      }
      this.#setSignedIn(data.session);
    } catch {
      this.#setError(signInErrorMessage);
    }
  }

  public async signUp(email: string, password: string): Promise<void> {
    if (this.#disposed) return;
    this.#beginOperation();
    this.#sessionRevision += 1;
    try {
      const { data, error } = await this.client.auth.signUp({ email, password });
      if (
        error !== null &&
        error.code !== 'user_already_exists' &&
        error.code !== 'email_exists'
      ) {
        this.#setError(signUpErrorMessage);
        return;
      }
      if (error !== null || data.session === null) {
        this.#setSnapshot({
          ...this.#snapshot,
          busy: false,
          email: null,
          errorMessage: null,
          noticeMessage: registrationNotice,
          status: 'signed-out',
        });
        return;
      }
      this.#setSignedIn(data.session);
    } catch {
      this.#setError(signUpErrorMessage);
    }
  }

  public async signOut(): Promise<void> {
    if (this.#disposed) return;
    this.#resyncRequested = false;
    this.#syncAbort?.abort(new DOMException('Signed out.', 'AbortError'));
    this.#setSnapshot({
      ...this.#snapshot,
      busy: true,
      errorMessage: null,
      noticeMessage: null,
    });
    this.#sessionRevision += 1;
    try {
      const { error } = await this.client.auth.signOut();
      if (error !== null) {
        this.#setError(signOutErrorMessage, this.#snapshot.email);
        return;
      }
      this.#setSignedIn(null);
    } catch {
      this.#setError(signOutErrorMessage, this.#snapshot.email);
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#resyncRequested = false;
    this.#syncAbort?.abort(new DOMException('Service disposed.', 'AbortError'));
    this.#unsubscribe?.();
    this.#worker?.dispose();
    try {
      void this.client.auth.dispose().catch(() => undefined);
    } catch {
      /* teardown */
    }
  }

  async #restorePersistentState(): Promise<void> {
    try {
      const [syncEnabled, syncUsage] = await Promise.all([
        this.database.loadTrackSyncEnabled(),
        this.database.loadTrackSyncUsage(),
      ]);
      if (this.#disposed) return;
      this.#setSnapshot({ ...this.#snapshot, syncEnabled, syncUsage });
      if (syncEnabled && this.#snapshot.email !== null) {
        void this.synchronizeNow();
      }
    } catch {
      // Closing a runtime during startup must not surface a rejected background task.
    }
  }

  async #restoreSession(): Promise<void> {
    const revision = this.#sessionRevision;
    try {
      const { data, error } = await this.client.auth.getSession();
      if (revision !== this.#sessionRevision) return;
      if (error !== null) {
        this.#setError(sessionErrorMessage);
        return;
      }
      this.#setSignedIn(data.session);
    } catch {
      if (revision === this.#sessionRevision) this.#setError(sessionErrorMessage);
    }
  }

  async #runSynchronization(controller: AbortController): Promise<void> {
    try {
      const sessionRevision = this.#sessionRevision;
      const first = await this.client.auth.getSession();
      const initialSession = first.data.session;
      if (first.error !== null || initialSession === null) {
        throw new Error('No active session.');
      }
      const worker = this.#requireWorker();
      let result;
      try {
        result = await worker.synchronize(
          initialSession.access_token,
          controller.signal,
        );
      } catch (error) {
        if (!isAuthExpiredWorkerError(error)) throw error;
        if (!this.#isRunCurrent(controller, sessionRevision)) return;
        const refreshed = await this.client.auth.getSession();
        const refreshedSession = refreshed.data.session;
        if (
          refreshed.error !== null ||
          !this.#isRunCurrent(controller, sessionRevision)
        ) {
          return;
        }
        if (refreshedSession === null) return;
        if (refreshedSession.user.id !== initialSession.user.id) return;
        result = await worker.synchronize(
          refreshedSession.access_token,
          controller.signal,
        );
      }
      if (controller.signal.aborted || this.#disposed) {
        this.#setSnapshot({ ...this.#snapshot, busy: false, syncStatus: 'idle' });
        return;
      }
      this.#setSnapshot({
        ...this.#snapshot,
        busy: false,
        syncStatus: 'success',
        syncUsage: result.usage,
      });
    } catch (error) {
      if (controller.signal.aborted || this.#disposed) {
        this.#setSnapshot({ ...this.#snapshot, busy: false, syncStatus: 'idle' });
        return;
      }
      this.#setSnapshot({
        ...this.#snapshot,
        busy: false,
        syncStatus: 'error',
        errorMessage: isQuotaWorkerError(error)
          ? syncQuotaErrorMessage
          : (syncWorkerErrorMessage(error) ?? syncErrorMessage),
      });
    }
  }

  #handleAuthStateChange(event: AuthChangeEvent, session: Session | null): void {
    if (this.#disposed) return;
    if (event === 'SIGNED_OUT') {
      this.#resyncRequested = false;
      this.#syncAbort?.abort(new DOMException('Signed out.', 'AbortError'));
    }
    if (
      event === 'INITIAL_SESSION' ||
      event === 'SIGNED_IN' ||
      event === 'SIGNED_OUT' ||
      event === 'TOKEN_REFRESHED'
    ) {
      this.#syncAbort?.abort(
        new DOMException('Authentication session changed.', 'AbortError'),
      );
      this.#sessionRevision += 1;
      this.#setSignedIn(session);
    }
  }

  #beginOperation(): void {
    this.#setSnapshot({
      ...this.#snapshot,
      busy: true,
      email: null,
      errorMessage: null,
      noticeMessage: null,
      status: 'signed-out',
    });
  }
  #setError(errorMessage: string, email: string | null = null): void {
    this.#setSnapshot({
      ...this.#snapshot,
      busy: false,
      email,
      errorMessage,
      noticeMessage: null,
      status: 'error',
    });
  }
  #setSignedIn(session: Session | null): void {
    const email = session?.user.email ?? null;
    this.#setSnapshot({
      ...this.#snapshot,
      busy: false,
      email,
      errorMessage: null,
      noticeMessage: null,
      status: email === null ? 'signed-out' : 'signed-in',
      syncStatus: email === null ? 'idle' : this.#snapshot.syncStatus,
    });
    if (email !== null && this.#snapshot.syncEnabled) void this.synchronizeNow();
  }
  #setSnapshot(snapshot: UserDataSnapshot): void {
    if (this.#disposed) return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }

  #isRunCurrent(controller: AbortController, sessionRevision: number): boolean {
    return (
      !controller.signal.aborted &&
      !this.#disposed &&
      sessionRevision === this.#sessionRevision
    );
  }

  #canSynchronize(): boolean {
    return (
      !this.#disposed && this.#snapshot.syncEnabled && this.#snapshot.email !== null
    );
  }

  #requireWorker(): TrackSyncWorkerClient {
    if (this.#worker !== null) return this.#worker;
    const worker = new TrackSyncWorkerClient();
    worker.subscribeTracksChanged(() => {
      for (const listener of this.#trackListeners) listener();
    });
    this.#worker = worker;
    return worker;
  }
}
