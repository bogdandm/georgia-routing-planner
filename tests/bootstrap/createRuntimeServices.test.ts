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

interface StubWorkerInstance {
  readonly name: string | undefined;
  terminated: boolean;
}

function stubWorker(): StubWorkerInstance[] {
  const instances: StubWorkerInstance[] = [];
  vi.stubGlobal(
    'Worker',
    class implements StubWorkerInstance {
      public readonly name: string | undefined;
      public terminated = false;

      public constructor(_url: URL, options?: WorkerOptions) {
        this.name = options?.name;
        instances.push(this);
      }

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
        this.terminated = true;
      }
    },
  );
  return instances;
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

  it('owns the configured routing worker and disposes it with runtime services', () => {
    const workers = stubWorker();
    const services = createRuntimeServices();
    const routingWorker = workers.find((worker) => worker.name === 'trail-routing');

    expect(services.trailRouter).not.toBeNull();
    expect(routingWorker).toBeDefined();

    services.dispose();
    expect(routingWorker?.terminated).toBe(true);
  });

  it('does not expose routing when map provider configuration is invalid', () => {
    vi.stubEnv('VITE_MAP_PROVIDER_CONFIGURATION', '{}');
    stubWorker();

    const services = createRuntimeServices();

    expect(services.trailRouter).toBeNull();
    services.dispose();
  });
});
