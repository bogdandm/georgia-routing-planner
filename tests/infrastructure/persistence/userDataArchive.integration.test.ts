import { gunzipSync, gzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  SAVED_MARKER_SCHEMA_VERSION,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import {
  TRACK_FOLDER_SCHEMA_VERSION,
  normalizeTrackFolderName,
} from '@/domain/tracks/trackFolder';
import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import {
  createUserDataArchive,
  restoreUserDataArchive,
} from '@/infrastructure/persistence/userDataArchive';
import { WebCryptoTrackContentHasher } from '@/infrastructure/runtime/WebCryptoTrackContentHasher';
import { createTestServices } from '@test/helpers/createTestServices';

const hasher = new WebCryptoTrackContentHasher();
const exportedAt = new Date('2026-10-07T12:00:00.000Z');
let database: AppDatabase;
let logger: DiagnosticLogger;

function trackContent(trackId: string): LocalTrackContent {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId,
    trackPoints: [
      [
        {
          coordinate: [44.512345, 42.654321],
          elevationMeters: 1_740.5,
          recordedAt: '2026-08-01T06:00:00.000Z',
        },
        {
          coordinate: [44.52, 42.66],
          elevationMeters: 1_810,
          recordedAt: '2026-08-01T06:10:00.000Z',
        },
      ],
      [
        { coordinate: [44.53, 42.67] },
        { coordinate: [44.54, 42.68] },
        { coordinate: [44.55, 42.69] },
      ],
    ],
    markers: [
      {
        id: '5f0c2a8e-7c1b-4d3a-9e2f-1a2b3c4d5e6f',
        name: 'Spring',
        coordinate: [44.52, 42.66],
      },
    ],
  };
}

async function trackSummary(
  content: LocalTrackContent,
  name: string,
  folderId: string | null,
): Promise<LocalTrackSummary> {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    id: content.trackId,
    name,
    normalizedName: name.toLocaleLowerCase('en'),
    savedAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    contentHash: await hasher.hash(content),
    sourceFilename: 'kazbegi.fit',
    sourceFormat: 'fit',
    favorite: true,
    geometryKind: 'track',
    folderId,
    pointCount: 5,
    segmentCount: 2,
    metrics: {
      distanceMeters: 4_000,
      distanceAlgorithmVersion: 1,
      startCoordinate: [44.512345, 42.654321],
      endCoordinate: [44.55, 42.69],
      bounds: {
        west: 44.512345,
        south: 42.654321,
        east: 44.55,
        north: 42.69,
        crossesAntimeridian: false,
      },
      center: [44.53, 42.67],
      elevationSource: 'gpx',
      elevationAlgorithmVersion: 3,
    },
    metadata: { version: '1.1', links: [] },
    warnings: [],
  };
}

function savedMarker(id: string, name: string): SavedMarker {
  return {
    schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
    id,
    name,
    normalizedName: name.toLocaleLowerCase('en'),
    coordinate: [44.8, 41.7],
    elevationMeters: 520,
    iconKey: 'place',
    colorKey: 'blue',
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
  };
}

async function freshDatabase(): Promise<AppDatabase> {
  database.close();
  await database.delete();
  database = new AppDatabase(logger);
  return database;
}

