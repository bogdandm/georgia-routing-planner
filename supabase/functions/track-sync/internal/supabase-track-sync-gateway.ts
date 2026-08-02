import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import {
  DATABASE_PAGE_SIZE,
  type DeleteTrackCommand,
  MAX_STORAGE_OBJECTS,
  type MetadataTrackCommand,
  type RpcResponse,
  STORAGE_PAGE_SIZE,
  type StorageEntry,
  TRACK_GEOMETRY_BUCKET,
  TRACK_QUOTA_BYTES,
  TrackSyncFailure,
  type TrackUsage,
  type UploadTrackCommand,
  UUID_PATTERN,
} from './contracts.ts';

export class SupabaseTrackSyncGateway {
  constructor(context: SupabaseContext, userId: string) {
    this.context = context;
    this.userId = userId;
  }

  async cleanupOrphans(): Promise<void> {
    const objects = await this.listUserObjects();
    await this.removeInactiveCandidates(objects);
  }

  async readUsage(): Promise<TrackUsage> {
    const { data, error } = await this.context.supabaseAdmin
      .from('user_track_usage')
      .select('used_bytes, reserved_bytes')
      .eq('user_id', this.userId)
      .maybeSingle();
    if (error) throw new Error(`Unable to read track quota: ${error.message}`);
    const usage: unknown = data;
    return {
      usedBytes:
        isObject(usage) && typeof usage.used_bytes === 'number' ? usage.used_bytes : 0,
      reservedBytes:
        isObject(usage) && typeof usage.reserved_bytes === 'number'
          ? usage.reserved_bytes
          : 0,
      limitBytes: TRACK_QUOTA_BYTES,
    };
  }

  async reserveUpload(command: UploadTrackCommand): Promise<RpcResponse> {
    const reservation = await this.callRpc('reserve_track_upload', {
      p_user_id: this.userId,
      p_content_hash: command.contentHash,
      p_compressed_bytes: command.compressedBytes,
      p_metadata: command.metadata,
      p_base_revision: command.baseRevision,
    });
    if (reservation.outcome !== 'upload') return reservation;
    if (
      typeof reservation.objectPath !== 'string' ||
      !this.isExpectedObjectPath(reservation.objectPath, command.contentHash)
    ) {
      throw new Error('Track reservation returned an invalid object path.');
    }
    return reservation;
  }

  async uploadGeometry(
    objectPath: string,
    geometry: Uint8Array<ArrayBuffer>,
  ): Promise<'created' | 'existing'> {
    const { error } = await this.context.supabaseAdmin.storage
      .from(TRACK_GEOMETRY_BUCKET)
      .upload(objectPath, geometry.buffer, {
        contentType: 'application/gzip',
        upsert: false,
      });
    if (error && !isAlreadyExistsError(error)) {
      throw new TrackSyncFailure(
        502,
        'storage_upload_failed',
        'Track geometry storage is unavailable.',
        undefined,
        error,
      );
    }
    return error === null ? 'created' : 'existing';
  }

  async finalizeUpload(contentHash: string): Promise<RpcResponse> {
    return await this.callRpc('finalize_track_upload', {
      p_user_id: this.userId,
      p_content_hash: contentHash,
    });
  }

  async releaseUpload(contentHash: string, objectPath: string): Promise<void> {
    await this.executeRpc('release_track_upload', {
      p_user_id: this.userId,
      p_content_hash: contentHash,
      p_object_path: objectPath,
    });
  }

  async removeGeometry(objectPath: string): Promise<void> {
    const { error } = await this.context.supabaseAdmin.storage
      .from(TRACK_GEOMETRY_BUCKET)
      .remove([objectPath]);
    if (error) throw new Error(`Unable to delete track geometry: ${error.message}`);
  }

  async applyMetadata(command: MetadataTrackCommand): Promise<RpcResponse> {
    return await this.callRpc('apply_track_metadata', {
      p_user_id: this.userId,
      p_content_hash: command.contentHash,
      p_base_revision: command.baseRevision,
      p_metadata: command.metadata,
    });
  }

  async deleteTrack(command: DeleteTrackCommand): Promise<RpcResponse> {
    return await this.callRpc('delete_track', {
      p_user_id: this.userId,
      p_content_hash: command.contentHash,
      p_base_revision: command.baseRevision,
    });
  }

  private readonly context: SupabaseContext;
  private readonly userId: string;

  private async executeRpc(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    const admin = this.context.supabaseAdmin as unknown as {
      readonly rpc: (
        rpcName: string,
        rpcParameters: Record<string, unknown>,
      ) => Promise<{
        readonly data: unknown;
        readonly error: { readonly message: string } | null;
      }>;
    };
    const { data, error } = await admin.rpc(name, parameters);
    if (error) {
      if (/quota exceeded/i.test(error.message)) {
        throw new TrackSyncFailure(
          413,
          'quota_exceeded',
          'Track geometry quota exceeded.',
          { ...(await this.readUsage()) },
        );
      }
      throw new Error(`${name} failed: ${error.message}`);
    }
    return data;
  }

