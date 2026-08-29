import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import {
  MAX_COMPRESSED_BYTES,
  SHARE_TOKEN_PATTERN,
  TrackShareFailure,
} from './internal/contracts.ts';
import {
  failureResponse,
  parseOwnerCommand,
  requireUserId,
  response,
} from './internal/http.ts';
import {
  base64UrlToBytes,
  createTokenNonce,
  deriveShareToken,
  tokenDigest,
} from './internal/share-token.ts';
import { SupabaseTrackShareGateway } from './internal/supabase-track-share-gateway.ts';

type PublicResponseFormat = 'json' | 'gzip';

function qualityFor(
  accept: string,
  mediaType: 'application/json' | 'application/gzip',
): number {
  let matchedSpecificity = -1;
  let matchedQuality = 0;

  for (const part of accept.split(',')) {
    const [mediaRange = '', ...parameters] = part.trim().toLowerCase().split(';');
    const specificity =
      mediaRange === mediaType
        ? 2
        : mediaRange === 'application/*'
          ? 1
          : mediaRange === '*/*'
            ? 0
            : -1;
    if (specificity === -1 || specificity < matchedSpecificity) continue;

    const qualityParameter = parameters.find((parameter) =>
      parameter.trim().startsWith('q='),
    );
    const quality =
      qualityParameter === undefined
        ? 1
        : Number(qualityParameter.trim().slice('q='.length));
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) continue;

    matchedSpecificity = specificity;
    matchedQuality = quality;
  }

  return matchedQuality;
}

function preferredPublicFormat(accept: string | null): PublicResponseFormat | null {
  if (accept === null) return 'json';

  const jsonQuality = qualityFor(accept, 'application/json');
  const gzipQuality = qualityFor(accept, 'application/gzip');
  if (jsonQuality <= 0 && gzipQuality <= 0) return null;
  return gzipQuality > jsonQuality ? 'gzip' : 'json';
}

function logFailure(error: TrackShareFailure, method: string): void {
  const redact = (value: string): string =>
    value.replace(/\b[A-Za-z0-9_-]{43}\b/g, '[redacted-share-token]').slice(0, 500);
  console.error(
    JSON.stringify({
      event: 'track_share_failure',
      method,
      status: error.status,
      code: error.code,
      cause: error.cause instanceof Error ? redact(error.cause.message) : undefined,
    }),
  );
}

async function reconstructedToken(
  userId: string,
  nonce: string,
  digest: string,
): Promise<string> {
  const derived = await deriveShareToken(userId, nonce);
  if (derived.digest !== digest) {
    throw new TrackShareFailure(
      500,
      'share_integrity_error',
      'Track share is invalid.',
    );
  }
  return derived.token;
}

async function handleOwner(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  const userId = requireUserId(context);
  const command = await parseOwnerCommand(request);
  const gateway = new SupabaseTrackShareGateway(context, userId);
  if (command.action === 'disable') {
    await gateway.disable(command.contentHash);
    return response({ enabled: false });
  }
  if (command.action === 'status') {
    const status = await gateway.status(command.contentHash);
    if (!status.enabled) return response(status);
    return response({
      enabled: true,
      token: await reconstructedToken(userId, status.nonce, status.digest),
    });
  }
  const nonce = createTokenNonce();
  const candidate = await deriveShareToken(userId, nonce);
  const enabled = await gateway.enable(command.contentHash, candidate.digest, nonce);
  return response({
    enabled: true,
    token: await reconstructedToken(userId, enabled.nonce, enabled.digest),
  });
}

async function handlePublic(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  const token = request.headers.get('x-track-share-token');
  if (token === null || !SHARE_TOKEN_PATTERN.test(token)) {
    throw new TrackShareFailure(400, 'invalid_token', 'Share token is invalid.');
  }
  const format = preferredPublicFormat(request.headers.get('accept'));
  if (format === null) {
    throw new TrackShareFailure(
      406,
      'not_acceptable',
      'Accept must include application/json or application/gzip.',
    );
  }
  const digest = await tokenDigest(base64UrlToBytes(token));
  const gateway = new SupabaseTrackShareGateway(context);
  const resolved = await gateway.resolve(digest);
  if (resolved === null) {
    throw new TrackShareFailure(404, 'share_not_found', 'Shared track was not found.');
  }
  if (format === 'json') {
    return response({
      version: 1,
      contentHash: resolved.contentHash,
      compressedBytes: resolved.compressedBytes,
      metadata: resolved.metadata,
    });
  }
  const geometry = await gateway.download(resolved.objectPath);
  if (
    geometry.byteLength !== resolved.compressedBytes ||
    geometry.byteLength > MAX_COMPRESSED_BYTES
  ) {
    throw new TrackShareFailure(
      502,
      'share_download_failed',
      'Shared track could not be downloaded.',
    );
  }
  return new Response(Uint8Array.from(geometry).buffer, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/gzip' },
  });
}

export async function handleTrackShare(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  try {
    if (request.method === 'POST') return await handleOwner(request, context);
    if (request.method === 'GET') return await handlePublic(request, context);
    throw new TrackShareFailure(
      405,
      'method_not_allowed',
      'Only GET and POST are supported.',
    );
  } catch (error) {
    const failure =
      error instanceof TrackShareFailure
        ? error
        : new TrackShareFailure(500, 'internal_error', 'Track sharing failed.', error);
    if (failure.status >= 500) logFailure(failure, request.method);
    return failureResponse(failure);
  }
}
