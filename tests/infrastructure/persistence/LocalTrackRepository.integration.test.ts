import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalTrackStorageError } from '@/application/ports/LocalTrackRepository';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { createTestServices } from '@test/helpers/createTestServices';

let database: AppDatabase;
let services: ReturnType<typeof createTestServices>;

function summary(id: string, name: string): LocalTrackSummary {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    id,
    name,
    normalizedName: name.toLocaleLowerCase('en'),
    savedAt: '2026-07-22T10:00:00.000Z',
    updatedAt: '2026-07-22T10:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sourceFilename: 'fixture.gpx',
    sourceFormat: 'gpx',
    favorite: false,
    geometryKind: 'track',
    pointCount: 2,
    segmentCount: 1,
    metrics: {
      distanceMeters: 1_000,
      distanceAlgorithmVersion: 1,
      startCoordinate: [44, 42],
      endCoordinate: [44.01, 42.01],
      bounds: {
        west: 44,
        south: 42,
        east: 44.01,
        north: 42.01,
        crossesAntimeridian: false,
      },
      center: [44.005, 42.005],
      elevationSource: 'dem-assisted',
      elevationAlgorithmVersion: 3,
    },
    metadata: { version: '1.1', links: [] },
    warnings: [],
  };
}

function content(trackId: string): LocalTrackContent {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId,
    trackPoints: [
      [
        { coordinate: [44, 42], elevationMeters: 1_000 },
        { coordinate: [44.01, 42.01], elevationMeters: 1_120 },
      ],
    ],
  };
}

