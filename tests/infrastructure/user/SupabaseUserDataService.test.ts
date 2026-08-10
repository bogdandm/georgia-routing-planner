import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDataSyncProgress } from '@/application/user/UserDataService';

import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { SupabaseUserDataService } from '@/infrastructure/user/SupabaseUserDataService';
import type {
  TrackSyncWorkerClient,
  TrackSyncWorkerResult,
} from '@/infrastructure/supabase/TrackSyncWorkerClient';
import { TrackSyncWorkerError } from '@/infrastructure/supabase/TrackSyncWorkerClient';

const database = {
  loadTrackSyncEnabled: vi.fn().mockResolvedValue(false),
  loadTrackSyncUsage: vi.fn().mockResolvedValue({
    usedBytes: 0,
    reservedBytes: 0,
    limitBytes: 8_388_608,
  }),
  saveTrackSyncEnabled: vi.fn().mockResolvedValue(undefined),
  resolveRemoteDeletions: vi.fn().mockResolvedValue(undefined),
} as unknown as AppDatabase;
const emptyUsage = { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 } as const;
function session(email: string, userId = 'user-id'): Session {
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
      id: userId,
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
  database.resolveRemoteDeletions = vi.fn().mockResolvedValue(undefined);
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
        userId: 'user-id',
        status: 'signed-in',
      });
    });
    expect(fake.getSession).toHaveBeenCalledOnce();
  });

  it('keeps a valid email-less session signed in by its authenticated user ID', async () => {
    const restored = session('email@example.test');
    const { email: _, ...userWithoutEmail } = restored.user;
    const fake = createClient({
      restoredSession: { ...restored, user: userWithoutEmail },
    });
    const service = new SupabaseUserDataService(fake.client, database);

    await vi.waitFor(() => {
      expect(service.getSnapshot()).toMatchObject({
        email: null,
        userId: 'user-id',
        status: 'signed-in',
      });
    });
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
      subscribeProgress: vi.fn(),
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
    let resolveFirstSave: () => void = () => undefined;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    const saveTrackSyncEnabled = vi
      .fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(undefined);
    database.saveTrackSyncEnabled = saveTrackSyncEnabled;
    const synchronize = vi.fn();
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    const enabling = service.setSyncEnabled(true);
    const disabling = service.setSyncEnabled(false);
    await vi.waitFor(() => {
      expect(saveTrackSyncEnabled).toHaveBeenCalledTimes(1);
    });
    resolveFirstSave();
    await Promise.all([enabling, disabling]);

    expect(saveTrackSyncEnabled).toHaveBeenNthCalledWith(1, true);
    expect(saveTrackSyncEnabled).toHaveBeenNthCalledWith(2, false);
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
      (
        _userId: string,
        _accessToken: string,
        _sessionRevision: number,
        signal: AbortSignal,
      ) =>
        new Promise<TrackSyncWorkerResult>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve({
                usage: emptyUsage,
                changed: { tracks: false, markers: false },
                remoteTrackDeletions: [],
                remoteMarkerDeletions: [],
              });
            },
            { once: true },
          );
        }),
    );
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
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

    expect(synchronize.mock.calls[0]?.[3].aborted).toBe(true);
    expect(service.getSnapshot().syncStatus).toBe('idle');
    service.dispose();
  });

  it('aborts an active synchronization when the account signs out', async () => {
    const activeSession = session('signout-abort@example.test');
    const fake = createClient({ restoredSession: activeSession });
    const synchronize = vi.fn(
      (
        _userId: string,
        _accessToken: string,
        _sessionRevision: number,
        signal: AbortSignal,
      ) =>
        new Promise<TrackSyncWorkerResult>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve({
                usage: emptyUsage,
                changed: { tracks: false, markers: false },
                remoteTrackDeletions: [],
                remoteMarkerDeletions: [],
              });
            },
            { once: true },
          );
        }),
    );
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
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

    expect(synchronize.mock.calls[0]?.[3].aborted).toBe(true);
    expect(service.getSnapshot()).toMatchObject({
      email: null,
      userId: null,
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
      subscribeProgress: vi.fn(),
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
      subscribeProgress: vi.fn(),
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
      .mockResolvedValue({
        usage: emptyUsage,
        changed: { tracks: false, markers: false },
        remoteTrackDeletions: [],
        remoteMarkerDeletions: [],
      });
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
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
      'user-id',
      'access-token',
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(synchronize).toHaveBeenNthCalledWith(
      2,
      'user-id',
      'refreshed-access-token',
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(fake.getSession).toHaveBeenCalledTimes(3);
    expect(service.getSnapshot().syncStatus).toBe('success');
    service.dispose();
  });

  it('fails synchronization when an expired token has no refreshed session', async () => {
    const initialSession = session('expired-sync@example.test');
    const fake = createClient({ restoredSession: initialSession });
    fake.getSession
      .mockResolvedValueOnce({ data: { session: initialSession }, error: null })
      .mockResolvedValueOnce({ data: { session: initialSession }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: null });
    const synchronize = vi
      .fn()
      .mockRejectedValue(new TrackSyncWorkerError('Expired.', 'auth-expired'));
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    await vi.waitFor(() => {
      expect(service.getSnapshot().status).toBe('signed-in');
    });

    await service.setSyncEnabled(true);

    expect(synchronize).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toMatchObject({
      busy: false,
      syncStatus: 'error',
      errorMessage:
        'Synchronization could not finish. Your local tracks and markers remain available.',
    });
    service.dispose();
  });

  it('resolves remote deletion candidates and synchronizes restored tracks', async () => {
    database.loadTrackSyncEnabled = vi.fn().mockResolvedValue(true);
    const fake = createClient({ restoredSession: session('decision@example.test') });
    const resolveRemoteTrackDeletions = vi.fn().mockResolvedValue(undefined);
    database.resolveRemoteDeletions = resolveRemoteTrackDeletions;
    const synchronize = vi
      .fn()
      .mockResolvedValueOnce({
        usage: emptyUsage,
        changed: { tracks: false, markers: false },
        remoteTrackDeletions: [
          { trackId: 'local:delete', name: 'Delete' },
          { trackId: 'local:restore', name: 'Restore' },
        ],
        remoteMarkerDeletions: [],
      })
      .mockResolvedValue({
        usage: emptyUsage,
        changed: { tracks: true, markers: false },
        remoteTrackDeletions: [],
        remoteMarkerDeletions: [],
      });
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);
    const changed = vi.fn();
    service.subscribeTracksChanged(changed);

    await vi.waitFor(() => {
      expect(service.getSnapshot().syncStatus).toBe('needs-action');
    });
    await service.synchronizeNow();
    expect(synchronize).toHaveBeenCalledOnce();

    await service.resolveRemoteDeletions({
      deleteTrackIds: ['local:delete'],
      deleteMarkerIds: [],
    });

    expect(resolveRemoteTrackDeletions).toHaveBeenCalledWith({
      expectedUserId: 'user-id',
      trackCandidateIds: ['local:delete', 'local:restore'],
      markerCandidateIds: [],
      tracks: {
        deleteIds: ['local:delete'],
        restoreIds: ['local:restore'],
      },
      markers: { deleteIds: [], restoreIds: [] },
    });
    expect(changed).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(synchronize).toHaveBeenCalledTimes(2);
    });
    expect(service.getSnapshot()).toMatchObject({
      remoteTrackDeletions: [],
      syncStatus: 'success',
    });
    service.dispose();
  });

  it('retains remote deletion candidates after a failed decision write', async () => {
    database.loadTrackSyncEnabled = vi.fn().mockResolvedValue(true);
    database.resolveRemoteDeletions = vi
      .fn()
      .mockRejectedValue(new Error('storage unavailable'));
    const fake = createClient({
      restoredSession: session('decision-error@example.test'),
    });
    const worker = {
      synchronize: vi.fn().mockResolvedValue({
        usage: emptyUsage,
        changed: { tracks: false, markers: false },
        remoteTrackDeletions: [{ trackId: 'local:keep', name: 'Keep' }],
        remoteMarkerDeletions: [],
      }),
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);

    await vi.waitFor(() => {
      expect(service.getSnapshot().syncStatus).toBe('needs-action');
    });
    await service.resolveRemoteDeletions({
      deleteTrackIds: [],
      deleteMarkerIds: [],
    });

    expect(service.getSnapshot()).toMatchObject({
      busy: false,
      syncStatus: 'needs-action',
      remoteTrackDeletions: [{ trackId: 'local:keep', name: 'Keep' }],
      errorMessage:
        'Unable to apply the deletion decision. Your local data remains available.',
    });
    service.dispose();
  });

  it('queues one follow-up synchronization for lifecycle work during an active run', async () => {
    const fake = createClient({ restoredSession: session('sync@example.test') });
    let resolveFirst: (() => void) | undefined;
    const firstRun = new Promise<TrackSyncWorkerResult>((resolve) => {
      resolveFirst = () => {
        resolve({
          usage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
          changed: { tracks: false, markers: false },
          remoteTrackDeletions: [],
          remoteMarkerDeletions: [],
        });
      };
    });
    const synchronize = vi
      .fn()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValue({
        usage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
        changed: { tracks: false, markers: false },
        remoteTrackDeletions: [],
        remoteMarkerDeletions: [],
      });
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
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
    expect(synchronize).toHaveBeenCalledWith(
      'user-id',
      'access-token',
      expect.any(Number),
      expect.any(AbortSignal),
    );
  });

  it('starts one enabled startup synchronization regardless of restore order', async () => {
    for (const restoredFirst of [true, false]) {
      let resolvePreference: ((value: boolean) => void) | undefined;
      const preference = new Promise<boolean>((resolve) => {
        resolvePreference = resolve;
      });
      let resolveSession:
        ((value: { data: { session: Session }; error: null }) => void) | undefined;
      const restored = new Promise<{ data: { session: Session }; error: null }>(
        (resolve) => {
          resolveSession = resolve;
        },
      );
      const activeSession = session('startup@example.test');
      database.loadTrackSyncEnabled = vi.fn().mockReturnValue(preference);
      const fake = createClient();
      fake.getSession
        .mockImplementationOnce(() => restored)
        .mockResolvedValue({ data: { session: activeSession }, error: null });
      const synchronize = vi.fn().mockResolvedValue({
        usage: emptyUsage,
        changed: { tracks: false, markers: false },
        remoteTrackDeletions: [],
        remoteMarkerDeletions: [],
      });
      const worker = {
        synchronize,
        subscribeTracksChanged: vi.fn(),
        subscribeProgress: vi.fn(),
        dispose: vi.fn(),
      } as unknown as TrackSyncWorkerClient;
      const service = new SupabaseUserDataService(fake.client, database, worker);

      if (restoredFirst) {
        resolveSession?.({ data: { session: activeSession }, error: null });
        await Promise.resolve();
        expect(synchronize).not.toHaveBeenCalled();
        resolvePreference?.(true);
      } else {
        resolvePreference?.(true);
        await Promise.resolve();
        expect(synchronize).not.toHaveBeenCalled();
        resolveSession?.({ data: { session: activeSession }, error: null });
      }

      await vi.waitFor(() => {
        expect(synchronize).toHaveBeenCalledOnce();
      });
      fake.emit('SIGNED_IN', activeSession);
      fake.emit('TOKEN_REFRESHED', activeSession);
      expect(synchronize).toHaveBeenCalledOnce();
      expect((synchronize.mock.calls[0]?.[3] as AbortSignal | undefined)?.aborted).toBe(
        false,
      );
      service.dispose();
    }
  });

  it('synchronizes explicit sign-in and coalesces all track mutation triggers', async () => {
    database.loadTrackSyncEnabled = vi.fn().mockResolvedValue(true);
    const fake = createClient();
    fake.getSession
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValue({
        data: { session: session('signed-in@example.test') },
        error: null,
      });
    let resolveFirst: (() => void) | undefined;
    const firstRun = new Promise<TrackSyncWorkerResult>((resolve) => {
      resolveFirst = () => {
        resolve({
          usage: emptyUsage,
          changed: { tracks: false, markers: false },
          remoteTrackDeletions: [],
          remoteMarkerDeletions: [],
        });
      };
    });
    const synchronize = vi
      .fn()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValue({
        usage: emptyUsage,
        changed: { tracks: false, markers: false },
        remoteTrackDeletions: [],
        remoteMarkerDeletions: [],
      });
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn(),
      dispose: vi.fn(),
    } as unknown as TrackSyncWorkerClient;
    const service = new SupabaseUserDataService(fake.client, database, worker);

    await vi.waitFor(() => {
      expect(service.getSnapshot()).toMatchObject({
        status: 'signed-out',
        syncEnabled: true,
      });
    });
    await service.signIn('signed-in@example.test', 'password');
    await vi.waitFor(() => {
      expect(synchronize).toHaveBeenCalledOnce();
    });
    const saves = [
      service.trackSaved('local:save'),
      service.trackMetadataChanged('local:rename'),
      service.trackDeleted('local:delete'),
    ];
    resolveFirst?.();
    await Promise.all(saves);

    await vi.waitFor(() => {
      expect(synchronize).toHaveBeenCalledTimes(2);
    });
    service.dispose();
  });

  it('retains worker progress only for an active synchronization run', async () => {
    const activeSession = session('progress@example.test');
    const fake = createClient({ restoredSession: activeSession });
    let resolveFirst: (() => void) | undefined;
    const firstRun = new Promise<TrackSyncWorkerResult>((resolve) => {
      resolveFirst = () => {
        resolve({
          usage: emptyUsage,
          changed: { tracks: false, markers: false },
          remoteTrackDeletions: [],
          remoteMarkerDeletions: [],
        });
      };
    });
    const synchronize = vi
      .fn()
      .mockReturnValueOnce(firstRun)
      .mockImplementationOnce(
        (
          _userId: string,
          _accessToken: string,
          _sessionRevision: number,
          signal: AbortSignal,
        ) =>
          new Promise<TrackSyncWorkerResult>((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                resolve({
                  usage: emptyUsage,
                  changed: { tracks: false, markers: false },
                  remoteTrackDeletions: [],
                  remoteMarkerDeletions: [],
                });
              },
              { once: true },
            );
          }),
      );
    let emitProgress: ((progress: UserDataSyncProgress) => void) | undefined;
    const worker = {
      synchronize,
      subscribeTracksChanged: vi.fn(),
      subscribeProgress: vi.fn((listener) => {
        emitProgress = listener as (progress: UserDataSyncProgress) => void;
        return () => undefined;
      }),
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
    emitProgress?.({ completedItems: 1, totalItems: 10 });
    expect(service.getSnapshot().syncProgress).toEqual({
      completedItems: 1,
      totalItems: 10,
    });
    resolveFirst?.();
    await enabling;
    expect(service.getSnapshot().syncProgress).toBeNull();
    emitProgress?.({ completedItems: 2, totalItems: 10 });
    expect(service.getSnapshot().syncProgress).toBeNull();

    const manual = service.synchronizeNow();
    await vi.waitFor(() => {
      expect(synchronize).toHaveBeenCalledTimes(2);
    });
    emitProgress?.({ completedItems: 3, totalItems: 10 });
    expect(service.getSnapshot().syncProgress).toEqual({
      completedItems: 3,
      totalItems: 10,
    });
    fake.emit('SIGNED_IN', session('replacement@example.test', 'replacement-id'));
    await manual;
    expect(service.getSnapshot()).toMatchObject({
      syncStatus: 'idle',
      syncProgress: null,
      userId: 'replacement-id',
    });
    emitProgress?.({ completedItems: 4, totalItems: 10 });
    expect(service.getSnapshot().syncProgress).toBeNull();
    service.dispose();
  });
});
