import type { PropsWithChildren } from 'react';

import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { RuntimeServicesContext } from '@/bootstrap/RuntimeServicesContext';

interface RuntimeServicesProviderProps extends PropsWithChildren {
  readonly services: RuntimeServices;
}

export function RuntimeServicesProvider({
  children,
  services,
}: RuntimeServicesProviderProps) {
  return <RuntimeServicesContext value={services}>{children}</RuntimeServicesContext>;
}
