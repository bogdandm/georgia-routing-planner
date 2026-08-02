import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchRemoteGateway } from '@/infrastructure/supabase/TrackSyncWorkerServer';

const contentHash = 'a'.repeat(64);
const signal = new AbortController().signal;

const pair = {
  summary: {
    schemaVersion: 3 as const,
    id: 'local:track',
    name: 'Track',
    normalizedName: 'track',
    savedAt: '2026-07-22T10:00:00.000Z',
    updatedAt: '2026-07-22T10:00:00.000Z',
    contentHash,
    sourceFilename: 'fixture.gpx',
    sourceFormat: 'gpx' as const,
    favorite: false,
    geometryKind: 'track' as const,
    pointCount: 2,
    segmentCount: 1,
    metrics: {
      distanceMeters: 1_000,
      distanceAlgorithmVersion: 1 as const,
      startCoordinate: [44, 42] as const,
      endCoordinate: [44.01, 42.01] as const,
      bounds: {
        west: 44,
        south: 42,
        east: 44.01,
        north: 42.01,
        crossesAntimeridian: false,
      },
      center: [44.005, 42.005] as const,
    },
    metadata: { version: '1.1' as const, links: [] },
    warnings: [],
  },
  content: {
    schemaVersion: 3 as const,
    trackId: 'local:track',
    trackPoints: [
      [{ coordinate: [44, 42] as const }, { coordinate: [44.01, 42.01] as const }],
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FetchRemoteGateway', () => {
  it('accepts the Edge Function camelCase metadata response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        outcome: 'applied',
        record: { contentHash, revision: 4, state: 'ready' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new FetchRemoteGateway(
      'https://example.test',
      'publishable-key',
      'access-token',
    );

    await expect(
      gateway.mutate(
        {
          trackId: pair.summary.id,
          contentHash,
          remoteRevision: 3,
          pendingKind: 'metadata',
        },
        pair,
        signal,
      ),
    ).resolves.toEqual({ outcome: 'applied', revision: 4 });
  });

  it('accepts a successful delete response without a record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ outcome: 'applied' })),
    );
    const gateway = new FetchRemoteGateway(
      'https://example.test',
      'publishable-key',
      'access-token',
    );

    await expect(
      gateway.mutate(
        {
          trackId: pair.summary.id,
          contentHash,
          remoteRevision: 4,
          pendingKind: 'delete',
        },
        null,
        signal,
      ),
    ).resolves.toEqual({ outcome: 'applied', revision: 0 });
  });

  it('retrieves and validates both reserved and ready server records', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        {
          content_hash: contentHash,
          revision: 4,
          state: 'ready',
          object_path: `user/${contentHash}/upload.grpt.gz`,
          compressed_bytes: 128,
          metadata: {},
        },
        {
          content_hash: 'b'.repeat(64),
          revision: 0,
          state: 'reserved',
          object_path: `user/${'b'.repeat(64)}/upload.grpt.gz`,
          compressed_bytes: 64,
          metadata: {},
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new FetchRemoteGateway(
      'https://example.test',
      'publishable-key',
      'access-token',
    );

    await expect(gateway.snapshot(signal)).resolves.toHaveLength(2);
  });
  it('retrieves every page of a full server snapshot', async () => {
    const record = (index: number) => {
      const hash = index.toString(16).padStart(64, '0');
      return {
        content_hash: hash,
        revision: 1,
        state: 'ready',
        object_path: `user/${hash}/upload.grpt.gz`,
        compressed_bytes: 128,
        metadata: {},
      };
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(Array.from({ length: 1_000 }, (_, index) => record(index))),
      )
      .mockResolvedValueOnce(Response.json([record(1_000)]));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new FetchRemoteGateway(
      'https://example.test',
      'publishable-key',
      'access-token',
    );

    await expect(gateway.snapshot(signal)).resolves.toHaveLength(1_001);
    const firstCall = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const secondCall = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];
    expect(firstCall[0].searchParams.get('order')).toBe('content_hash.asc');
    expect(new Headers(firstCall[1].headers).get('Range')).toBe('0-999');
    expect(new Headers(secondCall[1].headers).get('Range')).toBe('1000-1999');
  });
});
