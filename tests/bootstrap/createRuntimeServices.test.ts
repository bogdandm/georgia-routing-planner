import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeServices } from '@/bootstrap/createRuntimeServices';

type RuntimeSupabaseClient = SupabaseClient<
  unknown,
  { PostgrestVersion: string },
  never,
  never,
  { PostgrestVersion: string }
>;

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

function stubWorker() {
  vi.stubGlobal(
    'Worker',
    class {
      public addEventListener(): void {
        return undefined;
      }
      public removeEventListener(): void {
        return undefined;
      }
      public postMessage(): void {
        return undefined;
      }
      public terminate(): void {
        return undefined;
      }
    },
  );
}

describe('createRuntimeServices', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('does not construct a Supabase client without valid public configuration', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'not-a-url');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    stubWorker();
    const services = createRuntimeServices();

    expect(services.supabaseConfiguration).toEqual({ status: 'unconfigured' });
    expect(services.userData.getSnapshot().status).toBe('unconfigured');
    expect(createClient).not.toHaveBeenCalled();

    services.dispose();
  });

  it('disposes a configured client and its auth-state subscription', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    stubWorker();
    const authDispose = vi.fn().mockResolvedValue(undefined);
    const subscriptionUnsubscribe = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        dispose: authDispose,
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: subscriptionUnsubscribe } },
        })),
      },
    } as unknown as RuntimeSupabaseClient);

    const services = createRuntimeServices();
    services.dispose();

    expect(subscriptionUnsubscribe).toHaveBeenCalledOnce();
    expect(authDispose).toHaveBeenCalledOnce();
  });

  it('detects an implicit-flow session in the registration callback fragment', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    stubWorker();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        dispose: vi.fn().mockResolvedValue(undefined),
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
      },
    } as unknown as RuntimeSupabaseClient);

    const services = createRuntimeServices();

    expect(vi.mocked(createClient).mock.calls[0]?.[2]?.auth?.detectSessionInUrl).toBe(
      true,
    );

    services.dispose();
  });
});