beforeEach(async () => {
  const services = createTestServices();
  logger = services.logger;
  database = services.database;
  await database.delete();
  database = new AppDatabase(logger);
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe('user data archive', () => {
  it('restores tracks, folders, markers, and settings into an empty browser', async () => {
    await database.createTrackFolder({
      schemaVersion: TRACK_FOLDER_SCHEMA_VERSION,
      id: 'folder:trips',
      ...normalizeTrackFolderName('Trips'),
      iconKey: 'folder',
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-01T09:00:00.000Z',
    });
    const content = trackContent('local:kazbegi');
    const summary = await trackSummary(content, 'Kazbegi — Гергети', 'folder:trips');
    await database.saveLocalTrack(summary, content);
    await database.replaceCalculatedTrackElevation(
      summary.id,
      {
        ...summary.metrics,
        elevationSource: 'dem-assisted',
        elevationAlgorithmVersion: 4,
      },
      content.trackPoints,
    );
    const marker = savedMarker('marker:view', 'Tbilisi view');
    await database.saveSavedMarker(marker);
    const uiPreferences = await database.loadUiPreferences();
    await database.saveUiPreferences({
      ...uiPreferences,
      locale: 'ru',
      trackSort: 'name',
    });
    await database.saveMaximumCloudCoverPercent(20);
    await database.saveTrackSyncEnabled(true);
    const folders = await database.listTrackFolders();
    const [stored] = await database.listLocalTracks();
    if (stored === undefined) throw new Error('Missing stored track.');
    const { calculatedMetrics: _calculatedMetrics, ...expectedSummary } = stored;

    const archive = await createUserDataArchive(database, exportedAt);
    const restored = await freshDatabase();
    await restoreUserDataArchive(restored, hasher, new Blob([archive]));

    expect(new TextDecoder().decode(gunzipSync(archive))).not.toContain(
      'calculatedMetrics',
    );

    await expect(restored.listLocalTracks()).resolves.toEqual([expectedSummary]);
    await expect(restored.loadLocalTrackContent(summary.id)).resolves.toEqual(content);
    await expect(restored.listTrackFolders()).resolves.toEqual(folders);
    await expect(restored.listSavedMarkers()).resolves.toEqual([marker]);
    await expect(restored.loadUiPreferences()).resolves.toEqual({
      ...uiPreferences,
      locale: 'ru',
      trackSort: 'name',
    });
    await expect(restored.loadMaximumCloudCoverPercent()).resolves.toBe(20);
    await expect(restored.loadTrackSyncEnabled()).resolves.toBe(false);
    await expect(restored.loadTrackSyncState(summary.id)).resolves.toMatchObject({
      remoteRevision: null,
      pendingKind: 'upsert',
    });
  });

  it('overrides same-ID records and settings while keeping other local records', async () => {
    const content = trackContent('local:kazbegi');
    const summary = await trackSummary(content, 'Kazbegi', null);
    await database.saveLocalTrack(summary, content);
    const stored = await database.listLocalTracks();
    const marker = savedMarker('marker:view', 'Tbilisi view');
    const unchangedMarker = savedMarker('marker:pass', 'Jvari pass');
    await database.saveSavedMarker(marker);
    await database.saveSavedMarker(unchangedMarker);
    await database.saveMaximumCloudCoverPercent(20);
    const archive = await createUserDataArchive(database, exportedAt);

    const syncedTrack = await database.loadTrackSyncState(summary.id);
    if (syncedTrack === null) throw new Error('Missing track sync state.');
    await database.saveTrackSyncState({
      ...syncedTrack,
      remoteRevision: 3,
      pendingKind: null,
    });
    for (const markerId of [marker.id, unchangedMarker.id]) {
      await database.markerSyncStates.put({
        markerId,
        remoteRevision: 5,
        pendingKind: null,
        localVersion: 1,
      });
    }
    await database.renameLocalTrack(summary.id, 'Renamed locally');
    await database.updateSavedMarker(marker.id, {
      name: 'Edited view',
      normalizedName: 'edited view',
      iconKey: 'place',
      colorKey: 'red',
      updatedAt: '2026-09-01T10:00:00.000Z',
    });
    const localOnlyMarker = savedMarker('marker:local', 'Local only');
    await database.saveSavedMarker(localOnlyMarker);
    await database.saveMaximumCloudCoverPercent(70);
    await database.saveRecentMarkerIconKeys(['place']);

    await restoreUserDataArchive(database, hasher, new Blob([archive]));

    await expect(database.listLocalTracks()).resolves.toEqual(stored);
    await expect(database.loadTrackSyncState(summary.id)).resolves.toMatchObject({
      remoteRevision: 3,
      pendingKind: 'metadata',
    });
    const markers = await database.listSavedMarkers();
    expect(markers).toHaveLength(3);
    expect(markers).toEqual(
      expect.arrayContaining([marker, unchangedMarker, localOnlyMarker]),
    );
    await expect(database.markerSyncStates.get(marker.id)).resolves.toEqual({
      markerId: marker.id,
      remoteRevision: 5,
      pendingKind: 'upsert',
      localVersion: 3,
    });
    await expect(database.markerSyncStates.get(unchangedMarker.id)).resolves.toEqual({
      markerId: unchangedMarker.id,
      remoteRevision: 5,
      pendingKind: null,
      localVersion: 1,
    });
    await expect(database.loadMaximumCloudCoverPercent()).resolves.toBe(20);
    await expect(database.loadRecentMarkerIconKeys()).resolves.toEqual([]);
  });

  it('leaves an unchanged browser untouched when re-importing its own export', async () => {
    const content = trackContent('local:kazbegi');
    const summary = await trackSummary(content, 'Kazbegi', null);
    await database.saveLocalTrack(summary, content);
    await database.replaceCalculatedTrackElevation(
      summary.id,
      {
        ...summary.metrics,
        elevationSource: 'dem-assisted',
        elevationAlgorithmVersion: 4,
      },
      content.trackPoints,
    );
    const state = await database.loadTrackSyncState(summary.id);
    if (state === null) throw new Error('Missing track sync state.');
    const cleanState = { ...state, remoteRevision: 7, pendingKind: null };
    await database.saveTrackSyncState(cleanState);
    const tracks = await database.listLocalTracks();
    const storedContent = await database.loadLocalTrackContent(summary.id);

    const archive = await createUserDataArchive(database, exportedAt);
    await restoreUserDataArchive(database, hasher, new Blob([archive]));

    await expect(database.listLocalTracks()).resolves.toEqual(tracks);
    await expect(database.loadLocalTrackContent(summary.id)).resolves.toEqual(
      storedContent,
    );
    await expect(database.loadTrackSyncState(summary.id)).resolves.toEqual(cleanState);
  });

  it('rejects an archive with an invalid record without changing local data', async () => {
    const content = trackContent('local:kazbegi');
    const summary = await trackSummary(content, 'Kazbegi', null);
    await database.saveLocalTrack(summary, content);
    await database.saveSavedMarker(savedMarker('marker:view', 'Tbilisi view'));
    const archive = await createUserDataArchive(database, exportedAt);
    // Same-length edit keeps every tar header valid while breaking the marker record.
    const tarText = new TextDecoder().decode(gunzipSync(archive));
    const tampered = gzipSync(
      new TextEncoder().encode(
        tarText.replace('"colorKey": "blue"', '"colorKey": "bluX"'),
      ),
    );
    const restored = await freshDatabase();
    const localContent = trackContent('local:other');
    const localSummary = await trackSummary(localContent, 'Local', null);
    await restored.saveLocalTrack(localSummary, localContent);

    await expect(
      restoreUserDataArchive(restored, hasher, new Blob([tampered])),
    ).rejects.toThrow();
    await expect(
      restoreUserDataArchive(restored, hasher, new Blob(['not gzip'])),
    ).rejects.toThrow();

    await expect(restored.listLocalTracks()).resolves.toEqual([localSummary]);
    await expect(restored.listSavedMarkers()).resolves.toEqual([]);
  });
});
