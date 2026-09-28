import type { MarkerIconKey } from '@/domain/markers/savedMarker';

export const TRACK_FOLDER_SCHEMA_VERSION = 1;
export const IMPORTS_FOLDER_ID = 'imports';
export const DEFAULT_IMPORTS_FOLDER_NAME = 'Imports';

export type TrackFolderIconKey = 'folder' | MarkerIconKey;

export interface TrackFolder {
  readonly schemaVersion: typeof TRACK_FOLDER_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly iconKey: TrackFolderIconKey;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NormalizedTrackFolderName {
  readonly name: string;
  readonly normalizedName: string;
}

export function normalizeTrackFolderName(name: string): NormalizedTrackFolderName {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Folder name is required.');
  if (trimmed.length > 200) {
    throw new Error('Folder name must be 200 characters or fewer.');
  }
  return {
    name: trimmed,
    normalizedName: trimmed.toLocaleLowerCase('en'),
  };
}

export function isTrackFolderPosition(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createDefaultImportsFolder(
  timestamp: string,
  position = 0,
): TrackFolder {
  if (!isTrackFolderPosition(position)) {
    throw new Error('Folder position must be a non-negative safe integer.');
  }
  const normalized = normalizeTrackFolderName(DEFAULT_IMPORTS_FOLDER_NAME);
  return {
    schemaVersion: TRACK_FOLDER_SCHEMA_VERSION,
    id: IMPORTS_FOLDER_ID,
    ...normalized,
    iconKey: 'folder',
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
