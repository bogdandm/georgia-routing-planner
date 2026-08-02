import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { SupabaseUserDataService } from '@/infrastructure/user/SupabaseUserDataService';
import type { TrackSyncWorkerClient } from '@/infrastructure/supabase/TrackSyncWorkerClient';
import { TrackSyncWorkerError } from '@/infrastructure/supabase/TrackSyncWorkerClient';

const database = {
  loadTrackSyncEnabled: vi.fn().mockResolvedValue(false),
  loadTrackSyncUsage: vi.fn().mockResolvedValue({
    usedBytes: 0,
    reservedBytes: 0,
    limitBytes: 8_388_608,
  }),
  saveTrackSyncEnabled: vi.fn().mockResolvedValue(undefined),
} as unknown as AppDatabase;
const emptyUsage = { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 } as const;
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

beforeEach(() => {
  vi.clearAllMocks();
  database.loadTrackSyncEnabled = vi.fn().mockResolvedValue(false);
  database.loadTrackSyncUsage = vi.fn().mockResolvedValue({
    usedBytes: 0,
    reservedBytes: 0,
    limitBytes: 8_388_608,
  });
  database.saveTrackSyncEnabled = vi.fn().mockResolvedValue(undefined);
});

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

  it('does not start synchronization for a restored session while disabled', async () => {
    const fake = createClient({ restoredSession: session('disabled@example.test') });
    const synchronize = vi.fn();
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);

    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    expect(service.getSnapshot().syncEnabled).toBe(false);
    expect(synchronize).not.toHaveBeenCalled();
    service.dispose();
  });

  it('serializes rapid synchronization preference changes in user order', async () => {
    const fake = createClient({ restoredSession: session('toggle@example.test') });
    let resolveFirstSave: (() => void) | null = null;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    database.saveTrackSyncEnabled = vi
      .fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(undefined);
    const synchronize = vi.fn();
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    const enabling = service.setSyncEnabled(true);
    const disabling = service.setSyncEnabled(false);
    await vi.waitFor(() => {
      expect(database.saveTrackSyncEnabled).toHaveBeenCalledTimes(1);
    });
    resolveFirstSave?.();
    await Promise.all([enabling, disabling]);

    expect(database.saveTrackSyncEnabled).toHaveBeenNthCalledWith(1, true);
    expect(database.saveTrackSyncEnabled).toHaveBeenNthCalledWith(2, false);
    expect(service.getSnapshot()).toMatchObject({
      syncEnabled: false,
      syncStatus: 'idle',
    });
    expect(synchronize).not.toHaveBeenCalled();
    service.dispose();
  });

  it('aborts an active synchronization when synchronization is disabled', async () => {
    const fake = createClient({ restoredSession: session('abort@example.test') });
    const synchronize = vi.fn(
      (_accessToken: string, signal: AbortSignal) =>
        new Promise<{ usage: typeof emptyUsage; changed: boolean }>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve({ usage: emptyUsage, changed: false });
            },
            { once: true },
          );
        }),
    );
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    const enabling = service.setSyncEnabled(true);
    await vi.waitFor(() => {
      expect(synchronize).toHaveBeenCalledOnce();
    });
    await service.setSyncEnabled(false);
    await enabling;

    expect(synchronize.mock.calls[0]?.[1].aborted).toBe(true);
    expect(service.getSnapshot().syncStatus).toBe('idle');
    service.dispose();
  });

  it('aborts an active synchronization when the account signs out', async () => {
    const activeSession = session('signout-abort@example.test');
    const fake = createClient({ restoredSession: activeSession });
    const synchronize = vi.fn(
      (_accessToken: string, signal: AbortSignal) =>
        new Promise<{ usage: typeof emptyUsage; changed: boolean }>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve({ usage: emptyUsage, changed: false });
            },
            { once: true },
          );
        }),
    );
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    const enabling = service.setSyncEnabled(true);
    await vi.waitFor(() => {
      expect(synchronize).toHaveBeenCalledOnce();
    });
    fake.emit('SIGNED_OUT', null);
    await enabling;

    expect(synchronize.mock.calls[0]?.[1].aborted).toBe(true);
    expect(service.getSnapshot()).toMatchObject({
      email: null,
      status: 'signed-out',
      syncStatus: 'idle',
    });
    service.dispose();
  });

  it('surfaces a quota-specific synchronization error', async () => {
    const fake = createClient({ restoredSession: session('quota@example.test') });
    const synchronize = vi
      .fn()
      .mockRejectedValue(new TrackSyncWorkerError('Quota exceeded.', 'quota'));
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    await service.setSyncEnabled(true);

    expect(service.getSnapshot()).toMatchObject({
      syncStatus: 'error',
      errorMessage:
        'Cloud track storage is full. Delete a synchronized track and try again.',
    });
    service.dispose();
  });

  it('surfaces the bounded worker reason for a server failure', async () => {
    const fake = createClient({ restoredSession: session('server@example.test') });
    const synchronize = vi
      .fn()
      .mockRejectedValue(
        new TrackSyncWorkerError(
          'Cloud synchronization request failed (500/internal_error).',
          'network',
        ),
      );
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    await service.setSyncEnabled(true);

    expect(service.getSnapshot()).toMatchObject({
      syncStatus: 'error',
      errorMessage: 'Cloud synchronization request failed (500/internal_error).',
    });
    service.dispose();
  });

  it('refreshes an expired worker token exactly once', async () => {
    const initialSession = session('refresh-sync@example.test');
    const refreshedSession = {
      ...initialSession,
      access_token: 'refreshed-access-token',
    };
    const fake = createClient({ restoredSession: initialSession });
    fake.getSession
      .mockResolvedValueOnce({ data: { session: initialSession }, error: null })
      .mockResolvedValueOnce({ data: { session: initialSession }, error: null })
      .mockResolvedValueOnce({ data: { session: refreshedSession }, error: null });
    const synchronize = vi
      .fn()
      .mockRejectedValueOnce(new TrackSyncWorkerError('Expired.', 'auth-expired'))
      .mockResolvedValue({ usage: emptyUsage, changed: false });
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    await service.setSyncEnabled(true);

    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(synchronize).toHaveBeenNthCalledWith(
      1,
      'access-token',
      expect.any(AbortSignal),
    );
    expect(synchronize).toHaveBeenNthCalledWith(
      2,
      'refreshed-access-token',
      expect.any(AbortSignal),
    );
    expect(fake.getSession).toHaveBeenCalledTimes(3);
    expect(service.getSnapshot().syncStatus).toBe('success');
    service.dispose();
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
