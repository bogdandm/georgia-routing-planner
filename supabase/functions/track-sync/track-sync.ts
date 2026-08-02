import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import { type TrackSyncCommand, TrackSyncFailure } from './internal/contracts.ts';
import {
  createTrackSyncResponse,
  parseTrackSyncRequest,
  requireUserId,
} from './internal/http.ts';
import { TrackSyncService } from './internal/track-sync-service.ts';

const MAX_DIAGNOSTIC_TEXT_LENGTH = 500;
const MAX_DIAGNOSTIC_CAUSES = 3;
const MAX_DIAGNOSTIC_CAUSE_DEPTH = 2;

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, '[redacted-token]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[redacted-token]')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      '[redacted-uuid]',
    )
    .replace(/\b[0-9a-f]{64}\b/gi, '[redacted-hash]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[redacted-email]')
    .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);
}

interface FailureCause {
  readonly name?: string;
  readonly message?: string;
  readonly code?: string | number;
  readonly statusCode?: string | number;
  readonly errors?: readonly FailureCause[];
}

function failureCause(error: unknown, depth = 0): FailureCause | undefined {
  if (typeof error === 'string') return { message: sanitizeDiagnosticText(error) };
  if (typeof error !== 'object' || error === null) return undefined;
  const value = error as Record<string, unknown>;
  const cause: {
    name?: string;
    message?: string;
    code?: string | number;
    statusCode?: string | number;
    errors?: readonly FailureCause[];
  } = {};
  if (typeof value.name === 'string') cause.name = sanitizeDiagnosticText(value.name);
  if (typeof value.message === 'string') {
    cause.message = sanitizeDiagnosticText(value.message);
  }
  if (typeof value.code === 'string' || typeof value.code === 'number') {
    cause.code =
      typeof value.code === 'string' ? sanitizeDiagnosticText(value.code) : value.code;
  }
  if (typeof value.statusCode === 'string' || typeof value.statusCode === 'number') {
    cause.statusCode = value.statusCode;
  }
  if (error instanceof AggregateError && depth < MAX_DIAGNOSTIC_CAUSE_DEPTH) {
    const errors = error.errors
      .slice(0, MAX_DIAGNOSTIC_CAUSES)
      .map((nested) => failureCause(nested, depth + 1))
      .filter((nested): nested is FailureCause => nested !== undefined);
    if (errors.length > 0) cause.errors = errors;
  }
  return Object.keys(cause).length === 0 ? undefined : cause;
}

function logServerFailure(
  error: TrackSyncFailure,
  method: string,
  action: TrackSyncCommand['action'] | 'unparsed',
): void {
  console.error(
    JSON.stringify({
      event: 'track_sync_failure',
      method,
      action,
      status: error.status,
      code: error.code,
      cause: failureCause(error.cause),
    }),
  );
}

export async function handleTrackSync(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  let action: TrackSyncCommand['action'] | 'unparsed' = 'unparsed';
  try {
    if (request.method !== 'POST') {
      throw new TrackSyncFailure(405, 'method_not_allowed', 'Only POST is supported.');
    }
    const userId = requireUserId(context);
    const command = await parseTrackSyncRequest(request);
    action = command.action;
    const result = await new TrackSyncService(context, userId).execute(command);
    return createTrackSyncResponse(result);
  } catch (error) {
    if (error instanceof TrackSyncFailure) {
      if (error.status >= 500) logServerFailure(error, request.method, action);
      return createTrackSyncResponse(error);
    }
    const failure = new TrackSyncFailure(
      500,
      'internal_error',
      'Track synchronization failed.',
      undefined,
      error,
    );
    logServerFailure(failure, request.method, action);
    return createTrackSyncResponse(failure);
  }
}
