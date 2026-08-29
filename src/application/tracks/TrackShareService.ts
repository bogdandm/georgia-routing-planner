import type { TrackPoint } from '@/domain/tracks/gpx';

export type TrackShareStatus =
  { readonly enabled: false } | { readonly enabled: true; readonly token: string };

export interface ResolvedSharedTrack {
  readonly contentHash: string;
  readonly metadata: {
    readonly name: string;
    readonly sourceFormat: 'gpx' | 'fit' | 'kml';
    readonly geometryKind: 'track' | 'route';
    readonly updatedAt: string;
  };
  readonly trackPoints: readonly (readonly TrackPoint[])[];
}

export interface TrackShareService {
  status(contentHash: string, signal?: AbortSignal): Promise<TrackShareStatus>;
  enable(
    contentHash: string,
    signal?: AbortSignal,
  ): Promise<Extract<TrackShareStatus, { enabled: true }>>;
  disable(contentHash: string, signal?: AbortSignal): Promise<void>;
  resolve(token: string, signal?: AbortSignal): Promise<ResolvedSharedTrack>;
}

export type TrackShareErrorCategory =
  | 'auth-required'
  | 'track-not-found'
  | 'track-not-ready'
  | 'share-not-found'
  | 'network'
  | 'invalid-remote';

export class TrackShareError extends Error {
  constructor(
    readonly category: TrackShareErrorCategory,
    message: string,
  ) {
    super(message);
  }
}
