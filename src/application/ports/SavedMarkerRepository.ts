import type { SavedMarker } from '@/domain/markers/savedMarker';

export interface SavedMarkerRepository {
  listSavedMarkers(): Promise<readonly SavedMarker[]>;
  saveSavedMarker(marker: SavedMarker): Promise<void>;
  updateSavedMarker(
    markerId: string,
    changes: Readonly<
      Pick<
        SavedMarker,
        'name' | 'normalizedName' | 'iconKey' | 'colorKey' | 'updatedAt'
      >
    >,
  ): Promise<SavedMarker>;
  deleteSavedMarker(markerId: string): Promise<void>;
}

export class SavedMarkerStorageError extends Error {
  public constructor(
    public readonly code: 'not-found' | 'record-invalid',
    message: string,
  ) {
    super(message);
    this.name = 'SavedMarkerStorageError';
  }
}
