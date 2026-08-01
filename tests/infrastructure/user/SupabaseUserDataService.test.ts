import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { SupabaseUserDataService } from '@/infrastructure/user/SupabaseUserDataService';

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
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const getSession = vi.fn().mockResolvedValue({
    data: { session: options.restoredSession ?? null },
    error: null,
  });
  const client = {
    auth: {
      getSession,
      onAuthStateChange: vi.fn((nextCallback) => {
        callback = nextCallback;
        return { data: { subscription: { unsubscribe } } };
      }),
      signInWithPassword,
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
    unsubscribe,
  };
}

describe('SupabaseUserDataService', () => {
  it('restores a persisted session without exposing its tokens', async () => {
    const fake = createClient({ restoredSession: session('restored@example.test') });
    const service = new SupabaseUserDataService(fake.client);

    await vi.waitFor(() => {
      expect(service.getSnapshot()).toEqual({
        busy: false,
        email: 'restored@example.test',
        errorMessage: null,
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
    const service = new SupabaseUserDataService(fake.client);

    await service.signIn('user@example.test', 'password');

    expect(fake.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.test',
      password: 'password',
    });
    expect(service.getSnapshot()).toEqual({
      busy: false,
      email: null,
      errorMessage: 'Unable to sign in. Check your email and password.',
      status: 'error',
    });
  });

  it('handles refresh and sign-out events then releases the client subscription', async () => {
    const fake = createClient();
    const service = new SupabaseUserDataService(fake.client);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    fake.emit('TOKEN_REFRESHED', session('refresh@example.test'));
    expect(service.getSnapshot().email).toBe('refresh@example.test');
    await service.signOut();
    expect(fake.signOut).toHaveBeenCalledOnce();
    expect(service.getSnapshot().status).toBe('signed-out');

    unsubscribe();
    service.dispose();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalled();
  });
});
