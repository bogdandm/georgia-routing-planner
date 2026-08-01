import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';

import type {
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';

const initialSnapshot: UserDataSnapshot = {
  busy: false,
  email: null,
  errorMessage: null,
  noticeMessage: null,
  status: 'loading',
};

const registrationNotice = 'Check your email to confirm your account, then sign in.';
const signInErrorMessage = 'Unable to sign in. Check your email and password.';
const signUpErrorMessage = 'Unable to create an account. Try again.';
const sessionErrorMessage = 'Unable to restore your account session.';
const signOutErrorMessage = 'Unable to sign out. Try again.';

/** Bridges the official Supabase session lifecycle to a serializable React snapshot. */
export class SupabaseUserDataService implements UserDataService {
  readonly #client: Pick<SupabaseClient, 'auth'>;
  readonly #listeners = new Set<() => void>();
  #snapshot = initialSnapshot;
  #unsubscribe: (() => void) | null = null;
  #disposed = false;
  #sessionRevision = 0;

  public constructor(client: Pick<SupabaseClient, 'auth'>) {
    this.#client = client;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      this.#handleAuthStateChange(event, session);
    });
    this.#unsubscribe = () => {
      data.subscription.unsubscribe();
    };
    void this.#restoreSession();
  }

  public getSnapshot(): UserDataSnapshot {
    return this.#snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public async signIn(email: string, password: string): Promise<void> {
    if (this.#disposed) return;
    this.#beginOperation();
    this.#sessionRevision += 1;
    try {
      const { data, error } = await this.#client.auth.signInWithPassword({
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
      const { data, error } = await this.#client.auth.signUp({ email, password });
      if (error !== null) {
        if (error.code === 'user_already_exists' || error.code === 'email_exists') {
          this.#setSnapshot({
            busy: false,
            email: null,
            errorMessage: null,
            noticeMessage: registrationNotice,
            status: 'signed-out',
          });
          return;
        }
        this.#setError(signUpErrorMessage);
        return;
      }
      if (data.session === null) {
        this.#setSnapshot({
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
    this.#setSnapshot({
      ...this.#snapshot,
      busy: true,
      errorMessage: null,
      noticeMessage: null,
    });
    this.#sessionRevision += 1;
    try {
      const { error } = await this.#client.auth.signOut();
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
    this.#sessionRevision += 1;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
    try {
      void this.#client.auth.dispose().catch(() => undefined);
    } catch {
      // Cleanup is best-effort; disposal must remain safe during teardown.
    }
  }

  async #restoreSession(): Promise<void> {
    const sessionRevision = this.#sessionRevision;
    try {
      const { data, error } = await this.#client.auth.getSession();
      if (sessionRevision !== this.#sessionRevision) return;
      if (error !== null) {
        this.#setError(sessionErrorMessage);
        return;
      }
      this.#setSignedIn(data.session);
    } catch {
      if (sessionRevision !== this.#sessionRevision) return;
      this.#setError(sessionErrorMessage);
    }
  }

  #handleAuthStateChange(event: AuthChangeEvent, session: Session | null): void {
    if (this.#disposed) return;
    if (
      event === 'INITIAL_SESSION' ||
      event === 'SIGNED_IN' ||
      event === 'SIGNED_OUT' ||
      event === 'TOKEN_REFRESHED'
    ) {
      this.#sessionRevision += 1;
      this.#setSignedIn(session);
    }
  }

  #beginOperation(): void {
    this.#setSnapshot({
      busy: true,
      email: null,
      errorMessage: null,
      noticeMessage: null,
      status: 'signed-out',
    });
  }

  #setError(errorMessage: string, email: string | null = null): void {
    this.#setSnapshot({
      busy: false,
      email,
      errorMessage,
      noticeMessage: null,
      status: 'error',
    });
  }

  #setSignedIn(session: Session | null): void {
    const email = session?.user.email ?? null;
    this.#setSnapshot(
      email === null
        ? {
            busy: false,
            email: null,
            errorMessage: null,
            noticeMessage: null,
            status: 'signed-out',
          }
        : {
            busy: false,
            email,
            errorMessage: null,
            noticeMessage: null,
            status: 'signed-in',
          },
    );
  }

  #setSnapshot(snapshot: UserDataSnapshot): void {
    if (this.#disposed) return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}
