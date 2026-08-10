import { Blob as NodeBlob } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateTrackMetrics } from '@/domain/tracks/trackCalculations';
import {
  SAVED_MARKER_SCHEMA_VERSION,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  encodeLegacyTrackSyncGeometry,
  encodeTrackSyncGeometry,
} from '@/domain/tracks/trackSyncGeometry';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import {
  AppDatabase,
  type LocalTrackSyncPair,
  type TrackSyncState,
} from '@/infrastructure/persistence/AppDatabase';
import { WorkerRpcClient } from '@/infrastructure/runtime/WorkerRpc';
import { TrackSyncWorkerServer } from '@/infrastructure/supabase/TrackSyncWorkerServer';
import {
  TrackSyncWorkerError,
  trackSyncWorkerEventNames,
  trackSyncWorkerMethods,
} from '@/infrastructure/supabase/TrackSyncWorkerClient';
import { createTestServices } from '@test/helpers/createTestServices';
import { createMemoryWorkerRpcEndpointPair } from '@test/helpers/MemoryWorkerRpcEndpoint';

const contentHash = 'fbc774b019984d159f533a4309b4b786fee09a1723f243d5eb020495af9e3ba1';
const legacyContentHash =
  '86065d77853f4248bb3da66ebc566dc5bf59bb8e4ab6d3cd926427b6129663a1';
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

