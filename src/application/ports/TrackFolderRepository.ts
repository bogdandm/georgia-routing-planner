import type { LocalTrackSummary } from '@/domain/tracks/localTrack';
import type { TrackFolder } from '@/domain/tracks/trackFolder';

export type NewTrackFolder = Omit<TrackFolder, 'position'>;

export interface TrackFolderRepository {
  listTrackFolders(): Promise<readonly TrackFolder[]>;
  createTrackFolder(folder: NewTrackFolder): Promise<TrackFolder>;
  updateTrackFolder(
    folderId: string,
    changes: Readonly<
      Pick<TrackFolder, 'name' | 'normalizedName' | 'iconKey' | 'updatedAt'>
    >,
  ): Promise<TrackFolder>;
  deleteTrackFolder(folderId: string): Promise<readonly LocalTrackSummary[]>;
  reorderTrackFolders(folderIds: readonly string[]): Promise<readonly TrackFolder[]>;
  moveLocalTrackToFolder(
    trackId: string,
    folderId: string | null,
  ): Promise<LocalTrackSummary>;
  ensureImportsFolder(): Promise<TrackFolder>;
}

export class TrackFolderStorageError extends Error {
  public constructor(
    public readonly code: 'not-found' | 'record-invalid',
    message: string,
  ) {
    super(message);
    this.name = 'TrackFolderStorageError';
  }
}
