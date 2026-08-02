import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { SupabaseUserDataService } from '@/infrastructure/user/SupabaseUserDataService';
import type { TrackSyncWorkerClient } from '@/infrastructure/supabase/TrackSyncWorkerClient';

const database = {
  loadTrackSyncEnabled: vi.fn().mockResolvedValue(false),
  loadTrackSyncUsage: vi.fn().mockResolvedValue({
    usedBytes: 0,
    reservedBytes: 0,
    limitBytes: 8_388_608,
  }),
  saveTrackSyncEnabled: vi.fn().mockResolvedValue(undefined),
} as unknown as AppDatabase;
function session(email: string): Session {
  return {
    access_token: 'access-token',
    expires_at: 2_000_000_000,
    expires_in: 3_600,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    user: {
      app_metadata: {},
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00.000Z',
      email,
      id: 'user-id',
      user_metadata: {},
    },
  };
}

function createClient(options: { readonly restoredSession?: Session | null } = {}) {
  let callback: ((event: AuthChangeEvent, value: Session | null) => void) | null = null;
  const unsubscribe = vi.fn();
  const signInWithPassword = vi.fn().mockResolvedValue({
    data: { session: session('signed-in@example.test') },
    error: null,
  });
  const signUp = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const dispose = vi.fn().mockResolvedValue(undefined);
  const getSession = vi.fn().mockResolvedValue({
    data: { session: options.restoredSession ?? null },
    error: null,
  });
  const client = {
    auth: {
      getSession,
      dispose,
      onAuthStateChange: vi.fn(
        (nextCallback: (event: AuthChangeEvent, value: Session | null) => void) => {
          callback = nextCallback;
          return { data: { subscription: { unsubscribe } } };
        },
      ),
      signInWithPassword,
      signUp,
      signOut,
    },
  } as unknown as SupabaseClient;

  return {
    client,
    emit(event: AuthChangeEvent, value: Session | null) {
      callback?.(event, value);
    },
    getSession,
    signInWithPassword,
    signOut,
    signUp,
    dispose,
    unsubscribe,
  };
}

describe('SupabaseUserDataService', () => {
  it('restores a persisted session without exposing its tokens', async () => {
    const fake = createClient({ restoredSession: session('restored@example.test') });
    const service = new SupabaseUserDataService(fake.client, database);

    await vi.waitFor(() => {
      expect(service.getSnapshot()).toMatchObject({
        busy: false,
        email: 'restored@example.test',
        errorMessage: null,
        noticeMessage: null,
        status: 'signed-in',
      });
    });
    expect(fake.getSession).toHaveBeenCalledOnce();
  });

  it('uses password sign-in and normalizes authentication failures', async () => {
    const fake = createClient();
    fake.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Detailed server message'),
    });
    const service = new SupabaseUserDataService(fake.client, database);

    await service.signIn('user@example.test', 'password');

    expect(fake.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.test',
      password: 'password',
    });
    expect(service.getSnapshot()).toMatchObject({
      busy: false,
      email: null,
      errorMessage: 'Unable to sign in. Check your email and password.',
      status: 'error',
      noticeMessage: null,
    });
  });

  it('uses neutral confirmation for registration without a session', async () => {
    const fake = createClient();
    const service = new SupabaseUserDataService(fake.client, database);

    await service.signUp('existing-or-new@example.test', 'password');

    expect(fake.signUp).toHaveBeenCalledWith({
      email: 'existing-or-new@example.test',
      password: 'password',
    });
    expect(service.getSnapshot()).toMatchObject({
      busy: false,
      email: null,
      errorMessage: null,
      noticeMessage: 'Check your email to confirm your account, then sign in.',
      status: 'signed-out',
    });
  });

  it('enters the signed-in flow when registration returns a session', async () => {
    const fake = createClient();
    fake.signUp.mockResolvedValueOnce({
      data: { session: session('new@example.test') },
      error: null,
    });
    const service = new SupabaseUserDataService(fake.client, database);

    await service.signUp('new@example.test', 'password');

    expect(service.getSnapshot().email).toBe('new@example.test');
    expect(service.getSnapshot().status).toBe('signed-in');
  });

  it('does not reveal an existing registration address', async () => {
    const fake = createClient();
    fake.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: { code: 'email_exists' },
    });
    const service = new SupabaseUserDataService(fake.client, database);

    await service.signUp('existing@example.test', 'password');

    expect(service.getSnapshot().noticeMessage).toBe(
      'Check your email to confirm your account, then sign in.',
    );
    expect(service.getSnapshot().errorMessage).toBeNull();
  });

  it('disposes the auth client and subscription exactly once', () => {
    const fake = createClient();
    const service = new SupabaseUserDataService(fake.client, database);

    service.dispose();
    service.dispose();
    fake.emit('TOKEN_REFRESHED', session('refresh@example.test'));

    expect(fake.unsubscribe).toHaveBeenCalledOnce();
    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(service.getSnapshot().status).toBe('loading');
  });

  it('handles refresh and sign-out events', async () => {
    const fake = createClient();
    const service = new SupabaseUserDataService(fake.client, database);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    fake.emit('TOKEN_REFRESHED', session('refresh@example.test'));
    expect(service.getSnapshot().email).toBe('refresh@example.test');
    await service.signOut();
    expect(fake.signOut).toHaveBeenCalledOnce();
    expect(service.getSnapshot().status).toBe('signed-out');

    unsubscribe();
    expect(listener).toHaveBeenCalled();
  });

  it('queues one follow-up synchronization for lifecycle work during an active run', async () => {
    const fake = createClient({ restoredSession: session('sync@example.test') });
    let resolveFirst: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const synchronize = vi
      .fn()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValue({
        usage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
        changed: false,
      });
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);

    await vi.waitFor(() => {
      expect(service.getSnapshot().email).toBe('sync@example.test');
    });
    const enabled = service.setSyncEnabled(true);
    await vi.waitFor(() => {
      expect(synchronize).toHaveBeenCalledOnce();
    });
    const queued = service.trackMetadataChanged('local:track');
    resolveFirst?.();
    await enabled;
    await queued;

    await vi.waitFor(() => {
      expect(synchronize).toHaveBeenCalledTimes(2);
    });
    expect(synchronize).toHaveBeenCalledWith('access-token', expect.any(AbortSignal));
  });
});
