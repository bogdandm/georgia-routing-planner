import ky, { type KyInstance } from 'ky';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';

export function createHttpClient(logger: DiagnosticLogger): KyInstance {
  logger.log({ level: 'debug', name: 'http.client.created' });
  return ky.create({
    retry: { limit: 0 },
    timeout: 15_000,
    throwHttpErrors: true,
  });
}
