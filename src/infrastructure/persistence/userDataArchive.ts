import { Gunzip, gzipSync, strFromU8, strToU8 } from 'fflate';
import { z } from 'zod';

import type { TrackContentHasher } from '@/application/ports/TrackContentHasher';
import { parseGpx } from '@/domain/tracks/gpx';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
} from '@/domain/tracks/localTrack';
import {
  exportTrackAsGpx,
  safeFilenameStem,
  uniqueGpxFilename,
} from '@/domain/tracks/trackExport';
import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';

/*
 * A data archive is a gzip-compressed POSIX ustar file:
 *
 *   hash.json      { version, algorithm: 'SHA-256', files: { <path>: <hex digest> } }
 *   tracks.json    { version, exportedAt, folders, tracks: [{ file, summary }] }
 *   markers.json   { version, markers, trackMarkers: [{ trackId, markers }] }
 *   settings.json  { version, settings: { <settings key>: value } }
 *   tracks/*.gpx   source geometry of each unfiled track, named after the track
 *   tracks/<folder>/*.gpx  tracks of each folder, in a directory named after it
 *
 * Import reads geometry from the GPX files and everything else from the JSON files,
 * after `hash.json` matches every other file exactly.
 */

const archiveVersion = 1;
const tracksFile = 'tracks.json';
const markersFile = 'markers.json';
const settingsFile = 'settings.json';
const hashFile = 'hash.json';
const hashAlgorithm = 'SHA-256';
const tarBlockBytes = 512;
const tarNameBytes = 100;
const tarPrefixBytes = 155;
// A GPX name of stem + ` (99999)` + `.gpx` fits the 100-byte ustar name field, and
// `tracks/` + folder + ` (99999)` fits the 155-byte directory prefix.
const maximumTrackStemBytes = 80;
const maximumFolderStemBytes = 120;
// Bound for an untrusted archive, enforced on the file and again while inflating.
const maximumArchiveBytes = 512 * 1024 * 1024;
const gunzipChunkBytes = 64 * 1024;
// A stored track holds at most 100,000 points, which fits well within this GPX size.
const maximumGpxBytes = 64 * 1024 * 1024;

const encoder = new TextEncoder();

const tracksDocumentSchema = z.object({
  version: z.literal(archiveVersion),
  folders: z.array(z.unknown()),
  tracks: z.array(
    z.object({ file: z.string(), summary: z.object({ id: z.string() }).loose() }),
  ),
});

const markersDocumentSchema = z.object({
  version: z.literal(archiveVersion),
  markers: z.array(z.unknown()),
  trackMarkers: z.array(
    z.object({ trackId: z.string(), markers: z.array(z.unknown()) }),
  ),
});

const settingsDocumentSchema = z.object({
  version: z.literal(archiveVersion),
  settings: z.record(z.string(), z.unknown()),
});

const hashDocumentSchema = z.object({
  version: z.literal(archiveVersion),
  algorithm: z.literal(hashAlgorithm),
  files: z.record(z.string(), z.string()),
});

export async function createUserDataArchive(
  database: AppDatabase,
  exportedAt: Date,
): Promise<Uint8Array<ArrayBuffer>> {
  const backup = await database.readUserDataBackup();
  const folderDirectories = new Map<string, string>();
  const usedDirectories = new Set<string>();
  for (const folder of backup.folders) {
    // Sanitizing after truncation also strips a trailing space or dot it exposes.
    const stem = safeFilenameStem(truncateUtf8(folder.name, maximumFolderStemBytes));
    const base = stem.length === 0 ? 'folder' : stem;
    let directory = base;
    for (let suffix = 2; usedDirectories.has(directory); suffix += 1) {
      directory = `${base} (${String(suffix)})`;
    }
    usedDirectories.add(directory);
    folderDirectories.set(folder.id, directory);
  }
  const gpxFiles: [string, Uint8Array][] = [];
  const usedNamesByDirectory = new Map<string, Set<string>>();
  const tracks: { readonly file: string; readonly summary: unknown }[] = [];
  const trackMarkers: { readonly trackId: string; readonly markers: unknown }[] = [];
  for (const { summary, content } of backup.tracks) {
    const folderDirectory =
      summary.folderId === null ? undefined : folderDirectories.get(summary.folderId);
    const directory =
      folderDirectory === undefined ? 'tracks' : `tracks/${folderDirectory}`;
    const usedNames = usedNamesByDirectory.get(directory) ?? new Set<string>();
    usedNamesByDirectory.set(directory, usedNames);
    const filename = uniqueGpxFilename(
      truncateUtf8(summary.name, maximumTrackStemBytes),
      usedNames,
    );
    usedNames.add(filename);
    const file = `${directory}/${filename}`;
    gpxFiles.push([file, strToU8(exportTrackAsGpx(summary, content))]);
    // Calculated elevation is browser-local derived data and stays out of the archive.
    const { calculatedMetrics: _calculatedMetrics, ...archivedSummary } = summary;
    tracks.push({ file, summary: archivedSummary });
    if (content.markers.length > 0) {
      trackMarkers.push({ trackId: summary.id, markers: content.markers });
    }
  }
  const files: [string, Uint8Array][] = [
    [
      tracksFile,
      jsonFile({
        version: archiveVersion,
        exportedAt: exportedAt.toISOString(),
        folders: backup.folders,
        tracks,
      }),
    ],
    [
      markersFile,
      jsonFile({ version: archiveVersion, markers: backup.markers, trackMarkers }),
    ],
    [settingsFile, jsonFile({ version: archiveVersion, settings: backup.settings })],
    ...gpxFiles,
  ];
  const hashes: Record<string, string> = {};
  for (const [path, data] of files) hashes[path] = await sha256Hex(data);
  files.unshift([
    hashFile,
    jsonFile({ version: archiveVersion, algorithm: hashAlgorithm, files: hashes }),
  ]);
  return gzipSync(writeTar(files, exportedAt), { level: 6, mtime: exportedAt });
}

