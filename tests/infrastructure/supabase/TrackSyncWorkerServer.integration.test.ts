import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { WorkerRpcClient } from '@/infrastructure/runtime/WorkerRpc';
import { TrackSyncWorkerServer } from '@/infrastructure/supabase/TrackSyncWorkerServer';
import {
  trackSyncWorkerEventNames,
  trackSyncWorkerMethods,
} from '@/infrastructure/supabase/TrackSyncWorkerClient';
import { createTestServices } from '@test/helpers/createTestServices';
import { createMemoryWorkerRpcEndpointPair } from '@test/helpers/MemoryWorkerRpcEndpoint';

const contentHash = 'a'.repeat(64);
let database: AppDatabase;
let services: ReturnType<typeof createTestServices>;

function summary(id: string): LocalTrackSummary {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    id,
    name: 'Track',
    normalizedName: 'track',
    savedAt: '2026-07-22T10:00:00.000Z',
    updatedAt: '2026-07-22T10:00:00.000Z',
    contentHash,
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
    },
    metadata: { version: '1.1', links: [] },
    warnings: [],
  };
}

function content(trackId: string): LocalTrackContent {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId,
    trackPoints: [[{ coordinate: [44, 42] }, { coordinate: [44.01, 42.01] }]],
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

describe('TrackSyncWorkerServer', () => {
  it('applies an uploaded revision through one batch and publishes one event', async () => {
    const track = summary('local:track');
    await database.saveLocalTrack(track, content(track.id));
    const calls: string[] = [];
    const gateway = {
      status: vi.fn(() => {
        calls.push('status');
        return Promise.resolve({
          usedBytes: 128,
          reservedBytes: 0,
          limitBytes: 8_388_608,
        });
      }),
      snapshot: vi
        .fn()
        .mockImplementationOnce(() => {
          calls.push('snapshot');
          return Promise.resolve([]);
        })
        .mockImplementationOnce(() => {
          calls.push('snapshot');
          return Promise.resolve([
            {
              content_hash: contentHash,
              revision: 1,
              state: 'reserved' as const,
              object_path: `user/${contentHash}/upload.grpt.gz`,
              compressed_bytes: 128,
              metadata: {},
            },
          ]);
        }),
      mutate: vi.fn(() => {
        calls.push('mutate');
        return Promise.resolve({ outcome: 'applied' as const, revision: 1 });
      }),
      download: vi.fn(),
    };
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => gateway);
    const client = new WorkerRpcClient(clientEndpoint);
    const changed = vi.fn();
    client.subscribeEvent(trackSyncWorkerEventNames.tracksChanged, changed);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
      }),
    ).resolves.toEqual({
      usage: { usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 },
      changed: true,
    });
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalledOnce();
    });
    expect(calls).toEqual(['status', 'snapshot', 'mutate', 'status', 'snapshot']);
    await expect(database.loadTrackSyncState(track.id)).resolves.toEqual({
      trackId: track.id,
      contentHash,
      remoteRevision: 1,
      pendingKind: null,
    });
    client.dispose();
  });

  it('hard-deletes a known remote track absent from the second snapshot', async () => {
    const track = summary('local:known');
    await database.saveLocalTrack(track, content(track.id));
    await database.saveTrackSyncState({
      trackId: track.id,
      contentHash,
      remoteRevision: 2,
      pendingKind: null,
    });
    await database.saveLatestOpenedTrackId(track.id);
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: () => Promise.resolve([]),
      mutate: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
      }),
    ).resolves.toMatchObject({ changed: true });
    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadTrackSyncState(track.id)).resolves.toBeNull();
    await expect(database.loadLatestOpenedTrackId()).resolves.toBeNull();
    client.dispose();
  });

  it('preserves pending local data when the first remote snapshot is invalid', async () => {
    const track = summary('local:pending');
    await database.saveLocalTrack(track, content(track.id));
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: () => Promise.reject(new Error('invalid remote response')),
      mutate: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
      }),
    ).rejects.toMatchObject({ message: 'invalid remote response' });
    await expect(database.loadTrackSyncState(track.id)).resolves.toMatchObject({
      pendingKind: 'upsert',
    });
    client.dispose();
  });
});
