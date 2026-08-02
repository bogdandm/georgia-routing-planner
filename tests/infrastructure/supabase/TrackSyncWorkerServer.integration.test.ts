import { Blob as NodeBlob } from 'node:buffer';
import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import {
  AppDatabase,
  type LocalTrackSyncPair,
} from '@/infrastructure/persistence/AppDatabase';
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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined)
    throw new Error('Deferred promise initialization failed.');
  return { promise, resolve: resolvePromise };
}

function bytesFromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

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
  vi.unstubAllGlobals();
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
  it('rebases a conflicting pending action exactly once', async () => {
    const track = summary('local:rebase');
    await database.saveLocalTrack(track, content(track.id));
    await database.saveTrackSyncState({
      trackId: track.id,
      contentHash,
      remoteRevision: 1,
      pendingKind: 'metadata',
    });
    const mutate = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'conflict' as const, revision: 2 })
      .mockResolvedValueOnce({ outcome: 'applied' as const, revision: 3 });
    const remote = {
      content_hash: contentHash,
      revision: 3,
      state: 'ready' as const,
      object_path: `user/${contentHash}/upload.grpt.gz`,
      compressed_bytes: 128,
      metadata: {},
    };
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: vi.fn().mockResolvedValue([remote]),
      mutate,
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
    });

    expect(mutate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ remoteRevision: 1 }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(mutate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ remoteRevision: 2 }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    await expect(database.loadTrackSyncState(track.id)).resolves.toMatchObject({
      remoteRevision: 3,
      pendingKind: null,
    });
    client.dispose();
  });

  it('hard-deletes a known track when its pending mutation returns missing', async () => {
    const track = summary('local:missing');
    await database.saveLocalTrack(track, content(track.id));
    await database.saveTrackSyncState({
      trackId: track.id,
      contentHash,
      remoteRevision: 2,
      pendingKind: 'metadata',
    });
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: vi.fn().mockResolvedValue([]),
      mutate: vi.fn().mockResolvedValue({ outcome: 'missing' as const }),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
    });

    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadTrackSyncState(track.id)).resolves.toBeNull();
    client.dispose();
  });

  it('removes local rows after a successful pending delete mutation', async () => {
    const track = summary('local:delete');
    await database.saveLocalTrack(track, content(track.id));
    await database.saveTrackSyncState({
      trackId: track.id,
      contentHash,
      remoteRevision: 2,
      pendingKind: 'delete',
    });
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: vi.fn().mockResolvedValue([]),
      mutate: vi.fn().mockResolvedValue({ outcome: 'applied' as const, revision: 0 }),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
    });

    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadTrackSyncState(track.id)).resolves.toBeNull();
    client.dispose();
  });

  it('downloads a new remote track under its deterministic local identifier', async () => {
    const fixture = JSON.parse(
      await readFile('tests/fixtures/track-sync/geometry-v1.json', 'utf8'),
    ) as { readonly gzipHex: string; readonly sha256: string };
    const remoteHash = fixture.sha256;
    vi.stubGlobal('Blob', NodeBlob);
    const compressed = bytesFromHex(fixture.gzipHex);
    const remote = {
      content_hash: remoteHash,
      revision: 2,
      state: 'ready' as const,
      object_path: `user/${remoteHash}/upload.grpt.gz`,
      compressed_bytes: compressed.byteLength,
      metadata: {
        name: 'Remote track',
        savedAt: '2026-07-22T10:00:00.000Z',
        updatedAt: '2026-07-22T10:00:00.000Z',
        sourceFilename: 'remote.gpx',
        sourceFormat: 'gpx',
        favorite: false,
        geometryKind: 'track',
        metadata: { version: '1.1', links: [] },
        warnings: [],
      },
    };
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({
          usedBytes: compressed.byteLength,
          reservedBytes: 0,
          limitBytes: 8_388_608,
        }),
      snapshot: vi.fn().mockResolvedValue([remote]),
      mutate: vi.fn(),
      download: vi.fn().mockResolvedValue(compressed),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
    });

    const localId = `local:sync:${remoteHash}`;
    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({
        id: localId,
        contentHash: remoteHash,
        name: 'Remote track',
      }),
    ]);
    await expect(database.loadTrackSyncState(localId)).resolves.toMatchObject({
      remoteRevision: 2,
      pendingKind: null,
    });
    client.dispose();
  });

  it('preserves a rename made while an upsert mutation is active', async () => {
    const track = summary('local:renamed');
    await database.saveLocalTrack(track, content(track.id));
    const mutation = deferred<{ outcome: 'applied'; revision: number }>();
    let markMutationStarted: (() => void) | null = null;
    const mutationStarted = new Promise<void>((resolve) => {
      markMutationStarted = resolve;
    });
    const mutate = vi
      .fn()
      .mockImplementationOnce(() => {
        markMutationStarted?.();
        return mutation.promise;
      })
      .mockResolvedValue({ outcome: 'applied' as const, revision: 1 });
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          content_hash: contentHash,
          revision: 1,
          state: 'ready' as const,
          object_path: `user/${contentHash}/upload.grpt.gz`,
          compressed_bytes: 128,
          metadata: {},
        },
      ]);
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot,
      mutate,
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);
    const synchronization = client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
    });

    await mutationStarted;
    await database.renameLocalTrack(track.id, 'Renamed');
    await expect(database.loadTrackSyncState(track.id)).resolves.toMatchObject({
      pendingKind: 'upsert',
    });
    mutation.resolve({ outcome: 'applied', revision: 1 });
    await synchronization;

    await expect(database.loadTrackSyncState(track.id)).resolves.toMatchObject({
      pendingKind: 'upsert',
    });
    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: track.id, name: 'Renamed' }),
    ]);

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
    });
    await expect(database.loadTrackSyncState(track.id)).resolves.toMatchObject({
      remoteRevision: 1,
      pendingKind: null,
    });
    expect(mutate).toHaveBeenCalledTimes(2);
    const secondMutation = mutate.mock.calls[1] as unknown as [
      unknown,
      LocalTrackSyncPair,
      AbortSignal,
    ];
    expect(secondMutation[1].summary.name).toBe('Renamed');
    client.dispose();
  });
});