/** Requires `hash.json` to list every other archive file with its exact SHA-256. */
async function verifyArchiveHashes(files: ReadonlyMap<string, Uint8Array>) {
  const hashes = Object.entries(
    hashDocumentSchema.parse(readJsonFile(files, hashFile)).files,
  );
  if (hashes.length !== files.size - 1) {
    throw new Error('The data archive checksums do not match its files.');
  }
  for (const [path, expected] of hashes) {
    const data = path === hashFile ? undefined : files.get(path);
    if (data === undefined || (await sha256Hex(data)) !== expected) {
      throw new Error('The data archive checksums do not match its files.');
    }
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(hashAlgorithm, Uint8Array.from(data));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function truncateUtf8(text: string, maximumBytes: number): string {
  let result = '';
  for (const character of text) {
    if (encoder.encode(result + character).length > maximumBytes) break;
    result += character;
  }
  return result;
}

/**
 * Validates the whole archive before writing, then restores it in one transaction, so a
 * rejected archive changes nothing. Calculated elevation is not archived.
 */
export async function restoreUserDataArchive(
  database: AppDatabase,
  hasher: TrackContentHasher,
  archive: Blob,
): Promise<void> {
  if (archive.size > maximumArchiveBytes) {
    throw new Error('The data archive is larger than the import limit.');
  }
  const files = readTar(gunzipBounded(new Uint8Array(await archive.arrayBuffer())));
  await verifyArchiveHashes(files);
  const tracksDocument = tracksDocumentSchema.parse(readJsonFile(files, tracksFile));
  const markersDocument = markersDocumentSchema.parse(readJsonFile(files, markersFile));
  const settingsDocument = settingsDocumentSchema.parse(
    readJsonFile(files, settingsFile),
  );
  const markersByTrackId = new Map(
    markersDocument.trackMarkers.map((entry) => [entry.trackId, entry.markers]),
  );
  const tracks: unknown[] = [];
  for (const { file, summary } of tracksDocument.tracks) {
    const gpx = files.get(file);
    if (gpx === undefined) {
      throw new Error('The data archive is missing a track file.');
    }
    const parsed = parseGpx(strFromU8(gpx), { maximumBytes: maximumGpxBytes });
    const geometry: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: summary.id,
      trackPoints: parsed.segments.map((segment) => segment.points),
      markers: [],
    };
    // The hash and counts describe the geometry actually read from the GPX file.
    const restoredSummary: Record<string, unknown> = {
      ...summary,
      contentHash: await hasher.hash(geometry),
      pointCount: parsed.pointCount,
      segmentCount: parsed.segments.length,
    };
    delete restoredSummary.calculatedMetrics;
    tracks.push({
      summary: restoredSummary,
      content: { ...geometry, markers: markersByTrackId.get(summary.id) ?? [] },
    });
  }
  await database.restoreUserDataBackup({
    tracks,
    folders: tracksDocument.folders,
    markers: markersDocument.markers,
    settings: settingsDocument.settings,
  });
}

function jsonFile(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function readJsonFile(files: ReadonlyMap<string, Uint8Array>, path: string): unknown {
  const bytes = files.get(path);
  if (bytes === undefined) {
    throw new Error('The data archive is missing a required file.');
  }
  return JSON.parse(strFromU8(bytes));
}

function gunzipBounded(archive: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const gunzip = new Gunzip((chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > maximumArchiveBytes) {
      throw new Error('The data archive is larger than the import limit.');
    }
    chunks.push(chunk);
  });
  // Small input chunks bound the output a single push can inflate before the check.
  for (let offset = 0; offset < archive.length; offset += gunzipChunkBytes) {
    const end = Math.min(offset + gunzipChunkBytes, archive.length);
    gunzip.push(archive.subarray(offset, end), end === archive.length);
  }
  const tar = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.length;
  }
  return tar;
}

