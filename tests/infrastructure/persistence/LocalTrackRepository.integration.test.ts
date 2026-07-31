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
  it('updates elevation atomically without discarding saved metadata', async () => {
    await database.saveLocalTrack(summary('local:1', 'Original'), content('local:1'));
    await database.renameLocalTrack('local:1', 'Renamed');
    await database.setLocalTrackFavorite('local:1', true);
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
      metrics: { ascentMeters: 200 },
    });
    await expect(database.loadLocalTrackContent('local:1')).resolves.toEqual(
      updatedContent,
    );
  });
  it('migrates v3 tracks without deleting legacy metrics or geometry', async () => {
    database.close();
    await database.delete();
    const legacy = new Dexie('GeorgiaRoutingPlanner');
    legacy.version(3).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
    });
    const legacySummary = {
      ...summary('local:legacy', 'Legacy'),
      schemaVersion: 1,
      metrics: {
        ...summary('local:legacy', 'Legacy').metrics,
        elevationSource: 'gpx',
        elevationAlgorithmVersion: 1,
      },
    };
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
      ],
    });
    legacy.close();

    database = new AppDatabase(services.logger);

    await expect(database.listLocalTracks()).resolves.toMatchObject([
      {
        schemaVersion: 2,
        id: 'local:legacy',
        metrics: {
          elevationSource: 'gpx',
          elevationAlgorithmVersion: 1,
        },
      },
    ]);
    await expect(database.loadLocalTrackContent('local:legacy')).resolves.toEqual({
      schemaVersion: 2,
      trackId: 'local:legacy',
      trackPoints: [[{ coordinate: [44, 42] }, { coordinate: [44.01, 42.01] }]],
    });
    const storedSummary = await database.localTracks.get('local:legacy');
    const storedContent = await database.localTrackContents.get('local:legacy');
    expect(storedSummary).toHaveProperty('schemaVersion', 2);
    expect(storedContent).not.toHaveProperty('originalGpx');
    expect(storedContent).not.toHaveProperty('segments');
  });

  it('saves summary and content atomically and loads both after reopen', async () => {
    await database.saveLocalTrack(summary('local:1', 'ბილიკი'), content('local:1'));
    database.close();
    database = new AppDatabase(services.logger);

    await expect(database.listLocalTracks()).resolves.toMatchObject([
      { id: 'local:1', name: 'ბილიკი' },
    ]);
    await expect(database.loadLocalTrackContent('local:1')).resolves.toMatchObject({
      trackId: 'local:1',
      trackPoints: [[{ coordinate: [44, 42] }, { coordinate: [44.01, 42.01] }]],
    });
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

  it('updates favorites without changing import date', async () => {
    await database.saveLocalTrack(summary('local:1', 'Track'), content('local:1'));

    await expect(
      database.setLocalTrackFavorite('local:1', true),
    ).resolves.toMatchObject({
      favorite: true,
      savedAt: '2026-07-22T10:00:00.000Z',
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

  it('renames only the summary and validates the trimmed name', async () => {
    await database.saveLocalTrack(summary('local:1', 'Old'), content('local:1'));
    await expect(
      database.renameLocalTrack('local:1', '  New name  '),
    ).resolves.toMatchObject({ name: 'New name', normalizedName: 'new name' });
    await expect(database.loadLocalTrackContent('local:1')).resolves.toMatchObject({
      trackId: 'local:1',
    });
    await expect(database.renameLocalTrack('local:1', '   ')).rejects.toThrow(
      'Track name is required.',
    );
  });

  it('deletes summary and content in one transaction', async () => {
    await database.saveLocalTrack(summary('local:1', 'Track'), content('local:1'));
    await database.deleteLocalTrack('local:1');

    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadLocalTrackContent('local:1')).rejects.toMatchObject({
      code: 'content-missing',
    });
  });

  it('rolls back the summary when content persistence fails', async () => {
    vi.spyOn(database.localTrackContents, 'put').mockRejectedValueOnce(
      new Error('quota unavailable'),
    );
    await expect(
      database.saveLocalTrack(summary('local:1', 'Track'), content('local:1')),
    ).rejects.toThrow('quota unavailable');
    await expect(database.localTracks.get('local:1')).resolves.toBeUndefined();
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

  it('rejects mismatched summary and content IDs before writing', async () => {
    await expect(
      database.saveLocalTrack(summary('local:1', 'Track'), content('local:2')),
    ).rejects.toMatchObject({ code: 'record-invalid' });
    await expect(database.localTracks.count()).resolves.toBe(0);
    await expect(database.localTrackContents.count()).resolves.toBe(0);
  });
});
