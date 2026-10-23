import type {
  LocalTrackContent,
  LocalTrackSummary,
  TrackMarker,
} from '@/domain/tracks/localTrack';
import type { TrackMetrics } from '@/domain/tracks/trackCalculations';
import type { TrackThumbnail } from '@/domain/tracks/trackThumbnail';

export interface LocalTrackRepository {
  saveLocalTrack(summary: LocalTrackSummary, content: LocalTrackContent): Promise<void>;
  /**
   * Replaces an existing saved track's geometry in place (point editing): same id, the
   * given summary/content (caller keeps folder, favorite, markers, names). Synchronization
   * replaces the account copy in place on every device instead of creating a second
   * track. `summary.contentHash` must be the new content's sync hash and
   * `summary.updatedAt` the edit time. Throws LocalTrackStorageError('not-found') when
   * absent.
   */
  replaceLocalTrackGeometry(
    summary: LocalTrackSummary,
    content: LocalTrackContent,
  ): Promise<void>;
  replaceCalculatedTrackElevation(
    trackId: string,
    calculatedMetrics: TrackMetrics | null,
    calculatedTrackPoints: LocalTrackContent['calculatedTrackPoints'],
    options?: { readonly expectedContentHash?: string },
  ): Promise<LocalTrackSummary>;
  listLocalTracks(): Promise<readonly LocalTrackSummary[]>;
  /** Valid stored thumbnails; invalid or outdated-algorithm records are omitted. */
  listLocalTrackThumbnails(): Promise<readonly TrackThumbnail[]>;
  /** Recomputes and stores one track's thumbnail; removes it and returns null when the track or its content is gone. */
  refreshLocalTrackThumbnail(trackId: string): Promise<TrackThumbnail | null>;
  loadLocalTrackContent(trackId: string): Promise<LocalTrackContent>;
  updateLocalTrackMarkers(
    trackId: string,
    markers: readonly TrackMarker[],
  ): Promise<{
    readonly summary: LocalTrackSummary;
    readonly content: LocalTrackContent;
  }>;
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
