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
  it('replaces only calculated elevation without changing source or sync identity', async () => {
    const sourceSummary = summary('local:1', 'Original');
    const sourceContent = content('local:1');
    await database.saveLocalTrack(sourceSummary, sourceContent);
    await database.renameLocalTrack('local:1', 'Renamed');
    await database.setLocalTrackFavorite('local:1', true);
    const beforeElevation = await database.listLocalTracks();
    const beforeSyncState = await database.loadTrackSyncState('local:1');
    const calculatedTrackPoints = [
      [
        { coordinate: [44, 42] as const, elevationMeters: 900 },
        { coordinate: [44.01, 42.01] as const, elevationMeters: 1_000 },
        { coordinate: [44.02, 42.02] as const, elevationMeters: 1_100 },
      ],
    ];
    const calculatedMetrics = {
      ...sourceSummary.metrics,
      ascentMeters: 200,
      descentMeters: 50,
      elevationSource: 'dem-assisted' as const,
      elevationAlgorithmVersion: 4 as const,
    };

    const updated = await database.replaceCalculatedTrackElevation(
      'local:1',
      calculatedMetrics,
      calculatedTrackPoints,
    );

    expect(updated).toMatchObject({
      name: 'Renamed',
      favorite: true,
      pointCount: 2,
      segmentCount: 1,
      updatedAt: beforeElevation[0]?.updatedAt,
      contentHash: 'a'.repeat(64),
      metrics: sourceSummary.metrics,
      calculatedMetrics: { ascentMeters: 200, descentMeters: 50 },
    });
    await expect(database.loadTrackSyncState('local:1')).resolves.toEqual(
      beforeSyncState,
    );
    await expect(database.loadLocalTrackContent('local:1')).resolves.toEqual({
      ...sourceContent,
      calculatedTrackPoints,
    });

    const cleared = await database.replaceCalculatedTrackElevation(
      'local:1',
      null,
      undefined,
    );
    expect(cleared).not.toHaveProperty('calculatedMetrics');
    expect(cleared.metrics).toEqual(sourceSummary.metrics);
    await expect(database.loadLocalTrackContent('local:1')).resolves.toEqual(
      sourceContent,
    );
  });

  it('migrates legacy records to local schema v4 without fabricating content hashes', async () => {
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
    expect(migrated?.schemaVersion).toBe(4);
    expect(migrated?.metrics.elevationSource).toBe('gpx');
    expect(migrated?.metrics.elevationAlgorithmVersion).toBe(1);
    await expect(database.loadLocalTrackContent('local:legacy')).resolves.toEqual({
      schemaVersion: 4,
      trackId: 'local:legacy',
      trackPoints: [
        [{ coordinate: [44, 42] }, { coordinate: [44.01, 42.01] }],
        [{ coordinate: [44, 42] }, { coordinate: [44.01, 42.01] }],
      ],
    });
    const storedSummary = await database.localTracks.get('local:legacy');
    expect(storedSummary).toHaveProperty('schemaVersion', 4);
    expect(storedSummary).toHaveProperty('updatedAt', storedSummary?.savedAt);
    expect(storedSummary).not.toHaveProperty('contentHash');
    await expect(database.loadTrackSyncState('local:legacy')).resolves.toBeNull();
    await expect(database.listLocalTracks()).resolves.toHaveLength(2);
    await expect(database.listLocalTrackPairsWithoutSyncState()).resolves.toHaveLength(
      2,
    );
  });

  it('discards stale schema v4 calculated fields during the v6 upgrade', async () => {
    database.close();
    await database.delete();
    const legacy = new Dexie('GeorgiaRoutingPlanner');
    legacy.version(5).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
      trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
    });
    const sourceSummary = summary('local:v4', 'Schema v4');
    const sourceContent = content('local:v4');
    await legacy.table('localTracks').put({
      ...sourceSummary,
      calculatedMetrics: {
        ...sourceSummary.metrics,
        elevationSource: 'dem-assisted',
        elevationAlgorithmVersion: 3,
      },
    });
    await legacy.table('localTrackContents').put({
      ...sourceContent,
      calculatedTrackPoints: sourceContent.trackPoints.map((segment) =>
        segment.map((point) => ({ ...point, elevationMeters: 999 })),
      ),
    });
    await legacy.table('trackSyncStates').put({
      trackId: sourceSummary.id,
      contentHash: sourceSummary.contentHash,
      remoteRevision: 7,
      pendingKind: null,
    });
    legacy.close();

    database = new AppDatabase(services.logger);

    const [migratedSummary] = await database.listLocalTracks();
    expect(migratedSummary).toEqual(sourceSummary);
    expect(migratedSummary).not.toHaveProperty('calculatedMetrics');
    await expect(database.loadLocalTrackContent(sourceSummary.id)).resolves.toEqual(
      sourceContent,
    );
    await expect(
      database.loadLocalTrackContent(sourceSummary.id),
    ).resolves.not.toHaveProperty('calculatedTrackPoints');
    await expect(database.loadTrackSyncState(sourceSummary.id)).resolves.toEqual({
      trackId: sourceSummary.id,
      contentHash: sourceSummary.contentHash,
      lineageHash: sourceSummary.contentHash,
      geometryVersion: 1,
      remoteRevision: 7,
      pendingKind: null,
    });
  });

  it('applies the Plan 04 remote merge batch atomically', async () => {
    const record = {
      ...summary('local:remote', 'Remote'),
      metrics: {
        ...summary('local:remote', 'Remote').metrics,
        ascentMeters: 20,
        descentMeters: 154.75,
        minimumElevationMeters: -14.5,
        maximumElevationMeters: 120.25,
        elevationSource: 'gpx' as const,
        elevationAlgorithmVersion: 1 as const,
      },
    };
    const geometry = {
      ...content('local:remote'),
      trackPoints: [
        [
          { coordinate: [44, 42] as const, elevationMeters: 120.25 },
          { coordinate: [44.01, 42.01] as const, elevationMeters: -14.5 },
        ],
      ],
    };
    await database.applyRemoteTrackMergeBatch({
      put: [{ summary: record, content: geometry }],
      deleteTrackIds: [],
      states: [
        {
          trackId: record.id,
          contentHash: record.contentHash ?? '',
          lineageHash: record.contentHash ?? '',
          geometryVersion: 2,
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
      lineageHash: record.contentHash,
      geometryVersion: 2,
      remoteRevision: 3,
      pendingKind: null,
    });
    await expect(database.listLocalTrackPairsWithoutSyncState()).resolves.toEqual([]);
  });

  it('rejects a remote batch that deletes and replaces the same track', async () => {
    const record = summary('local:overlap', 'Overlap');

    await expect(
      database.applyRemoteTrackMergeBatch({
        put: [{ summary: record, content: content(record.id) }],
        deleteTrackIds: [record.id],
        states: [
          {
            trackId: record.id,
            contentHash: record.contentHash ?? '',
            lineageHash: record.contentHash ?? '',
            geometryVersion: 2,
            remoteRevision: 1,
            pendingKind: null,
          },
        ],
        usage: { usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 },
      }),
    ).rejects.toMatchObject({ code: 'record-invalid' });
    await expect(database.listLocalTracks()).resolves.toEqual([]);
  });

  it('preserves a deletion committed after a remote merge was prepared', async () => {
    const track = summary('local:deleted-before-merge', 'Local');
    await database.saveLocalTrack(track, content(track.id));
    await database.deleteLocalTrack(track.id);

    await database.applyRemoteTrackMergeBatch({
      put: [
        {
          summary: { ...track, name: 'Remote', updatedAt: '2026-07-22T12:00:00.000Z' },
          content: content(track.id),
        },
      ],
      deleteTrackIds: [],
      states: [
        {
          trackId: track.id,
          contentHash: 'a'.repeat(64),
          lineageHash: 'a'.repeat(64),
          geometryVersion: 2,
          remoteRevision: 1,
          pendingKind: null,
        },
      ],
      usage: { usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 },
    });

    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadTrackSyncState(track.id)).resolves.toEqual({
      trackId: track.id,
      contentHash: 'a'.repeat(64),
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
      remoteRevision: 1,
      pendingKind: 'delete',
    });
  });

  it('preserves a local resave that commits before a prepared remote merge', async () => {
    const track = summary('local:resaved-before-merge', 'Original');
    const resaved = {
      ...track,
      name: 'Resaved locally',
      updatedAt: '2026-07-23T12:00:00.000Z',
    };
    await database.saveLocalTrack(resaved, content(resaved.id));

    await database.applyRemoteTrackMergeBatch({
      put: [{ summary: track, content: content(track.id) }],
      deleteTrackIds: [],
      states: [
        {
          trackId: track.id,
          contentHash: track.contentHash ?? '',
          lineageHash: track.contentHash ?? '',
          geometryVersion: 2,
          remoteRevision: 3,
          pendingKind: null,
        },
      ],
      expectedStates: [
        {
          trackId: track.id,
          contentHash: track.contentHash ?? '',
          lineageHash: track.contentHash ?? '',
          geometryVersion: 2,
          remoteRevision: 2,
          pendingKind: null,
        },
      ],
      usage: { usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 },
    });

    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: resaved.id, name: resaved.name }),
    ]);
    await expect(database.loadTrackSyncState(resaved.id)).resolves.toMatchObject({
      pendingKind: 'upsert',
    });

    await database.applyRemoteTrackMergeBatch({
      put: [],
      deleteTrackIds: [resaved.id],
      states: [],
      expectedStates: [
        {
          trackId: resaved.id,
          contentHash: resaved.contentHash ?? '',
          lineageHash: resaved.contentHash ?? '',
          geometryVersion: 2,
          remoteRevision: 3,
          pendingKind: null,
        },
      ],
      usage: { usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 },
    });
    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: resaved.id, name: resaved.name }),
    ]);
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
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
      remoteRevision: 3,
      pendingKind: 'metadata',
    });
    await database.saveTrackSyncState({
      trackId: newer.id,
      contentHash: 'a'.repeat(64),
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
      remoteRevision: 5,
      pendingKind: 'upsert',
    });
    await database.saveLatestOpenedTrackId(older.id);

    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    await database.prepareUserDataSync('user-id', [
      {
        trackId: older.id,
        contentHash: 'a'.repeat(64),
        legacyContentHash: 'a'.repeat(64),
      },
      {
        trackId: newer.id,
        contentHash: 'a'.repeat(64),
        legacyContentHash: 'a'.repeat(64),
      },
    ]);

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
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
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
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
      remoteRevision: 7,
      pendingKind: null,
    });
    await database.deleteLocalTrack(deleted.id);

    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    await database.prepareUserDataSync('user-id', [
      {
        trackId: duplicate.id,
        contentHash: 'a'.repeat(64),
        legacyContentHash: 'a'.repeat(64),
      },
    ]);

    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadTrackSyncState(deleted.id)).resolves.toEqual({
      trackId: deleted.id,
      contentHash: 'a'.repeat(64),
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
      remoteRevision: 7,
      pendingKind: 'delete',
    });
    await expect(database.loadTrackSyncState(duplicate.id)).resolves.toBeNull();
  });

  it('uploads a surviving legacy duplicate after an unsent duplicate is deleted', async () => {
    const deleted = summary('local:deleted-unsent', 'Deleted');
    const survivor = summary('local:legacy-survivor', 'Survivor');
    await database.saveLocalTrack(deleted, content(deleted.id));
    await database.saveLocalTrack(survivor, content(survivor.id));
    await database.deleteLocalTrack(deleted.id);
    await database.trackSyncStates.delete(survivor.id);

    await database.prepareUserDataSync('user-id', [
      {
        trackId: survivor.id,
        contentHash: 'a'.repeat(64),
        legacyContentHash: 'a'.repeat(64),
      },
    ]);

    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: survivor.id }),
    ]);
    await expect(database.loadTrackSyncState(survivor.id)).resolves.toEqual({
      trackId: survivor.id,
      contentHash: 'a'.repeat(64),
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
      remoteRevision: null,
      pendingKind: 'upsert',
    });
    await expect(database.loadTrackSyncState(deleted.id)).resolves.toBeNull();
  });
  it('resets unknown account sync state without deleting valid local tracks', async () => {
    const retained = summary('local:retained', 'Retained');
    const tombstone = summary('local:tombstone', 'Tombstone');
    await database.saveLocalTrack(retained, content(retained.id));
    await database.saveTrackSyncState({
      trackId: retained.id,
      contentHash: retained.contentHash ?? '',
      lineageHash: retained.contentHash ?? '',
      geometryVersion: 2,
      remoteRevision: 8,
      pendingKind: null,
    });
    await database.saveLocalTrack(tombstone, content(tombstone.id));
    await database.saveTrackSyncState({
      trackId: tombstone.id,
      contentHash: tombstone.contentHash ?? '',
      lineageHash: tombstone.contentHash ?? '',
      geometryVersion: 2,
      remoteRevision: 4,
      pendingKind: null,
    });
    await database.deleteLocalTrack(tombstone.id);
    await database.settings.put({
      key: 'sync.user-id',
      value: 'another-user',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    await database.saveTrackSyncUsage({
      usedBytes: 512,
      reservedBytes: 128,
      limitBytes: 8_388_608,
    });

    await database.prepareUserDataSync('current-user', [
      {
        trackId: retained.id,
        contentHash: retained.contentHash ?? '',
        legacyContentHash: retained.contentHash ?? '',
      },
    ]);

    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: retained.id }),
    ]);
    await expect(database.loadTrackSyncState(retained.id)).resolves.toEqual({
      trackId: retained.id,
      contentHash: retained.contentHash,
      lineageHash: retained.contentHash,
      geometryVersion: 2,
      remoteRevision: null,
      pendingKind: 'upsert',
    });
    await expect(database.loadTrackSyncState(tombstone.id)).resolves.toBeNull();
    await expect(database.settings.get('sync.user-id')).resolves.toMatchObject({
      value: 'current-user',
    });
    await expect(database.loadTrackSyncUsage()).resolves.toEqual({
      usedBytes: 0,
      reservedBytes: 0,
      limitBytes: 8_388_608,
    });
  });

  it('applies remote deletion choices atomically without resurrecting absent tracks', async () => {
    const deleted = summary('local:delete-choice', 'Delete');
    const restored = {
      ...summary('local:restore-choice', 'Restore'),
      contentHash: 'b'.repeat(64),
    };
    const absent = {
      ...summary('local:absent-choice', 'Absent'),
      contentHash: 'c'.repeat(64),
    };
    await database.saveLocalTrack(deleted, content(deleted.id));
    await database.saveLocalTrack(restored, content(restored.id));
    await database.saveLocalTrack(absent, content(absent.id));
    await database.saveLatestOpenedTrackId(deleted.id);
    await database.deleteLocalTrack(absent.id);
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-08-10T00:00:00.000Z',
    });

    await database.resolveRemoteDeletions({
      expectedUserId: 'user-id',
      trackCandidateIds: [deleted.id, restored.id],
      markerCandidateIds: [],
      tracks: { deleteIds: [deleted.id], restoreIds: [restored.id] },
      markers: { deleteIds: [], restoreIds: [] },
    });

    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: restored.id }),
    ]);
    await expect(database.loadLatestOpenedTrackId()).resolves.toBeNull();
    await expect(database.loadTrackSyncState(deleted.id)).resolves.toBeNull();
    await expect(database.loadTrackSyncState(restored.id)).resolves.toEqual({
      trackId: restored.id,
      contentHash: restored.contentHash,
      lineageHash: restored.contentHash,
      geometryVersion: 2,
      remoteRevision: null,
      pendingKind: 'upsert',
    });
    await expect(database.loadTrackSyncState(absent.id)).resolves.toMatchObject({
      trackId: absent.id,
      pendingKind: 'delete',
    });
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
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
      remoteRevision: 4,
      pendingKind: null,
    });
    await database.setLocalTrackFavorite('local:1', true);
    await expect(database.loadTrackSyncState('local:1')).resolves.toMatchObject({
      remoteRevision: 4,
      pendingKind: 'metadata',
    });
  });

  it('retains deletion intent for both unsent and synchronized tracks', async () => {
    await database.saveLocalTrack(
      summary('local:unsent', 'Unsent'),
      content('local:unsent'),
    );
    await database.deleteLocalTrack('local:unsent');
    await expect(database.loadTrackSyncState('local:unsent')).resolves.toEqual({
      trackId: 'local:unsent',
      contentHash: 'a'.repeat(64),
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
      remoteRevision: null,
      pendingKind: 'delete',
    });

    await database.saveLocalTrack(summary('local:sent', 'Sent'), content('local:sent'));
    await database.saveTrackSyncState({
      trackId: 'local:sent',
      contentHash: 'a'.repeat(64),
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
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
      lineageHash: 'a'.repeat(64),
      geometryVersion: 2,
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
