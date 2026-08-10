export const TRACK_GEOMETRY_BUCKET = 'track-geometries';
export const TRACK_QUOTA_BYTES = 8_388_608;
export const MAX_METADATA_BYTES = 65_536;
export const MAX_JSON_BYTES = MAX_METADATA_BYTES + 4_096;
export const MAX_MULTIPART_BYTES = TRACK_QUOTA_BYTES + MAX_METADATA_BYTES + 131_072;
export const MAX_CANONICAL_BYTES = 67_108_864;
export const STORAGE_PAGE_SIZE = 100;
export const DATABASE_PAGE_SIZE = 1_000;
export const MAX_STORAGE_OBJECTS = 10_000;
export const MAX_MARKER_BYTES = 4_096;
export const MAX_MARKER_RECORDS = 10_000;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface MarkerPayload {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly coordinate: readonly [number, number];
  readonly iconKey: string;
  readonly colorKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MarkerRecord {
  readonly marker_id: string;
  readonly revision: number;
  readonly payload: MarkerPayload;
}

export interface RpcResponse {
  readonly outcome:
    | 'applied'
    | 'upload'
    | 'conflict'
    | 'existing'
    | 'missing'
    | 'limit'
    | 'revision-exhausted';
  readonly record?: unknown;
  readonly objectPath?: string;
}

export interface UploadTrackCommand {
  readonly action: 'upload';
  readonly contentHash: string;
  readonly compressedBytes: number;
  readonly baseRevision: number;
  readonly metadata: Record<string, unknown>;
  readonly geometry: Uint8Array<ArrayBuffer>;
}

export interface MetadataTrackCommand {
  readonly action: 'metadata';
  readonly contentHash: string;
  readonly baseRevision: number;
  readonly metadata: Record<string, unknown>;
}

export interface DeleteTrackCommand {
  readonly action: 'delete';
  readonly contentHash: string;
  readonly baseRevision: number;
}

export interface StatusTrackCommand {
  readonly action: 'status';
}
export interface UpsertMarkerCommand {
  readonly action: 'marker-upsert';
  readonly markerId: string;
  readonly baseRevision: number;
  readonly marker: MarkerPayload;
}

export interface DeleteMarkerCommand {
  readonly action: 'marker-delete';
  readonly markerId: string;
  readonly baseRevision: number;
}

export type TrackSyncCommand =
  | UploadTrackCommand
  | MetadataTrackCommand
  | DeleteTrackCommand
  | StatusTrackCommand
  | UpsertMarkerCommand
  | DeleteMarkerCommand;

export interface StorageEntry {
  readonly id: string | null;
  readonly name: string;
}

export interface TrackUsage {
  readonly usedBytes: number;
  readonly reservedBytes: number;
  readonly limitBytes: number;
}

export type TrackSyncResult = RpcResponse | TrackUsage | TrackSyncFailure;

export class TrackSyncFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}
