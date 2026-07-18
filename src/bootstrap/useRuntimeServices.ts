import { use } from 'react';

import { RuntimeServicesContext } from '@/bootstrap/RuntimeServicesContext';

export function useRuntimeServices() {
  const services = use(RuntimeServicesContext);
  if (services === null) {
    throw new Error(
      'Runtime services are unavailable. Mount the component inside RuntimeServicesProvider.',
    );
  }
  return services;
}
