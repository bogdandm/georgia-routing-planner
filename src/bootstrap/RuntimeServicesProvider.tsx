import { createContext, use, type PropsWithChildren } from 'react';

import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';

const RuntimeServicesContext = createContext<RuntimeServices | null>(null);

interface RuntimeServicesProviderProps extends PropsWithChildren {
  readonly services: RuntimeServices;
}

export function RuntimeServicesProvider({
  children,
  services,
}: RuntimeServicesProviderProps) {
  return <RuntimeServicesContext value={services}>{children}</RuntimeServicesContext>;
}

// Keeping the sole consumer hook beside its provider removes two forwarding modules.
// eslint-disable-next-line react-refresh/only-export-components
export function useRuntimeServices(): RuntimeServices {
  const services = use(RuntimeServicesContext);
  if (services === null) {
    throw new Error(
      'Runtime services are unavailable. Mount the component inside RuntimeServicesProvider.',
    );
  }
  return services;
}
