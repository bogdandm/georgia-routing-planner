import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeServices } from '@/bootstrap/createRuntimeServices';

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
    } as unknown as ReturnType<typeof createClient>);

    const services = createRuntimeServices();
    services.dispose();

    expect(subscriptionUnsubscribe).toHaveBeenCalledOnce();
    expect(authDispose).toHaveBeenCalledOnce();
  });
});
