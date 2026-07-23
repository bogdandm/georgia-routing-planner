import type { LocalTrackContent, LocalTrackSummary } from '@/domain/tracks/localTrack';

export interface LocalTrackRepository {
  saveLocalTrack(summary: LocalTrackSummary, content: LocalTrackContent): Promise<void>;
  listLocalTracks(): Promise<readonly LocalTrackSummary[]>;
  loadLocalTrackContent(trackId: string): Promise<LocalTrackContent>;
  renameLocalTrack(trackId: string, name: string): Promise<LocalTrackSummary>;
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
