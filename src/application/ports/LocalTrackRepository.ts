import type { LocalTrackContent, LocalTrackSummary } from '@/domain/tracks/localTrack';
import type { TrackMetrics } from '@/domain/tracks/trackCalculations';

export interface LocalTrackRepository {
  saveLocalTrack(summary: LocalTrackSummary, content: LocalTrackContent): Promise<void>;
  replaceCalculatedTrackElevation(
    trackId: string,
    calculatedMetrics: TrackMetrics | null,
    calculatedTrackPoints: LocalTrackContent['calculatedTrackPoints'],
    options?: { readonly expectedContentHash?: string },
  ): Promise<LocalTrackSummary>;
  listLocalTracks(): Promise<readonly LocalTrackSummary[]>;
  loadLocalTrackContent(trackId: string): Promise<LocalTrackContent>;
  renameLocalTrack(trackId: string, name: string): Promise<LocalTrackSummary>;
  setLocalTrackFavorite(trackId: string, favorite: boolean): Promise<LocalTrackSummary>;
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
