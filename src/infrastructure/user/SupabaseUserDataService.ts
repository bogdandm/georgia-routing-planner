import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';

import type {
  UserDataService,
  UserDataSnapshot,
  UserDataSyncProgress,
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
  userId: null,
  errorMessage: null,
  noticeMessage: null,
  status: 'loading',
  syncEnabled: false,
  syncStatus: 'idle',
  syncProgress: null,
  remoteTrackDeletions: [],
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
const deletionDecisionErrorMessage =
  'Unable to apply the track deletion decision. Your local tracks remain available.';

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
  #remoteDeletionDecisionInProgress = false;
  #disposed = false;
  #sessionRevision = 0;
  #syncPreferenceRevision = 0;
  #syncPreferenceRun: Promise<void> = Promise.resolve();
  #persistentStateRestored = false;
  #sessionRestored = false;
  #startupSyncHandled = false;

  public constructor(
    private readonly client: Pick<SupabaseClient, 'auth'>,
    private readonly database: AppDatabase,
    worker: TrackSyncWorkerClient | null = null,
  ) {
    this.#worker = worker;
    if (worker !== null) this.#bindWorker(worker);
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
    if (revision !== this.#syncPreferenceRevision) return;
    this.#setSnapshot({
      ...this.#snapshot,
      syncEnabled: enabled,
      syncStatus: enabled ? this.#snapshot.syncStatus : 'idle',
      syncProgress: enabled ? this.#snapshot.syncProgress : null,
      remoteTrackDeletions: enabled ? this.#snapshot.remoteTrackDeletions : [],
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
      syncProgress: null,
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

  public async resolveRemoteTrackDeletions(
    deleteTrackIds: readonly string[],
  ): Promise<void> {
    if (this.#disposed) return;
    const candidates = this.#snapshot.remoteTrackDeletions;
    const candidateIds = new Set(candidates.map((candidate) => candidate.trackId));
    const selected = new Set(deleteTrackIds);
    const sessionRevision = this.#sessionRevision;
    const userId = this.#snapshot.userId;
    if (userId === null) return;
    if (this.#remoteDeletionDecisionInProgress) return;
    this.#remoteDeletionDecisionInProgress = true;
    try {
      if (
        selected.size !== deleteTrackIds.length ||
        [...selected].some((trackId) => !candidateIds.has(trackId))
      ) {
        throw new Error('The deletion decision contains an unknown track.');
      }
      const restoreTrackIds = candidates.flatMap((candidate) =>
        selected.has(candidate.trackId) ? [] : [candidate.trackId],
      );
      this.#setSnapshot({
        ...this.#snapshot,
        busy: true,
        errorMessage: null,
      });
      await this.database.resolveRemoteTrackDeletions([...selected], restoreTrackIds);
      if (!this.#isDecisionCurrent(userId, sessionRevision)) return;
      this.#setSnapshot({
        ...this.#snapshot,
        busy: false,
        syncStatus: 'idle',
        remoteTrackDeletions: [],
        errorMessage: null,
      });
      for (const listener of this.#trackListeners) listener();
      if (this.#isDecisionCurrent(userId, sessionRevision)) {
        await this.synchronizeNow();
      }
    } catch {
      if (!this.#isDecisionCurrent(userId, sessionRevision)) return;
      this.#setSnapshot({
        ...this.#snapshot,
        busy: false,
        syncStatus: 'needs-action',
        errorMessage: deletionDecisionErrorMessage,
      });
    } finally {
      this.#remoteDeletionDecisionInProgress = false;
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
      if (this.#snapshot.syncEnabled) void this.synchronizeNow();
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
          userId: null,
          errorMessage: null,
          noticeMessage: registrationNotice,
          status: 'signed-out',
          syncStatus: 'idle',
          syncProgress: null,
          remoteTrackDeletions: [],
        });
        return;
      }
      this.#setSignedIn(data.session);
      if (this.#snapshot.syncEnabled) void this.synchronizeNow();
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
      syncStatus: 'idle',
      errorMessage: null,
      noticeMessage: null,
      syncProgress: null,
      remoteTrackDeletions: [],
    });
    this.#sessionRevision += 1;
    try {
      const { error } = await this.client.auth.signOut();
      if (error !== null) {
        this.#setError(
          signOutErrorMessage,
          this.#snapshot.email,
          this.#snapshot.userId,
        );
        return;
      }
      this.#setSignedIn(null);
    } catch {
      this.#setError(signOutErrorMessage, this.#snapshot.email, this.#snapshot.userId);
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
    } catch {
      // Closing a runtime during startup must not surface a rejected background task.
    } finally {
      this.#persistentStateRestored = true;
      this.#handleStartupSynchronization();
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
    } finally {
      this.#sessionRestored = true;
      this.#handleStartupSynchronization();
    }
  }

  async #runSynchronization(controller: AbortController): Promise<void> {
    const sessionRevision = this.#sessionRevision;
    try {
      const first = await this.client.auth.getSession();
      const initialSession = first.data.session;
      if (first.error !== null || initialSession === null) {
        throw new Error('No active session.');
      }
      if (
        !this.#isRunCurrent(controller, sessionRevision) ||
        initialSession.user.id !== this.#snapshot.userId
      ) {
        return;
      }
      const worker = this.#requireWorker();
      let result;
      try {
        result = await worker.synchronize(
          initialSession.user.id,
          initialSession.access_token,
          controller.signal,
        );
      } catch (error) {
        if (!isAuthExpiredWorkerError(error)) throw error;
        if (!this.#isRunCurrent(controller, sessionRevision)) return;
        const refreshed = await this.client.auth.getSession();
        const refreshedSession = refreshed.data.session;
        if (!this.#isRunCurrent(controller, sessionRevision)) return;
        if (refreshed.error !== null) {
          throw new Error('Unable to refresh the synchronization session.', {
            cause: error,
          });
        }
        if (refreshedSession?.user.id !== initialSession.user.id) {
          throw new Error('Unable to refresh the synchronization session.', {
            cause: error,
          });
        }
        result = await worker.synchronize(
          refreshedSession.user.id,
          refreshedSession.access_token,
          controller.signal,
        );
      }
      if (!this.#isRunCurrent(controller, sessionRevision)) return;
      this.#setSnapshot({
        ...this.#snapshot,
        busy: false,
        syncStatus: result.remoteTrackDeletions.length > 0 ? 'needs-action' : 'success',
        syncProgress: null,
        syncUsage: result.usage,
        remoteTrackDeletions: result.remoteTrackDeletions,
      });
    } catch (error) {
      if (!this.#isRunCurrent(controller, sessionRevision)) return;
      this.#setSnapshot({
        ...this.#snapshot,
        busy: false,
        syncStatus: 'error',
        syncProgress: null,
        errorMessage: isQuotaWorkerError(error)
          ? syncQuotaErrorMessage
          : (syncWorkerErrorMessage(error) ?? syncErrorMessage),
      });
    }
  }

  #handleAuthStateChange(event: AuthChangeEvent, session: Session | null): void {
    if (this.#disposed) return;
    const nextUserId = session?.user.id ?? null;
    const accountChanged = this.#snapshot.userId !== nextUserId;
    if (event === 'INITIAL_SESSION') {
      this.#sessionRevision += 1;
      if (accountChanged) {
        this.#resyncRequested = false;
        this.#syncAbort?.abort(
          new DOMException('Authentication account changed.', 'AbortError'),
        );
        this.#setSnapshot({
          ...this.#snapshot,
          syncStatus: 'idle',
          syncProgress: null,
          remoteTrackDeletions: [],
        });
      }
      this.#setSignedIn(session);
      this.#sessionRestored = true;
      this.#handleStartupSynchronization();
      return;
    }
    if (event === 'SIGNED_OUT' || accountChanged) {
      this.#resyncRequested = false;
      this.#syncAbort?.abort(
        new DOMException('Authentication account changed.', 'AbortError'),
      );
      this.#sessionRevision += 1;
      this.#setSnapshot({
        ...this.#snapshot,
        syncStatus: 'idle',
        syncProgress: null,
        remoteTrackDeletions: [],
      });
      this.#setSignedIn(session);
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      this.#setSignedIn(session);
    }
  }

  #beginOperation(): void {
    this.#resyncRequested = false;
    this.#syncAbort?.abort(
      new DOMException('Authentication operation started.', 'AbortError'),
    );
    this.#setSnapshot({
      ...this.#snapshot,
      busy: true,
      email: null,
      userId: null,
      errorMessage: null,
      noticeMessage: null,
      status: 'signed-out',
      syncStatus: 'idle',
      syncProgress: null,
      remoteTrackDeletions: [],
    });
  }

  #setError(
    errorMessage: string,
    email: string | null = null,
    userId: string | null = null,
  ): void {
    this.#setSnapshot({
      ...this.#snapshot,
      busy: false,
      email,
      userId,
      errorMessage,
      noticeMessage: null,
      status: 'error',
      syncStatus: 'idle',
      syncProgress: null,
      remoteTrackDeletions: [],
    });
  }

  #setSignedIn(session: Session | null): void {
    const email = session?.user.email ?? null;
    const userId = session?.user.id ?? null;
    this.#setSnapshot({
      ...this.#snapshot,
      busy: false,
      email,
      userId,
      errorMessage: null,
      noticeMessage: null,
      status: userId === null ? 'signed-out' : 'signed-in',
      syncStatus: userId === null ? 'idle' : this.#snapshot.syncStatus,
      syncProgress:
        userId === null || userId !== this.#snapshot.userId
          ? null
          : this.#snapshot.syncProgress,
      remoteTrackDeletions:
        userId === null || userId !== this.#snapshot.userId
          ? []
          : this.#snapshot.remoteTrackDeletions,
    });
  }

  #handleStartupSynchronization(): void {
    if (
      this.#startupSyncHandled ||
      !this.#persistentStateRestored ||
      !this.#sessionRestored
    ) {
      return;
    }
    this.#startupSyncHandled = true;
    if (this.#canSynchronize()) void this.synchronizeNow();
  }

  #bindWorker(worker: TrackSyncWorkerClient): void {
    worker.subscribeTracksChanged(() => {
      for (const listener of this.#trackListeners) listener();
    });
    worker.subscribeProgress((progress: UserDataSyncProgress) => {
      if (this.#snapshot.syncStatus !== 'syncing') return;
      this.#setSnapshot({ ...this.#snapshot, syncProgress: progress });
    });
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

  #isDecisionCurrent(userId: string, sessionRevision: number): boolean {
    return (
      !this.#disposed &&
      userId === this.#snapshot.userId &&
      sessionRevision === this.#sessionRevision
    );
  }

  #canSynchronize(): boolean {
    return (
      !this.#disposed &&
      this.#snapshot.syncEnabled &&
      this.#snapshot.userId !== null &&
      this.#snapshot.remoteTrackDeletions.length === 0
    );
  }

  #requireWorker(): TrackSyncWorkerClient {
    if (this.#worker !== null) return this.#worker;
    const worker = new TrackSyncWorkerClient();
    this.#bindWorker(worker);
    this.#worker = worker;
    return worker;
  }
}
