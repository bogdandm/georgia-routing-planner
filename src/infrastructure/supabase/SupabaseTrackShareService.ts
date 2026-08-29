import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type ResolvedSharedTrack,
  TrackShareError,
  type TrackShareService,
  type TrackShareStatus,
} from '@/application/tracks/TrackShareService';
import { decodeTrackSyncGeometry } from '@/domain/tracks/trackSyncGeometry';

const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;

interface ShareMetadataResponse {
  readonly version: 1;
  readonly contentHash: string;
  readonly compressedBytes: number;
  readonly metadata: ResolvedSharedTrack['metadata'];
}

function failureForStatus(status: number): TrackShareError {
  if (status === 401)
    return new TrackShareError('auth-required', 'Sign in to share tracks.');
  if (status === 404)
    return new TrackShareError('share-not-found', 'This shared track is unavailable.');
  if (status === 409)
    return new TrackShareError('track-not-ready', 'Sync this track before sharing.');
  return new TrackShareError('network', 'Track sharing could not be reached.');
}

function isMetadata(value: unknown): value is ShareMetadataResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  const metadata = response.metadata;
  return (
    response.version === 1 &&
    typeof response.contentHash === 'string' &&
    /^[0-9a-f]{64}$/.test(response.contentHash) &&
    typeof response.compressedBytes === 'number' &&
    Number.isSafeInteger(response.compressedBytes) &&
    response.compressedBytes > 0 &&
    response.compressedBytes <= MAX_COMPRESSED_BYTES &&
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).name === 'string' &&
    ['gpx', 'fit', 'kml'].includes(
      (metadata as Record<string, unknown>).sourceFormat as string,
    ) &&
    ['track', 'route'].includes(
      (metadata as Record<string, unknown>).geometryKind as string,
    ) &&
    typeof (metadata as Record<string, unknown>).updatedAt === 'string'
  );
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class SupabaseTrackShareService implements TrackShareService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly url: string,
    private readonly publishableKey: string,
  ) {}

  async status(contentHash: string, signal?: AbortSignal): Promise<TrackShareStatus> {
    return await this.ownerCommand({ action: 'status', contentHash }, signal);
  }

  async enable(
    contentHash: string,
    signal?: AbortSignal,
  ): Promise<Extract<TrackShareStatus, { enabled: true }>> {
    const result = await this.ownerCommand({ action: 'enable', contentHash }, signal);
    if (!result.enabled)
      throw new TrackShareError('invalid-remote', 'Share enable returned disabled.');
    return result;
  }

  async disable(contentHash: string, signal?: AbortSignal): Promise<void> {
    await this.ownerCommand({ action: 'disable', contentHash }, signal);
  }

  async resolve(token: string, signal?: AbortSignal): Promise<ResolvedSharedTrack> {
    const headers = {
      apikey: this.publishableKey,
      'x-track-share-token': token,
    };
    const metadataRequest: RequestInit = {
      headers: { ...headers, accept: 'application/json' },
      signal: signal ?? null,
    };
    const geometryRequest: RequestInit = {
      headers: { ...headers, accept: 'application/gzip' },
      signal: signal ?? null,
    };
    let metadataResponse: Response;
    let geometryResponse: Response;
    try {
      [metadataResponse, geometryResponse] = await Promise.all([
        fetch(`${this.url}/functions/v1/track-share`, metadataRequest),
        fetch(`${this.url}/functions/v1/track-share`, geometryRequest),
      ]);
    } catch {
      throw new TrackShareError('network', 'Track sharing could not be reached.');
    }
    if (!metadataResponse.ok) throw failureForStatus(metadataResponse.status);
    if (!geometryResponse.ok) throw failureForStatus(geometryResponse.status);
    let metadata: unknown;
    let compressed: Uint8Array;
    try {
      metadata = await metadataResponse.json();
      compressed = new Uint8Array(await geometryResponse.arrayBuffer());
    } catch {
      throw new TrackShareError('invalid-remote', 'Shared track data is invalid.');
    }
    if (!isMetadata(metadata) || compressed.byteLength !== metadata.compressedBytes) {
      throw new TrackShareError('invalid-remote', 'Shared track data is invalid.');
    }
    try {
      const geometry = await gunzip(compressed);
      if ((await hash(geometry)) !== metadata.contentHash) {
        throw new Error('Content hash mismatch.');
      }
      return {
        contentHash: metadata.contentHash,
        metadata: metadata.metadata,
        trackPoints: decodeTrackSyncGeometry(geometry),
      };
    } catch {
      throw new TrackShareError('invalid-remote', 'Shared track data is invalid.');
    }
  }

  private async ownerCommand(
    body: {
      readonly action: 'status' | 'enable' | 'disable';
      readonly contentHash: string;
    },
    signal?: AbortSignal,
  ): Promise<TrackShareStatus> {
    const { data } = await this.supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken === undefined) {
      throw new TrackShareError('auth-required', 'Sign in to share tracks.');
    }
    let response: Response;
    try {
      response = await fetch(`${this.url}/functions/v1/track-share`, {
        method: 'POST',
        signal: signal ?? null,
        headers: {
          authorization: `Bearer ${accessToken}`,
          apikey: this.publishableKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new TrackShareError('network', 'Track sharing could not be reached.');
    }
    if (!response.ok) {
      if (response.status === 404) {
        throw new TrackShareError('track-not-found', 'Track was not found.');
      }
      throw failureForStatus(response.status);
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new TrackShareError(
        'invalid-remote',
        'Track sharing returned invalid data.',
      );
    }
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new TrackShareError(
        'invalid-remote',
        'Track sharing returned invalid data.',
      );
    }
    const status = result as Record<string, unknown>;
    if (status.enabled === false) return { enabled: false };
    if (
      status.enabled === true &&
      typeof status.token === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(status.token)
    ) {
      return { enabled: true, token: status.token };
    }
    throw new TrackShareError('invalid-remote', 'Track sharing returned invalid data.');
  }
}
