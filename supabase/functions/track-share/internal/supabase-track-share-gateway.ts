import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import {
  CONTENT_HASH_PATTERN,
  MAX_COMPRESSED_BYTES,
  type ResolvedTrackShare,
  TrackShareFailure,
  type TrackShareMetadata,
} from './contracts.ts';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metadataFrom(value: unknown): TrackShareMetadata {
  if (!isObject(value)) throw new Error('Missing share metadata.');
  const { name, sourceFormat, geometryKind, updatedAt } = value;
  if (
    typeof name !== 'string' ||
    (sourceFormat !== 'gpx' && sourceFormat !== 'fit' && sourceFormat !== 'kml') ||
    (geometryKind !== 'track' && geometryKind !== 'route') ||
    typeof updatedAt !== 'string'
  ) {
    throw new Error('Invalid share metadata.');
  }
  return { name, sourceFormat, geometryKind, updatedAt };
}

function resolvedShareFrom(value: unknown): ResolvedTrackShare | null {
  if (value === null) return null;
  if (!isObject(value)) throw new Error('Invalid share resolution.');
  const {
    content_hash: contentHash,
    compressed_bytes: compressedBytes,
    object_path: objectPath,
  } = value;
  if (
    typeof contentHash !== 'string' ||
    !CONTENT_HASH_PATTERN.test(contentHash) ||
    typeof compressedBytes !== 'number' ||
    !Number.isSafeInteger(compressedBytes) ||
    compressedBytes <= 0 ||
    compressedBytes > MAX_COMPRESSED_BYTES ||
    typeof objectPath !== 'string'
  ) {
    throw new Error('Invalid share resolution.');
  }
  return {
    contentHash,
    compressedBytes,
    objectPath,
    metadata: metadataFrom(value.metadata),
  };
}

export class SupabaseTrackShareGateway {
  constructor(
    private readonly context: SupabaseContext,
    private readonly userId?: string,
  ) {}

  async status(
    contentHash: string,
  ): Promise<
    | { readonly enabled: false }
    | { readonly enabled: true; readonly digest: string; readonly nonce: string }
  > {
    return await this.readOwnerResult('read_track_share', contentHash);
  }

  async enable(
    contentHash: string,
    digest: string,
    nonce: string,
  ): Promise<{
    readonly enabled: true;
    readonly digest: string;
    readonly nonce: string;
  }> {
    const result = await this.callRpc('enable_track_share', {
      p_user_id: this.requireUserId(),
      p_content_hash: contentHash,
      p_share_token_hash: digest,
      p_token_nonce: nonce,
    });
    const enabled = this.enabledResult(result, false);
    if (!enabled.enabled) throw new Error('Share enable returned disabled.');
    return enabled;
  }

  async disable(contentHash: string): Promise<void> {
    const result = await this.callRpc('disable_track_share', {
      p_user_id: this.requireUserId(),
      p_content_hash: contentHash,
    });
    if (!isObject(result) || result.outcome === 'missing') {
      throw new TrackShareFailure(404, 'track_not_found', 'Track was not found.');
    }
    if (result.outcome !== 'disabled') throw new Error('Invalid share disable result.');
  }

  async resolve(digest: string): Promise<ResolvedTrackShare | null> {
    return resolvedShareFrom(
      await this.callRpc('resolve_track_share', { p_share_token_hash: digest }),
    );
  }

  async download(objectPath: string): Promise<Uint8Array> {
    const { data, error } = await this.context.supabaseAdmin.storage
      .from('track-geometries')
      .download(objectPath);
    if (error !== null || data === null) {
      throw new TrackShareFailure(
        502,
        'share_download_failed',
        'Shared track could not be downloaded.',
      );
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  private async readOwnerResult(
    rpcName: string,
    contentHash: string,
  ): Promise<
    | { readonly enabled: false }
    | { readonly enabled: true; readonly digest: string; readonly nonce: string }
  > {
    const result = await this.callRpc(rpcName, {
      p_user_id: this.requireUserId(),
      p_content_hash: contentHash,
    });
    return this.enabledResult(result, true);
  }

  private enabledResult(
    result: unknown,
    allowDisabled: boolean,
  ):
    | { readonly enabled: false }
    | { readonly enabled: true; readonly digest: string; readonly nonce: string } {
    if (!isObject(result)) throw new Error('Invalid share result.');
    if (result.outcome === 'missing') {
      throw new TrackShareFailure(404, 'track_not_found', 'Track was not found.');
    }
    if (result.outcome === 'not_ready') {
      throw new TrackShareFailure(
        409,
        'track_not_ready',
        'Track is not ready to share.',
      );
    }
    if (allowDisabled && result.outcome === 'disabled') return { enabled: false };
    if (
      result.outcome !== 'enabled' ||
      typeof result.share_token_hash !== 'string' ||
      !CONTENT_HASH_PATTERN.test(result.share_token_hash) ||
      typeof result.token_nonce !== 'string'
    ) {
      throw new Error('Invalid share result.');
    }
    return {
      enabled: true,
      digest: result.share_token_hash,
      nonce: result.token_nonce,
    };
  }

  private requireUserId(): string {
    if (this.userId === undefined) throw new Error('Missing owner identity.');
    return this.userId;
  }

  private async callRpc(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    const admin = this.context.supabaseAdmin as unknown as {
      rpc: (
        rpcName: string,
        rpcParameters: Record<string, unknown>,
      ) => Promise<{
        readonly data: unknown;
        readonly error: { readonly message: string } | null;
      }>;
    };
    const { data, error } = await admin.rpc(name, parameters);
    if (error !== null) throw new Error(`${name} failed: ${error.message}`);
    return data;
  }
}