  private async callRpc(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<RpcResponse> {
    return parseRpcResponse(await this.executeRpc(name, parameters));
  }

  private isExpectedObjectPath(path: string, contentHash: string): boolean {
    const prefix = `${this.userId}/${contentHash}/`;
    if (!path.startsWith(prefix) || !path.endsWith('.grpt.gz')) return false;
    return UUID_PATTERN.test(path.slice(prefix.length, -'.grpt.gz'.length));
  }

  private async listStorageDirectory(prefix: string): Promise<readonly StorageEntry[]> {
    const entries: StorageEntry[] = [];
    for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
      const { data, error } = await this.context.supabaseAdmin.storage
        .from(TRACK_GEOMETRY_BUCKET)
        .list(prefix, {
          limit: STORAGE_PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        });
      if (error) throw new Error(`Unable to list track geometry: ${error.message}`);
      const page = (data ?? []) as StorageEntry[];
      entries.push(...page);
      if (entries.length > MAX_STORAGE_OBJECTS || page.length < STORAGE_PAGE_SIZE)
        break;
    }
    if (entries.length > MAX_STORAGE_OBJECTS) {
      throw new Error('Track geometry cleanup exceeded its bounded object count.');
    }
    return entries;
  }

  private async listUserObjects(): Promise<readonly string[]> {
    const objects: string[] = [];
    const directories = [this.userId];
    while (directories.length > 0) {
      const directory = directories.shift()!;
      const entries = await this.listStorageDirectory(directory);
      for (const entry of entries) {
        const path = `${directory}/${entry.name}`;
        if (entry.id === null) directories.push(path);
        else objects.push(path);
        if (objects.length + directories.length > MAX_STORAGE_OBJECTS) {
          throw new Error('Track geometry cleanup exceeded its bounded object count.');
        }
      }
    }
    return objects;
  }

  private async removeObjects(paths: readonly string[]): Promise<void> {
    for (let offset = 0; offset < paths.length; offset += STORAGE_PAGE_SIZE) {
      const batch = paths.slice(offset, offset + STORAGE_PAGE_SIZE);
      const { error } = await this.context.supabaseAdmin.storage
        .from(TRACK_GEOMETRY_BUCKET)
        .remove(batch);
      if (error) throw new Error(`Unable to delete track geometry: ${error.message}`);
    }
  }

  private async readActiveObjectPaths(): Promise<ReadonlySet<string>> {
    const activePaths = new Set<string>();
    for (let offset = 0; ; offset += DATABASE_PAGE_SIZE) {
      const { data, error } = await this.context.supabaseAdmin
        .from('track_records')
        .select('object_path')
        .eq('user_id', this.userId)
        .order('object_path')
        .range(offset, offset + DATABASE_PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Unable to read active track geometry paths: ${error.message}`);
      }
      const rows: unknown = data;
      if (!Array.isArray(rows)) {
        throw new Error('Active track geometry paths returned an invalid response.');
      }
      if (offset + rows.length > MAX_STORAGE_OBJECTS) {
        throw new Error(
          'Active track geometry paths exceeded the bounded object count.',
        );
      }
      for (const row of rows) {
        if (isObject(row) && typeof row.object_path === 'string') {
          activePaths.add(row.object_path);
        }
      }
      if (rows.length < DATABASE_PAGE_SIZE) return activePaths;
    }
  }

  private async removeInactiveCandidates(candidates: readonly string[]): Promise<void> {
    if (candidates.length === 0) return;
    const activePaths = await this.readActiveObjectPaths();
    await this.removeObjects(candidates.filter((path) => !activePaths.has(path)));
  }
}

const RPC_OUTCOMES: Readonly<Record<RpcResponse['outcome'], true>> = {
  applied: true,
  upload: true,
  conflict: true,
  existing: true,
  missing: true,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRpcResponse(value: unknown): RpcResponse {
  if (!isObject(value) || typeof value.outcome !== 'string') {
    throw new Error('Track synchronization RPC returned an invalid response.');
  }
  if (!(value.outcome in RPC_OUTCOMES)) {
    throw new Error('Track synchronization RPC returned an unsupported outcome.');
  }
  return {
    outcome: value.outcome as RpcResponse['outcome'],
    record: value.record,
    objectPath: typeof value.objectPath === 'string' ? value.objectPath : undefined,
  };
}

function isAlreadyExistsError(error: {
  readonly message?: string;
  readonly statusCode?: string | number;
}): boolean {
  return (
    error.statusCode === 409 ||
    error.statusCode === '409' ||
    /(?:asset|resource) already exists/i.test(error.message ?? '')
  );
}
