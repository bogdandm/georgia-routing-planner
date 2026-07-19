import ky, { isHTTPError, isNetworkError, isTimeoutError, type KyInstance } from 'ky';

import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';

interface RequestDiagnosticContext {
  readonly operationId: string;
  readonly origin: string;
  readonly startedAt: number;
}

function requestOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return 'invalid-origin';
  }
}

function operationIdFromContext(
  context: Readonly<Record<string, unknown>>,
  idGenerator: IdGenerator,
): string {
  const operationId = context.operationId;
  return typeof operationId === 'string' && operationId.length > 0
    ? operationId
    : idGenerator.generate();
}

export function createHttpClient(
  logger: DiagnosticLogger,
  clock: Clock,
  idGenerator: IdGenerator,
): KyInstance {
  const requestContexts = new WeakMap<Request, RequestDiagnosticContext>();
  logger.log({ level: 'debug', name: 'http.client.created' });
  return ky.create({
    retry: { limit: 0 },
    timeout: 15_000,
    throwHttpErrors: true,
    hooks: {
      beforeRequest: [
        ({ request, options }) => {
          const context = {
            operationId: operationIdFromContext(options.context, idGenerator),
            origin: requestOrigin(request),
            startedAt: clock.monotonicNow(),
          };
          requestContexts.set(request, context);
          logger.log({
            level: 'info',
            name: 'http.request.started',
            data: {
              operationId: context.operationId,
              origin: context.origin,
            },
          });
        },
      ],
      afterResponse: [
        ({ request, response }) => {
          if (!response.ok) return;
          const context = requestContexts.get(request);
          if (context === undefined) return;
          logger.log({
            level: 'info',
            name: 'http.request.completed',
            data: {
              operationId: context.operationId,
              origin: context.origin,
              status: response.status,
              durationMs: Math.max(0, clock.monotonicNow() - context.startedAt),
            },
          });
        },
      ],
      beforeError: [
        ({ request, error }) => {
          const context = requestContexts.get(request);
          const operationId = context?.operationId ?? idGenerator.generate();
          const origin = context?.origin ?? requestOrigin(request);
          const startedAt = context?.startedAt ?? clock.monotonicNow();
          const durationMs = Math.max(0, clock.monotonicNow() - startedAt);
          const code = isTimeoutError(error)
            ? 'timeout'
            : request.signal.aborted
              ? 'cancelled'
              : isHTTPError(error)
                ? 'http-status'
                : isNetworkError(error)
                  ? 'network'
                  : 'unknown';
          logger.log({
            level: code === 'cancelled' ? 'info' : 'error',
            name:
              code === 'cancelled' ? 'http.request.cancelled' : 'http.request.failed',
            data: {
              operationId,
              origin,
              code,
              ...(isHTTPError(error) ? { status: error.response.status } : {}),
              durationMs,
            },
          });
          return error;
        },
      ],
    },
  });
}
