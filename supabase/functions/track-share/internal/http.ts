import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import {
  CONTENT_HASH_PATTERN,
  type TrackShareCommand,
  TrackShareFailure,
} from './contracts.ts';

const MAX_JSON_BYTES = 8 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireUserId(context: SupabaseContext): string {
  const userId = context.userClaims?.id;
  if (
    context.authMode !== 'user' ||
    typeof userId !== 'string' ||
    !UUID_PATTERN.test(userId)
  ) {
    throw new TrackShareFailure(401, 'invalid_jwt', 'A verified user JWT is required.');
  }
  return userId;
}

export async function parseOwnerCommand(request: Request): Promise<TrackShareCommand> {
  if (
    !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  ) {
    throw new TrackShareFailure(400, 'invalid_request', 'Request body must be JSON.');
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new TrackShareFailure(400, 'invalid_request', 'Request body is too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TrackShareFailure(
      400,
      'invalid_request',
      'Request body must be valid JSON.',
    );
  }
  if (
    !isObject(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.action !== 'string' ||
    typeof value.contentHash !== 'string' ||
    !CONTENT_HASH_PATTERN.test(value.contentHash) ||
    !['status', 'enable', 'disable'].includes(value.action)
  ) {
    throw new TrackShareFailure(400, 'invalid_request', 'Request is invalid.');
  }
  return {
    action: value.action as TrackShareCommand['action'],
    contentHash: value.contentHash,
  };
}

export function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function failureResponse(error: TrackShareFailure): Response {
  return response(
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}
