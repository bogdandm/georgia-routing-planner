import { createContext } from 'react';

import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';

export const RuntimeServicesContext = createContext<RuntimeServices | null>(null);
