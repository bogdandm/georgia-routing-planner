import { isXmlText, type MarkerIconKey } from '@/domain/markers/savedMarker';

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

export type TrackFolderNameProblem = 'required' | 'too-long' | 'invalid-character';

/** Rejected folder name; `problem` lets the UI show a localized explanation. */
export class TrackFolderNameError extends Error {
  public constructor(public readonly problem: TrackFolderNameProblem) {
    super(`Folder name is invalid: ${problem}.`);
    this.name = 'TrackFolderNameError';
  }
}

// Mirrors the track-sync Edge Function folder schema, so any locally saved folder
// is also accepted by the server and cannot block synchronization.
export function normalizeTrackFolderName(name: string): NormalizedTrackFolderName {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new TrackFolderNameError('required');
  if (trimmed.length > 200) throw new TrackFolderNameError('too-long');
  if (!isXmlText(trimmed)) throw new TrackFolderNameError('invalid-character');
  // Lowercasing can lengthen some names; both stores bound the derived value too.
  const normalizedName = trimmed.toLocaleLowerCase('en');
  if (normalizedName.length > 200) throw new TrackFolderNameError('too-long');
  return { name: trimmed, normalizedName };
}

/**
 * Timestamp for a folder change. `createdAt` may come from another device or the
 * server clock, and the server rejects `updatedAt` earlier than `createdAt`.
 */
export function trackFolderUpdatedAt(
  folder: Pick<TrackFolder, 'createdAt'>,
  now: string,
): string {
  return Date.parse(now) < Date.parse(folder.createdAt) ? folder.createdAt : now;
}

/**
 * Every browser provisions its own Imports folder before it knows the account.
 * Until the user changes it, that copy is a placeholder the account's Imports
 * folder replaces instead of overwriting.
 */
export function isImportsPlaceholder(folder: TrackFolder): boolean {
  return folder.id === IMPORTS_FOLDER_ID && folder.createdAt === folder.updatedAt;
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