beforeEach(async () => {
  services = createTestServices();
  database = services.database;
  await database.delete();
  database = new AppDatabase(services.logger);
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe('local track persistence', () => {
  it('updates elevation atomically without changing sync identity or metadata time', async () => {
    await database.saveLocalTrack(summary('local:1', 'Original'), content('local:1'));
    await database.renameLocalTrack('local:1', 'Renamed');
    await database.setLocalTrackFavorite('local:1', true);
    const beforeElevation = await database.listLocalTracks();
    const updatedContent: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:1',
      trackPoints: [
        [
          { coordinate: [44, 42], elevationMeters: 900 },
          { coordinate: [44.01, 42.01], elevationMeters: 1_000 },
          { coordinate: [44.02, 42.02], elevationMeters: 1_100 },
        ],
      ],
    };

    const updated = await database.replaceLocalTrackElevation(
      'local:1',
      { ...summary('local:1', 'Original').metrics, ascentMeters: 200 },
      updatedContent,
    );

    expect(updated).toMatchObject({
      name: 'Renamed',
      favorite: true,
      pointCount: 3,
      segmentCount: 1,
      updatedAt: beforeElevation[0]?.updatedAt,
      contentHash: 'a'.repeat(64),
      metrics: { ascentMeters: 200 },
    });
    await expect(database.loadTrackSyncState('local:1')).resolves.toMatchObject({
      pendingKind: 'upsert',
    });
    await expect(database.loadLocalTrackContent('local:1')).resolves.toEqual(
      updatedContent,
    );
  });

  it('migrates v4 records to local schema v3 without fabricating content hashes', async () => {
    database.close();
    await database.delete();
    const legacy = new Dexie('GeorgiaRoutingPlanner');
    legacy.version(4).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
    });
    const currentSummary = summary('local:legacy', 'Legacy');
    const legacySummary: Record<string, unknown> = {
      ...currentSummary,
      schemaVersion: 2,
      metrics: {
        ...currentSummary.metrics,
        elevationSource: 'gpx',
        elevationAlgorithmVersion: 1,
      },
    };
    delete legacySummary.contentHash;
    delete legacySummary.updatedAt;
    await legacy.table('localTracks').put(legacySummary);
    await legacy.table('localTrackContents').put({
      schemaVersion: 1,
      trackId: 'local:legacy',
      originalGpx: new Blob(['<gpx/>']),
      segments: [
        [
          [44, 42],
          [44.01, 42.01],
        ],
        [
          [44, 42],
          [44.01, 42.01],
        ],
      ],
    });
    await legacy.table('localTracks').put({
      ...legacySummary,
      id: 'local:legacy-duplicate',
    });
    await legacy.table('localTrackContents').put({
      schemaVersion: 1,
      trackId: 'local:legacy-duplicate',
      segments: [
        [
          [44, 42],
          [44.01, 42.01],
        ],
        [
          [44, 42],
          [44.01, 42.01],
        ],
      ],
    });
    legacy.close();

    database = new AppDatabase(services.logger);

    const migratedTracks = await database.listLocalTracks();
    const migrated = migratedTracks.find((track) => track.id === 'local:legacy');
    expect(migrated?.schemaVersion).toBe(3);
    expect(migrated?.metrics.elevationSource).toBe('gpx');
    expect(migrated?.metrics.elevationAlgorithmVersion).toBe(1);
    await expect(database.loadLocalTrackContent('local:legacy')).resolves.toEqual({
      schemaVersion: 3,
      trackId: 'local:legacy',
      trackPoints: [
        [{ coordinate: [44, 42] }, { coordinate: [44.01, 42.01] }],
        [{ coordinate: [44, 42] }, { coordinate: [44.01, 42.01] }],
      ],
    });
    const storedSummary = await database.localTracks.get('local:legacy');
    expect(storedSummary).toHaveProperty('schemaVersion', 3);
    expect(storedSummary).toHaveProperty('updatedAt', storedSummary?.savedAt);
    expect(storedSummary).not.toHaveProperty('contentHash');
    await expect(database.loadTrackSyncState('local:legacy')).resolves.toBeNull();
    await expect(database.listLocalTracks()).resolves.toHaveLength(2);
    await expect(database.listLocalTrackPairsWithoutSyncState()).resolves.toHaveLength(
      2,
    );
  });

  it('applies the Plan 04 remote merge batch atomically', async () => {
    const record = summary('local:remote', 'Remote');
    const geometry = content('local:remote');
    await database.applyRemoteTrackMergeBatch({
      put: [{ summary: record, content: geometry }],
      deleteTrackIds: [],
      states: [
        {
          trackId: record.id,
          contentHash: record.contentHash ?? '',
          remoteRevision: 3,
          pendingKind: null,
        },
      ],
      usage: { usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 },
    });

    await expect(database.loadLocalTrackContent(record.id)).resolves.toEqual(geometry);
    await expect(database.loadTrackSyncState(record.id)).resolves.toEqual({
      trackId: record.id,
      contentHash: record.contentHash,
      remoteRevision: 3,
      pendingKind: null,
    });
    await expect(database.listLocalTrackPairsWithoutSyncState()).resolves.toEqual([]);
  });

  it('collapses duplicate hashes before sync with canonical metadata and precedence', async () => {
    const older = {
      ...summary('local:older', 'Older'),
      savedAt: '2026-07-22T09:00:00.000Z',
      updatedAt: '2026-07-22T10:00:00.000Z',
    };
    const newer = {
      ...summary('local:newer', 'Newer'),
      savedAt: '2026-07-22T11:00:00.000Z',
      updatedAt: '2026-07-22T12:00:00.000Z',
      favorite: true,
    };
    await database.saveLocalTrack(older, content(older.id));
    await database.saveLocalTrack(newer, content(newer.id));
    await database.saveTrackSyncState({
      trackId: older.id,
      contentHash: 'a'.repeat(64),
      remoteRevision: 3,
      pendingKind: 'metadata',
    });
    await database.saveTrackSyncState({
      trackId: newer.id,
      contentHash: 'a'.repeat(64),
      remoteRevision: 5,
      pendingKind: 'upsert',
    });
    await database.saveLatestOpenedTrackId(older.id);

    await database.backfillAndDeduplicateTrackSync([]);

    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({
        id: newer.id,
        name: 'Newer',
        favorite: true,
        savedAt: older.savedAt,
      }),
    ]);
    await expect(database.loadLatestOpenedTrackId()).resolves.toBe(newer.id);
    await expect(database.loadTrackSyncState(newer.id)).resolves.toEqual({
      trackId: newer.id,
      contentHash: 'a'.repeat(64),
      remoteRevision: 5,
      pendingKind: 'upsert',
    });
    await expect(database.loadTrackSyncState(older.id)).resolves.toBeNull();
    await expect(database.loadLocalTrackContent(older.id)).rejects.toMatchObject({
      code: 'content-missing',
    });
  });

  it('gives a pair-less known remote deletion precedence over duplicate geometry', async () => {
    const deleted = summary('local:deleted', 'Deleted');
    const duplicate = summary('local:duplicate', 'Duplicate');
    await database.saveLocalTrack(deleted, content(deleted.id));
    await database.saveLocalTrack(duplicate, content(duplicate.id));
    await database.saveTrackSyncState({
      trackId: deleted.id,
      contentHash: 'a'.repeat(64),
      remoteRevision: 7,
      pendingKind: null,
    });
    await database.deleteLocalTrack(deleted.id);

    await database.backfillAndDeduplicateTrackSync([]);

    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadTrackSyncState(deleted.id)).resolves.toEqual({
      trackId: deleted.id,
      contentHash: 'a'.repeat(64),
      remoteRevision: 7,
      pendingKind: 'delete',
    });
    await expect(database.loadTrackSyncState(duplicate.id)).resolves.toBeNull();
  });

  it('saves track rows and the pending upsert atomically', async () => {
    await database.saveLocalTrack(summary('local:1', 'ბილიკი'), content('local:1'));
    await expect(database.loadTrackSyncState('local:1')).resolves.toMatchObject({
      contentHash: 'a'.repeat(64),
      pendingKind: 'upsert',
      remoteRevision: null,
    });

    vi.spyOn(database.trackSyncStates, 'put').mockRejectedValueOnce(
      new Error('quota unavailable'),
    );
    await expect(
      database.saveLocalTrack(summary('local:2', 'Broken'), content('local:2')),
    ).rejects.toThrow('quota unavailable');
    await expect(database.localTracks.get('local:2')).resolves.toBeUndefined();
    await expect(database.localTrackContents.get('local:2')).resolves.toBeUndefined();
  });

  it('preserves upsert precedence and turns synchronized metadata into metadata work', async () => {
    await database.saveLocalTrack(summary('local:1', 'Track'), content('local:1'));
    await database.renameLocalTrack('local:1', 'Renamed');
    await expect(database.loadTrackSyncState('local:1')).resolves.toMatchObject({
      pendingKind: 'upsert',
    });
    await database.saveTrackSyncState({
      trackId: 'local:1',
      contentHash: 'a'.repeat(64),
      remoteRevision: 4,
      pendingKind: null,
    });
    await database.setLocalTrackFavorite('local:1', true);
    await expect(database.loadTrackSyncState('local:1')).resolves.toMatchObject({
      remoteRevision: 4,
      pendingKind: 'metadata',
    });
  });

  it('deletes unsent upserts and retains only sent deletion retry state', async () => {
    await database.saveLocalTrack(
      summary('local:unsent', 'Unsent'),
      content('local:unsent'),
    );
    await database.deleteLocalTrack('local:unsent');
    await expect(database.loadTrackSyncState('local:unsent')).resolves.toBeNull();

    await database.saveLocalTrack(summary('local:sent', 'Sent'), content('local:sent'));
    await database.saveTrackSyncState({
      trackId: 'local:sent',
      contentHash: 'a'.repeat(64),
      remoteRevision: 8,
      pendingKind: null,
    });
    await database.deleteLocalTrack('local:sent');
    await expect(database.localTracks.get('local:sent')).resolves.toBeUndefined();
    await expect(
      database.localTrackContents.get('local:sent'),
    ).resolves.toBeUndefined();
    await expect(database.loadTrackSyncState('local:sent')).resolves.toEqual({
      trackId: 'local:sent',
      contentHash: 'a'.repeat(64),
      remoteRevision: 8,
      pendingKind: 'delete',
    });
  });

  it('restores and clears the latest opened track identifier', async () => {
    await database.saveLocalTrack(summary('local:1', 'Track'), content('local:1'));
    await database.saveLatestOpenedTrackId('local:1');
    database.close();
    database = new AppDatabase(services.logger);

    await expect(database.loadLatestOpenedTrackId()).resolves.toBe('local:1');
    await database.deleteLocalTrack('local:1');
    await expect(database.loadLatestOpenedTrackId()).resolves.toBeNull();
  });

  it('sorts favorites first, then newest first with a stable ID tie-breaker', async () => {
    await database.saveLocalTrack(
      { ...summary('local:3', 'Older'), savedAt: '2026-07-20T10:00:00.000Z' },
      content('local:3'),
    );
    await database.saveLocalTrack(summary('local:2', 'Newest'), content('local:2'));
    await database.saveLocalTrack(
      { ...summary('local:1', 'Favorite'), favorite: true },
      content('local:1'),
    );

    await expect(database.listLocalTracks()).resolves.toMatchObject([
      { id: 'local:1' },
      { id: 'local:2' },
      { id: 'local:3' },
    ]);
  });

  it('rejects mismatched summary and content IDs before writing', async () => {
    await expect(
      database.saveLocalTrack(summary('local:1', 'Track'), content('local:2')),
    ).rejects.toMatchObject({ code: 'record-invalid' });
    await expect(database.localTracks.count()).resolves.toBe(0);
    await expect(database.localTrackContents.count()).resolves.toBe(0);
  });

  it('skips corrupt summaries and reports missing content as bounded errors', async () => {
    await database.table('localTracks').put({ id: 'broken' });
    await database.localTracks.put(summary('local:1', 'Track'));

    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: 'local:1' }),
    ]);
    expect(
      services.logger
        .getEvents()
        .some((event) => event.name === 'storage.local-tracks.invalid-summary'),
    ).toBe(true);
    await expect(database.loadLocalTrackContent('local:1')).rejects.toBeInstanceOf(
      LocalTrackStorageError,
    );
  });
});
