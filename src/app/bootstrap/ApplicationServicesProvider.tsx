import type { PropsWithChildren } from 'react';

import { ApplicationServicesContext } from '@/app/bootstrap/ApplicationServicesContext';
import type { ApplicationServices } from '@/app/bootstrap/createApplicationServices';

interface ApplicationServicesProviderProps extends PropsWithChildren {
  readonly services: ApplicationServices;
}

export function ApplicationServicesProvider({
  children,
  services,
}: ApplicationServicesProviderProps) {
  return (
    <ApplicationServicesContext value={services}>{children}</ApplicationServicesContext>
  );
}