function paddedTarBytes(size: number): number {
  return Math.ceil(size / tarBlockBytes) * tarBlockBytes;
}

/** Sums the header with the checksum field counted as eight spaces. */
function tarChecksum(header: Uint8Array): number {
  let sum = 0;
  for (const [index, byte] of header.entries()) {
    sum += index >= 148 && index < 156 ? 0x20 : byte;
  }
  return sum;
}

function writeOctal(header: Uint8Array, offset: number, length: number, value: number) {
  const digits = value.toString(8).padStart(length - 1, '0');
  if (digits.length > length - 1) {
    throw new Error('The data archive entry is too large.');
  }
  header.set(encoder.encode(digits), offset);
  header[offset + length - 1] = 0;
}

function writeTar(
  files: readonly (readonly [string, Uint8Array])[],
  modifiedAt: Date,
): Uint8Array {
  // Two zero blocks terminate the archive.
  let size = 2 * tarBlockBytes;
  for (const [, data] of files) size += tarBlockBytes + paddedTarBytes(data.length);
  const tar = new Uint8Array(size);
  const modifiedSeconds = Math.floor(modifiedAt.getTime() / 1000);
  let offset = 0;
  for (const [path, data] of files) {
    let name = encoder.encode(path);
    let prefix = new Uint8Array(0);
    // ustar stores a longer path as a directory prefix plus the final name.
    const slash = path.lastIndexOf('/');
    if (name.length > tarNameBytes && slash > 0) {
      prefix = encoder.encode(path.slice(0, slash));
      name = encoder.encode(path.slice(slash + 1));
    }
    if (name.length > tarNameBytes || prefix.length > tarPrefixBytes) {
      throw new Error('The data archive path is too long.');
    }
    const header = new Uint8Array(tarBlockBytes);
    header.set(name, 0);
    header.set(prefix, 345);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, data.length);
    writeOctal(header, 136, 12, modifiedSeconds);
    header[156] = 0x30;
    // POSIX ustar magic `ustar\0` followed by version `00`.
    header.set(encoder.encode('ustar\u000000'), 257);
    writeOctal(header, 148, 7, tarChecksum(header));
    header[155] = 0x20;
    tar.set(header, offset);
    tar.set(data, offset + tarBlockBytes);
    offset += tarBlockBytes + paddedTarBytes(data.length);
  }
  return tar;
}

function readTarText(header: Uint8Array, offset: number, length: number): string {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(
    end === -1 ? field : field.subarray(0, end),
  );
}

function readTarOctal(header: Uint8Array, offset: number, length: number): number {
  const text = readTarText(header, offset, length).trim();
  if (!/^[0-7]+$/u.test(text)) {
    throw new Error('The data archive is not a valid tar file.');
  }
  return Number.parseInt(text, 8);
}

/** Reads regular files from a ustar archive; other entry types are skipped. */
function readTar(tar: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + tarBlockBytes <= tar.length) {
    const header = tar.subarray(offset, offset + tarBlockBytes);
    if (header.every((byte) => byte === 0)) break;
    if (readTarOctal(header, 148, 8) !== tarChecksum(header)) {
      throw new Error('The data archive is not a valid tar file.');
    }
    const size = readTarOctal(header, 124, 12);
    const dataStart = offset + tarBlockBytes;
    if (dataStart + size > tar.length) {
      throw new Error('The data archive is truncated.');
    }
    const type = header[156];
    if (type === 0x30 || type === 0) {
      const name = readTarText(header, 0, tarNameBytes);
      const posix = readTarText(header, 257, 6) === 'ustar';
      const prefix = posix ? readTarText(header, 345, 155) : '';
      const path = (prefix.length > 0 ? `${prefix}/${name}` : name).replace(
        /^\.\//u,
        '',
      );
      if (files.has(path)) {
        throw new Error('The data archive contains duplicate files.');
      }
      files.set(path, tar.slice(dataStart, dataStart + size));
    }
    offset = dataStart + paddedTarBytes(size);
  }
  return files;
}
