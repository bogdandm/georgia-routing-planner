import { use } from 'react';

import { ApplicationServicesContext } from '@/app/bootstrap/ApplicationServicesContext';

export function useApplicationServices() {
  const services = use(ApplicationServicesContext);
  if (services === null) {
    throw new Error(
      'Application services are unavailable. Mount the component inside ApplicationServicesProvider.',
    );
  }
  return services;
}
