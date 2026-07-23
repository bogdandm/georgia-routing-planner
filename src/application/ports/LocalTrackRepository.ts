import type { LocalTrackContent, LocalTrackSummary } from '@/domain/tracks/localTrack';

export interface LocalTrackRepository {
  saveLocalTrack(summary: LocalTrackSummary, content: LocalTrackContent): Promise<void>;
  listLocalTracks(): Promise<readonly LocalTrackSummary[]>;
  loadLocalTrackContent(trackId: string): Promise<LocalTrackContent>;
  renameLocalTrack(trackId: string, name: string): Promise<LocalTrackSummary>;
  updateLocalTrackMetadata(
    trackId: string,
    changes: {
      readonly description?: string;
      readonly favorite?: boolean;
      readonly elevationFilterMeters?: number;
    },
  ): Promise<LocalTrackSummary>;
  loadLatestOpenedTrackId(): Promise<string | null>;
  saveLatestOpenedTrackId(trackId: string | null): Promise<void>;
  deleteLocalTrack(trackId: string): Promise<void>;
}

export class LocalTrackStorageError extends Error {
  public constructor(
    public readonly code: 'not-found' | 'content-missing' | 'record-invalid',
    message: string,
  ) {
    super(message);
    this.name = 'LocalTrackStorageError';
  }
}