function marker(overrides: Partial<SavedMarker> = {}): SavedMarker {
  return {
    schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
    id: 'marker:one',
    name: 'Tbilisi view',
    normalizedName: 'tbilisi view',
    coordinate: [44.8, 41.7],
    iconKey: 'place',
    colorKey: 'blue',
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    ...overrides,
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
      deleteRemoteRecord: vi.fn(),
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
        userId: 'user-id',
        sessionRevision: 0,
      }),
    ).resolves.toEqual({
      usage: { usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 },
      changed: { tracks: true, markers: false },
      remoteTrackDeletions: [],
      remoteMarkerDeletions: [],
    });
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalledOnce();
    });
    expect(calls).toEqual(['status', 'snapshot', 'mutate', 'status', 'snapshot']);
    await expect(database.loadTrackSyncState(track.id)).resolves.toEqual({
      trackId: track.id,
      contentHash,
      lineageHash: legacyContentHash,
      geometryVersion: 2,
      remoteRevision: 1,
      pendingKind: null,
    });
    client.dispose();
  });

  it('publishes reconciled progress for pending uploads and remote downloads', async () => {
    const fixture = JSON.parse(
      await readFile('tests/fixtures/track-sync/geometry-v1.json', 'utf8'),
    ) as { readonly gzipHex: string; readonly sha256: string };
    const track = summary('local:pending');
    await database.saveLocalTrack(track, content(track.id));
    const compressed = bytesFromHex(fixture.gzipHex);
    vi.stubGlobal('Blob', NodeBlob);
    const remote = {
      content_hash: fixture.sha256,
      revision: 2,
      state: 'ready' as const,
      object_path: `user/${fixture.sha256}/upload.grpt.gz`,
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
    const localRemote = {
      content_hash: contentHash,
      revision: 1,
      state: 'reserved' as const,
      object_path: `user/${contentHash}/upload.grpt.gz`,
      compressed_bytes: 128,
      metadata: {},
    };
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({
          usedBytes: compressed.byteLength,
          reservedBytes: 0,
          limitBytes: 8_388_608,
        }),
      snapshot: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([localRemote, remote]),
      mutate: vi.fn().mockResolvedValue({ outcome: 'applied' as const, revision: 1 }),
      deleteRemoteRecord: vi.fn(),
      download: vi.fn().mockResolvedValue(compressed),
    }));
    const client = new WorkerRpcClient(clientEndpoint);
    const progress: { completedItems: number; totalItems: number }[] = [];
    client.subscribeEvent(trackSyncWorkerEventNames.progress, (payload) => {
      progress.push(payload as { completedItems: number; totalItems: number });
    });

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
    });

    await vi.waitFor(() => {
      expect(progress).toEqual([
        { completedItems: 0, totalItems: 1 },
        { completedItems: 1, totalItems: 1 },
        { completedItems: 1, totalItems: 2 },
        { completedItems: 2, totalItems: 2 },
      ]);
    });
    await expect(database.listLocalTracks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: track.id }),
        expect.objectContaining({ contentHash: fixture.sha256 }),
      ]),
    );
    client.dispose();
  });
  it('returns a decision candidate for a known remote track absent from the snapshot', async () => {
    const track = summary('local:known');
    await database.saveLocalTrack(track, content(track.id));
    await database.saveTrackSyncState({
      trackId: track.id,
      contentHash,
      lineageHash: contentHash,
      geometryVersion: 2,
      remoteRevision: 2,
      pendingKind: null,
    });
    await database.saveLatestOpenedTrackId(track.id);
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: () => Promise.resolve([]),
      mutate: vi.fn(),
      deleteRemoteRecord: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 0,
      }),
    ).resolves.toMatchObject({
      changed: { tracks: false, markers: false },
      remoteTrackDeletions: [{ trackId: track.id, name: track.name }],
    });
    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: track.id }),
    ]);
    await expect(database.loadTrackSyncState(track.id)).resolves.toEqual({
      trackId: track.id,
      contentHash,
      lineageHash: contentHash,
      geometryVersion: 2,
      remoteRevision: 2,
      pendingKind: null,
    });
    await expect(database.loadLatestOpenedTrackId()).resolves.toBe(track.id);
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
      deleteRemoteRecord: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 0,
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
      lineageHash: contentHash,
      geometryVersion: 2,
      remoteRevision: 1,
      pendingKind: 'metadata',
    });
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
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
      deleteRemoteRecord: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
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

  it('returns a candidate when a pending metadata mutation is missing remotely', async () => {
    const track = summary('local:missing');
    await database.saveLocalTrack(track, content(track.id));
    await database.saveTrackSyncState({
      trackId: track.id,
      contentHash,
      lineageHash: contentHash,
      geometryVersion: 2,
      remoteRevision: 2,
      pendingKind: 'metadata',
    });
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: vi.fn().mockResolvedValue([]),
      mutate: vi.fn().mockResolvedValue({ outcome: 'missing' as const }),
      deleteRemoteRecord: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 0,
      }),
    ).resolves.toMatchObject({
      changed: { tracks: false, markers: false },
      remoteTrackDeletions: [{ trackId: track.id, name: track.name }],
    });
    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: track.id }),
    ]);
    await expect(database.loadTrackSyncState(track.id)).resolves.toEqual({
      trackId: track.id,
      contentHash,
      lineageHash: contentHash,
      geometryVersion: 2,
      remoteRevision: 2,
      pendingKind: 'metadata',
    });
    client.dispose();
  });

  it('removes local rows after a successful pending delete mutation', async () => {
    const track = summary('local:delete');
    await database.saveLocalTrack(track, content(track.id));
    await database.saveTrackSyncState({
      trackId: track.id,
      contentHash,
      lineageHash: contentHash,
      geometryVersion: 2,
      remoteRevision: 2,
      pendingKind: 'delete',
    });
    await database.deleteLocalTrack(track.id);
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: vi.fn().mockResolvedValue([]),
      mutate: vi.fn().mockResolvedValue({ outcome: 'applied' as const, revision: 0 }),
      deleteRemoteRecord: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 0,
      }),
    ).resolves.toMatchObject({ remoteTrackDeletions: [] });

    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadTrackSyncState(track.id)).resolves.toBeNull();
    client.dispose();
  });

  it('preserves a track re-saved while its pending remote delete is in flight', async () => {
    const track = summary('local:delete-resaved');
    const restored = {
      ...track,
      name: 'Restored local track',
      updatedAt: '2026-07-23T12:00:00.000Z',
    };
    await database.saveLocalTrack(track, content(track.id));
    await database.saveTrackSyncState({
      trackId: track.id,
      contentHash,
      lineageHash: contentHash,
      geometryVersion: 2,
      remoteRevision: 2,
      pendingKind: 'delete',
    });
    await database.deleteLocalTrack(track.id);
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: vi.fn().mockResolvedValue([]),
      mutate: vi.fn().mockImplementation(async () => {
        await database.saveLocalTrack(restored, content(restored.id));
        return { outcome: 'applied' as const, revision: 0 };
      }),
      deleteRemoteRecord: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
    });

    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: restored.id, name: restored.name }),
    ]);
    await expect(database.loadTrackSyncState(restored.id)).resolves.toMatchObject({
      pendingKind: 'upsert',
    });
    client.dispose();
  });

  it('preserves account-A browser tracks while merging account-B remote tracks', async () => {
    const local = summary('local:account-a');
    await database.saveLocalTrack(local, content(local.id));
    await database.saveTrackSyncState({
      trackId: local.id,
      contentHash,
      lineageHash: contentHash,
      geometryVersion: 2,
      remoteRevision: 4,
      pendingKind: null,
    });
    await database.settings.put({
      key: 'sync.user-id',
      value: 'account-a',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const fixture = JSON.parse(
      await readFile('tests/fixtures/track-sync/geometry-v1.json', 'utf8'),
    ) as { readonly gzipHex: string; readonly sha256: string };
    vi.stubGlobal('Blob', NodeBlob);
    const compressed = bytesFromHex(fixture.gzipHex);
    const accountBRemote = {
      content_hash: fixture.sha256,
      revision: 2,
      state: 'ready' as const,
      object_path: `user/${fixture.sha256}/upload.grpt.gz`,
      compressed_bytes: compressed.byteLength,
      metadata: {
        name: 'Account B track',
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
    const uploadedLocal = {
      content_hash: contentHash,
      revision: 1,
      state: 'ready' as const,
      object_path: `user/${contentHash}/upload.grpt.gz`,
      compressed_bytes: 128,
      metadata: { lineageHash: legacyContentHash, geometryVersion: 2 },
    };
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({
          usedBytes: compressed.byteLength,
          reservedBytes: 0,
          limitBytes: 8_388_608,
        }),
      snapshot: vi
        .fn()
        .mockResolvedValueOnce([accountBRemote])
        .mockResolvedValueOnce([uploadedLocal, accountBRemote]),
      mutate: vi.fn().mockResolvedValue({ outcome: 'applied' as const, revision: 1 }),
      deleteRemoteRecord: vi.fn(),
      download: vi.fn().mockResolvedValue(compressed),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'account-b',
        sessionRevision: 0,
      }),
    ).resolves.toMatchObject({ remoteTrackDeletions: [] });

    await expect(database.listLocalTracks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: local.id }),
        expect.objectContaining({
          id: `local:sync:${fixture.sha256}`,
          name: 'Account B track',
        }),
      ]),
    );
    await expect(database.loadTrackSyncState(local.id)).resolves.toEqual({
      trackId: local.id,
      contentHash,
      lineageHash: legacyContentHash,
      geometryVersion: 2,
      remoteRevision: 1,
      pendingKind: null,
    });
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
      deleteRemoteRecord: vi.fn(),
      download: vi.fn().mockResolvedValue(compressed),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
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

  it('rejects downloaded geometry whose codec version contradicts metadata', async () => {
    const fixture = JSON.parse(
      await readFile('tests/fixtures/track-sync/geometry-v1.json', 'utf8'),
    ) as { readonly gzipHex: string; readonly sha256: string };
    const compressed = bytesFromHex(fixture.gzipHex);
    vi.stubGlobal('Blob', NodeBlob);
    const remote = {
      content_hash: fixture.sha256,
      revision: 2,
      state: 'ready' as const,
      object_path: `user/${fixture.sha256}/upload.grpt.gz`,
      compressed_bytes: compressed.byteLength,
      metadata: {
        name: 'Mismatched track',
        savedAt: '2026-07-22T10:00:00.000Z',
        updatedAt: '2026-07-22T10:00:00.000Z',
        sourceFilename: 'remote.gpx',
        sourceFormat: 'gpx',
        favorite: false,
        geometryKind: 'track',
        metadata: { version: '1.1', links: [] },
        warnings: [],
        lineageHash: fixture.sha256,
        geometryVersion: 2,
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
      snapshot: () => Promise.resolve([remote]),
      mutate: vi.fn(),
      deleteRemoteRecord: vi.fn(),
      download: () => Promise.resolve(compressed),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'invalid-remote' });
    await expect(database.listLocalTracks()).resolves.toEqual([]);
    client.dispose();
  });

  it('keeps an in-flight upload deleted and removes its remote revision next', async () => {
    const track = summary('local:deleted-during-upload');
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
      .mockResolvedValue({ outcome: 'applied' as const, revision: 0 });
    const remoteRecord = {
      content_hash: contentHash,
      revision: 1,
      state: 'ready' as const,
      object_path: `user/${contentHash}/upload.grpt.gz`,
      compressed_bytes: 128,
      metadata: { lineageHash: legacyContentHash, geometryVersion: 2 },
    };
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([remoteRecord])
      .mockResolvedValueOnce([remoteRecord])
      .mockResolvedValueOnce([]);
    const download = vi.fn();
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot,
      mutate,
      deleteRemoteRecord: vi.fn(),
      download,
    }));
    const client = new WorkerRpcClient(clientEndpoint);
    const synchronization = client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
    });

    await mutationStarted;
    await database.deleteLocalTrack(track.id);
    mutation.resolve({ outcome: 'applied', revision: 1 });
    await synchronization;

    await expect(database.listLocalTracks()).resolves.toEqual([]);
    await expect(database.loadTrackSyncState(track.id)).resolves.toEqual({
      trackId: track.id,
      contentHash,
      lineageHash: legacyContentHash,
      geometryVersion: 2,
      remoteRevision: 1,
      pendingKind: 'delete',
    });
    expect(download).not.toHaveBeenCalled();

    await client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
    });
    await expect(database.loadTrackSyncState(track.id)).resolves.toBeNull();
    await expect(database.listLocalTracks()).resolves.toEqual([]);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1]?.[0]).toMatchObject({
      remoteRevision: 1,
      pendingKind: 'delete',
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
      deleteRemoteRecord: vi.fn(),
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);
    const synchronization = client.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
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
      userId: 'user-id',
      sessionRevision: 0,
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

  it('replaces a v1 lineage across devices without changing the local track ID', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const sourceContent: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:device-a',
      trackPoints: [
        [
          { coordinate: [44, 42], elevationMeters: 120.25 },
          { coordinate: [44.01, 42.01] },
          { coordinate: [44.02, 42.02], elevationMeters: 0 },
          { coordinate: [44.03, 42.03], elevationMeters: -14.5 },
        ],
      ],
    };
    const sha256 = async (bytes: Uint8Array) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
    const legacyHash = await sha256(encodeLegacyTrackSyncGeometry(sourceContent));
    const v2Hash = await sha256(encodeTrackSyncGeometry(sourceContent));
    const sourceSummary: LocalTrackSummary = {
      ...summary(sourceContent.trackId),
      contentHash: legacyHash,
      pointCount: 4,
      metrics: calculateTrackMetrics(
        sourceContent.trackPoints.map((points) => ({ points })),
      ),
    };
    interface CloudRecord {
      readonly content_hash: string;
      readonly revision: number;
      readonly state: 'ready';
      readonly object_path: string;
      readonly compressed_bytes: number;
      readonly metadata: Record<string, unknown>;
    }
    const cloud = new Map<
      string,
      { readonly record: CloudRecord; readonly compressed: Uint8Array }
    >();
    const metadataFor = (
      pair: LocalTrackSyncPair,
      lineageHash?: string,
      geometryVersion?: 1 | 2,
    ): Record<string, unknown> => {
      const metadata: Record<string, unknown> = {
        name: pair.summary.name,
        savedAt: pair.summary.savedAt,
        updatedAt: pair.summary.updatedAt,
        sourceFilename: pair.summary.sourceFilename,
        sourceFormat: pair.summary.sourceFormat,
        favorite: pair.summary.favorite,
        geometryKind: pair.summary.geometryKind,
        metadata: pair.summary.metadata,
        warnings: pair.summary.warnings,
      };
      if (lineageHash !== undefined && geometryVersion !== undefined) {
        metadata.lineageHash = lineageHash;
        metadata.geometryVersion = geometryVersion;
      }
      return metadata;
    };
    const addCloudRecord = (
      canonical: Uint8Array,
      hash: string,
      revision: number,
      metadata: Record<string, unknown>,
    ) => {
      const compressed = Uint8Array.from(gzipSync(canonical));
      cloud.set(hash, {
        record: {
          content_hash: hash,
          revision,
          state: 'ready',
          object_path: `user/${hash}/track.grpt.gz`,
          compressed_bytes: compressed.byteLength,
          metadata,
        },
        compressed,
      });
    };
    addCloudRecord(
      encodeLegacyTrackSyncGeometry(sourceContent),
      legacyHash,
      7,
      metadataFor({ summary: sourceSummary, content: sourceContent }),
    );
    const mutate = vi.fn((state: TrackSyncState, pair: LocalTrackSyncPair | null) => {
      if (state.pendingKind !== 'upsert' || pair === null) {
        throw new Error('Unexpected mutation.');
      }
      addCloudRecord(
        encodeTrackSyncGeometry(pair.content),
        state.contentHash,
        2,
        metadataFor(pair, state.lineageHash, state.geometryVersion),
      );
      return Promise.resolve({ outcome: 'applied' as const, revision: 2 });
    });
    let cleanupFailed = false;
    let deletionConflicted = false;
    const deleteRemoteRecord = vi.fn((hash: string, _revision: number) => {
      if (hash === legacyHash && !cleanupFailed) {
        cleanupFailed = true;
        return Promise.resolve({ outcome: 'reserved' as const });
      }
      if (hash === legacyHash && !deletionConflicted) {
        deletionConflicted = true;
        return Promise.resolve({ outcome: 'conflict' as const, revision: 8 });
      }
      cloud.delete(hash);
      return Promise.resolve({ outcome: 'applied' as const, revision: 0 });
    });
    const gateway = {
      status: () =>
        Promise.resolve({
          usedBytes: [...cloud.values()].reduce(
            (total, value) => total + value.compressed.byteLength,
            0,
          ),
          reservedBytes: 0,
          limitBytes: 8_388_608 as const,
        }),
      snapshot: () => Promise.resolve([...cloud.values()].map(({ record }) => record)),
      mutate,
      deleteRemoteRecord,
      download: (path: string) => {
        const found = [...cloud.values()].find(
          ({ record }) => record.object_path === path,
        );
        if (found === undefined) throw new Error('Missing cloud geometry.');
        return Promise.resolve(found.compressed);
      },
    };

    await database.saveLocalTrack(sourceSummary, sourceContent);
    await database.saveTrackSyncState({
      trackId: sourceSummary.id,
      contentHash: legacyHash,
      lineageHash: legacyHash,
      geometryVersion: 1,
      remoteRevision: 7,
      pendingKind: null,
    });
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const [clientAEndpoint, serverAEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverAEndpoint, database, () => gateway);
    const clientA = new WorkerRpcClient(clientAEndpoint);

    await expect(
      clientA.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'network' });
    expect([...cloud.keys()]).toEqual([legacyHash, v2Hash]);
    await expect(database.loadTrackSyncState(sourceSummary.id)).resolves.toMatchObject({
      contentHash: v2Hash,
      lineageHash: legacyHash,
      geometryVersion: 2,
      pendingKind: null,
    });

    await clientA.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
    });

    expect([...cloud.keys()]).toEqual([v2Hash]);
    expect(deleteRemoteRecord).toHaveBeenCalledTimes(3);
    expect(deleteRemoteRecord.mock.calls.map((call) => call[1])).toEqual([7, 7, 8]);
    clientA.dispose();

    database.close();
    await database.delete();
    database = new AppDatabase(services.logger);
    const receiverContent: LocalTrackContent = {
      ...sourceContent,
      trackId: 'local:device-b',
      trackPoints: sourceContent.trackPoints.map((segment) =>
        segment.map(({ coordinate }) => ({ coordinate })),
      ),
    };
    const receiverSummary: LocalTrackSummary = {
      ...summary(receiverContent.trackId),
      contentHash: legacyHash,
      pointCount: 4,
      metrics: calculateTrackMetrics(
        receiverContent.trackPoints.map((points) => ({ points })),
      ),
    };
    await database.saveLocalTrack(receiverSummary, receiverContent);
    await database.saveTrackSyncState({
      trackId: receiverSummary.id,
      contentHash: legacyHash,
      lineageHash: legacyHash,
      geometryVersion: 1,
      remoteRevision: 7,
      pendingKind: null,
    });
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const [clientBEndpoint, serverBEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverBEndpoint, database, () => gateway);
    const clientB = new WorkerRpcClient(clientBEndpoint);

    const result = await clientB.request(trackSyncWorkerMethods.synchronize, {
      accessToken: 'access-token',
      userId: 'user-id',
      sessionRevision: 0,
    });

    expect(result).toMatchObject({ remoteTrackDeletions: [] });
    const synchronizedSummaries = await database.listLocalTracks();
    expect(synchronizedSummaries).toHaveLength(1);
    const synchronizedSummary = synchronizedSummaries[0];
    expect(synchronizedSummary).toBeDefined();
    if (synchronizedSummary === undefined) return;
    expect(synchronizedSummary.id).toBe(receiverSummary.id);
    expect(synchronizedSummary.contentHash).toBe(v2Hash);
    expect(synchronizedSummary.metrics.minimumElevationMeters).toBe(-14.5);
    expect(synchronizedSummary.metrics.maximumElevationMeters).toBe(120.25);
    expect(synchronizedSummary.metrics.elevationSource).toBe('gpx');
    const synchronizedContent = await database.loadLocalTrackContent(
      receiverSummary.id,
    );
    expect(
      synchronizedContent.trackPoints[0]?.map((point) => point.elevationMeters),
    ).toEqual([120.25, undefined, 0, -14.5]);
    expect(mutate).toHaveBeenCalledOnce();
    clientB.dispose();
  });

  it('keeps the v1 predecessor when the v2 replacement exceeds quota', async () => {
    const sourceContent: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:quota',
      trackPoints: [
        [
          { coordinate: [44, 42], elevationMeters: 120.25 },
          { coordinate: [44.01, 42.01], elevationMeters: -14.5 },
        ],
      ],
    };
    const digest = async (bytes: Uint8Array) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
    const legacyHash = await digest(encodeLegacyTrackSyncGeometry(sourceContent));
    const v2Hash = await digest(encodeTrackSyncGeometry(sourceContent));
    const sourceSummary: LocalTrackSummary = {
      ...summary(sourceContent.trackId),
      contentHash: legacyHash,
      metrics: calculateTrackMetrics(
        sourceContent.trackPoints.map((points) => ({ points })),
      ),
    };
    await database.saveLocalTrack(sourceSummary, sourceContent);
    await database.saveTrackSyncState({
      trackId: sourceSummary.id,
      contentHash: legacyHash,
      lineageHash: legacyHash,
      geometryVersion: 1,
      remoteRevision: 1,
      pendingKind: null,
    });
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const remote = {
      content_hash: legacyHash,
      revision: 1,
      state: 'ready' as const,
      object_path: `user/${legacyHash}/track.grpt.gz`,
      compressed_bytes: 128,
      metadata: {},
    };
    const mutate = vi
      .fn()
      .mockRejectedValue(
        new TrackSyncWorkerError('Track geometry quota exceeded.', 'quota'),
      );
    const deleteRemoteRecord = vi.fn();
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: () => Promise.resolve([remote]),
      mutate,
      deleteRemoteRecord,
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'quota' });

    await expect(database.loadTrackSyncState(sourceSummary.id)).resolves.toEqual({
      trackId: sourceSummary.id,
      contentHash: v2Hash,
      lineageHash: legacyHash,
      geometryVersion: 2,
      remoteRevision: null,
      pendingKind: 'upsert',
    });
    expect(remote.content_hash).toBe(legacyHash);
    expect(deleteRemoteRecord).not.toHaveBeenCalled();
    client.dispose();
  });

  it('does not auto-promote a synchronized dem-assisted v1 track', async () => {
    const legacyContent = content('local:dem-assisted');
    const digest = async (bytes: Uint8Array) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
    const legacyHash = await digest(encodeLegacyTrackSyncGeometry(legacyContent));
    const legacySummary: LocalTrackSummary = {
      ...summary(legacyContent.trackId),
      contentHash: legacyHash,
      metrics: {
        ...calculateTrackMetrics(
          legacyContent.trackPoints.map((points) => ({ points })),
        ),
        ascentMeters: 100,
        descentMeters: 50,
        minimumElevationMeters: 900,
        maximumElevationMeters: 1_000,
        elevationSource: 'dem-assisted',
        elevationAlgorithmVersion: 4,
      },
    };
    await database.saveLocalTrack(legacySummary, legacyContent);
    await database.saveTrackSyncState({
      trackId: legacySummary.id,
      contentHash: legacyHash,
      lineageHash: legacyHash,
      geometryVersion: 1,
      remoteRevision: 1,
      pendingKind: null,
    });
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-id',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
    const remote = {
      content_hash: legacyHash,
      revision: 1,
      state: 'ready' as const,
      object_path: `user/${legacyHash}/track.grpt.gz`,
      compressed_bytes: 128,
      metadata: {},
    };
    const mutate = vi.fn();
    const deleteRemoteRecord = vi.fn();
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 128, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: () => Promise.resolve([remote]),
      mutate,
      deleteRemoteRecord,
      download: vi.fn(),
    }));
    const client = new WorkerRpcClient(clientEndpoint);

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 0,
      }),
    ).resolves.toMatchObject({
      changed: { tracks: false, markers: false },
      remoteTrackDeletions: [],
    });

    await expect(database.loadTrackSyncState(legacySummary.id)).resolves.toEqual({
      trackId: legacySummary.id,
      contentHash: legacyHash,
      lineageHash: legacyHash,
      geometryVersion: 1,
      remoteRevision: 1,
      pendingKind: null,
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(deleteRemoteRecord).not.toHaveBeenCalled();
    client.dispose();
  });

  it('acknowledges a pending marker upload without changing its local row', async () => {
    const saved = marker();
    await database.saveSavedMarker(saved);
    const mutateMarker = vi.fn().mockResolvedValue({
      outcome: 'applied' as const,
      revision: 1,
    });
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    new TrackSyncWorkerServer(serverEndpoint, database, () => ({
      status: () =>
        Promise.resolve({ usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 }),
      snapshot: () => Promise.resolve([]),
      mutate: vi.fn(),
      deleteRemoteRecord: vi.fn(),
      download: vi.fn(),
      mutateMarker,
      markerSnapshot: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ marker_id: saved.id, revision: 1, payload: saved }]),
    }));
    const client = new WorkerRpcClient(clientEndpoint);
    const progress: {
      readonly completedItems: number;
      readonly totalItems: number;
    }[] = [];
    client.subscribeEvent(trackSyncWorkerEventNames.progress, (payload) => {
      progress.push(
        payload as { readonly completedItems: number; readonly totalItems: number },
      );
    });

    await expect(
      client.request(trackSyncWorkerMethods.synchronize, {
        accessToken: 'access-token',
        userId: 'user-id',
        sessionRevision: 7,
      }),
    ).resolves.toMatchObject({
      changed: { tracks: false, markers: false },
      remoteMarkerDeletions: [],
    });
    expect(mutateMarker).toHaveBeenCalledWith(
      saved.id,
      0,
      saved,
      expect.any(AbortSignal),
    );
    await expect(database.readMarkerSyncSnapshot()).resolves.toEqual([
      {
        marker: saved,
        state: {
          markerId: saved.id,
          remoteRevision: 1,
          pendingKind: null,
          localVersion: 1,
        },
      },
    ]);
    await vi.waitFor(() => {
      expect(progress).toEqual([
        { completedItems: 0, totalItems: 1 },
        { completedItems: 1, totalItems: 1 },
      ]);
    });
    client.dispose();
  });
});
