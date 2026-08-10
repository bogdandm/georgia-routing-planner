import { Blob as NodeBlob } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LOCAL_TRACK_SCHEMA_VERSION } from '@/domain/tracks/localTrack';
import { decodeTrackSyncGeometry } from '@/domain/tracks/trackSyncGeometry';
import type { LocalTrackSyncPair } from '@/infrastructure/persistence/AppDatabase';

import { FetchRemoteGateway } from '@/infrastructure/supabase/TrackSyncWorkerServer';

const contentHash = 'a'.repeat(64);
const signal = new AbortController().signal;

const pair = {
  summary: {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
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
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId: 'local:track',
    trackPoints: [
      [{ coordinate: [44, 42] as const }, { coordinate: [44.01, 42.01] as const }],
    ],
  },
} satisfies LocalTrackSyncPair;

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
          lineageHash: contentHash,
          geometryVersion: 2,
          remoteRevision: 3,
          pendingKind: 'metadata',
        },
        pair,
        signal,
      ),
    ).resolves.toEqual({ outcome: 'applied', revision: 4 });
  });
  it('excludes browser-calculated elevation from cloud metadata and geometry', async () => {
    class CapturingFormData {
      readonly #values = new Map<string, unknown>();

      public set(name: string, value: unknown): void {
        this.#values.set(name, value);
      }

      public get(name: string): unknown {
        return this.#values.get(name) ?? null;
      }
    }
    vi.stubGlobal('FormData', CapturingFormData);
    vi.stubGlobal('Blob', NodeBlob);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        outcome: 'applied',
        record: { contentHash, revision: 1, state: 'ready' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const calculatedMetrics = {
      ...pair.summary.metrics,
      ascentMeters: 125,
      descentMeters: 110,
      minimumElevationMeters: 900,
      maximumElevationMeters: 1_025,
      elevationSource: 'dem-assisted' as const,
      elevationAlgorithmVersion: 4 as const,
    };
    const pairWithCalculatedElevation: LocalTrackSyncPair = {
      summary: { ...pair.summary, calculatedMetrics },
      content: {
        ...pair.content,
        calculatedTrackPoints: [
          [
            { coordinate: [44, 42], elevationMeters: 9_000 },
            { coordinate: [44.01, 42.01], elevationMeters: 9_100 },
          ],
        ],
      },
    };
    const gateway = new FetchRemoteGateway(
      'https://example.test',
      'publishable-key',
      'access-token',
    );

    await gateway.mutate(
      {
        trackId: pair.summary.id,
        contentHash,
        lineageHash: contentHash,
        geometryVersion: 2,
        remoteRevision: null,
        pendingKind: 'upsert',
      },
      pairWithCalculatedElevation,
      signal,
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as FormData;
    const metadataValue = form.get('metadata');
    expect(typeof metadataValue).toBe('string');
    if (typeof metadataValue !== 'string') return;
    const metadata = JSON.parse(metadataValue) as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('calculatedMetrics');
    expect(metadata).toMatchObject({
      lineageHash: contentHash,
      geometryVersion: 2,
    });
    const geometry = form.get('geometry');
    expect(geometry).toBeInstanceOf(Blob);
    const decompressed = await new Response(
      (geometry as Blob).stream().pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer();
    expect(decodeTrackSyncGeometry(new Uint8Array(decompressed))).toEqual(
      pair.content.trackPoints,
    );
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
          lineageHash: contentHash,
          geometryVersion: 2,
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

  it('rejects incomplete or malformed lineage metadata in snapshots', async () => {
    for (const metadata of [
      { lineageHash: contentHash },
      { lineageHash: contentHash, geometryVersion: 3 },
      { lineageHash: 'A'.repeat(64), geometryVersion: 2 },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          Response.json([
            {
              content_hash: contentHash,
              revision: 1,
              state: 'ready',
              object_path: `user/${contentHash}/upload.grpt.gz`,
              compressed_bytes: 128,
              metadata,
            },
          ]),
        ),
      );
      const gateway = new FetchRemoteGateway(
        'https://example.test',
        'publishable-key',
        'access-token',
      );

      await expect(gateway.snapshot(signal)).rejects.toMatchObject({
        code: 'invalid-remote',
      });
    }
  });

  it('returns the authoritative revision for a remote-only delete conflict', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        outcome: 'conflict',
        record: { contentHash, revision: 7, state: 'ready' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new FetchRemoteGateway(
      'https://example.test',
      'publishable-key',
      'access-token',
    );

    await expect(gateway.deleteRemoteRecord(contentHash, 4, signal)).resolves.toEqual({
      outcome: 'conflict',
      revision: 7,
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') return;
    expect(JSON.parse(body)).toEqual({
      action: 'delete',
      contentHash,
      baseRevision: 4,
    });
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
  it('reports a bounded server status and error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'internal_error', message: 'private server detail' } },
            { status: 500 },
          ),
        ),
    );
    const gateway = new FetchRemoteGateway(
      'https://example.test',
      'publishable-key',
      'access-token',
    );

    await expect(gateway.status(signal)).rejects.toMatchObject({
      code: 'network',
      message: 'Cloud synchronization request failed (500/internal_error).',
    });
  });
  it('stops issuing requests after three HTTP 500 responses until reload', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ error: { code: 'internal_error' } }, { status: 500 }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const serverErrorBudget = { failures: 0 };
    const gateway = () =>
      new FetchRemoteGateway(
        'https://example.test',
        'publishable-key',
        'access-token',
        serverErrorBudget,
      );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(gateway().status(signal)).rejects.toThrow(
        'Cloud synchronization request failed (500/internal_error).',
      );
    }
    await expect(gateway().status(signal)).rejects.toThrow(
      'Cloud synchronization stopped after 3 server failures. Reload the page to try again.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
