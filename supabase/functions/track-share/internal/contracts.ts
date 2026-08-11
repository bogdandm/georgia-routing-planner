export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const TOKEN_NONCE_PATTERN = SHARE_TOKEN_PATTERN;
export const TRACK_GEOMETRY_BUCKET = 'track-geometries';
export const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;

export type TrackShareAction = 'status' | 'enable' | 'disable';

export interface TrackShareCommand {
  readonly action: TrackShareAction;
  readonly contentHash: string;
}

export interface TrackShareMetadata {
  readonly name: string;
  readonly sourceFormat: 'gpx' | 'fit' | 'kml';
  readonly geometryKind: 'track' | 'route';
  readonly updatedAt: string;
}

export interface ResolvedTrackShare {
  readonly contentHash: string;
  readonly compressedBytes: number;
  readonly objectPath: string;
  readonly metadata: TrackShareMetadata;
}

export class TrackShareFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}
