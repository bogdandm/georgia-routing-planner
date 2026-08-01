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
});
