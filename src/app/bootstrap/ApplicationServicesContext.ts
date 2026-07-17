import { createContext } from 'react';

import type { ApplicationServices } from '@/app/bootstrap/createApplicationServices';

export const ApplicationServicesContext = createContext<ApplicationServices | null>(
  null,
);
