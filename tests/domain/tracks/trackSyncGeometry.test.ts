import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
} from '@/domain/tracks/localTrack';
import {
  decodeTrackSyncGeometry,
  encodeTrackSyncGeometry,
  TrackSyncGeometryError,
} from '@/domain/tracks/trackSyncGeometry';
import { WebCryptoTrackContentHasher } from '@/infrastructure/runtime/WebCryptoTrackContentHasher';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('GRPT v1 geometry', () => {
  it('matches the Plan 01 canonical vector and hash without elevation identity', async () => {
    const fixture = JSON.parse(
      await readFile('tests/fixtures/track-sync/geometry-v1.json', 'utf8'),
    ) as {
      readonly canonicalHex: string;
      readonly sha256: string;
    };
    const content: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:fixture',
      trackPoints: [
        [
          {
            coordinate: [44.793, 41.709],
            elevationMeters: 1_000,
            recordedAt: '2024-01-01T00:00:00.000Z',
          },
          { coordinate: [44.793001, 41.709002], elevationMeters: 1_100 },
          {
            coordinate: [44.79301, 41.709005],
            elevationMeters: 1_200,
            recordedAt: '2024-01-01T00:01:00.000Z',
          },
        ],
      ],
    };
    expect(hex(encodeTrackSyncGeometry(content))).toBe(fixture.canonicalHex);
    await expect(new WebCryptoTrackContentHasher().hash(content)).resolves.toBe(
      fixture.sha256,
    );
    const withDifferentElevation: LocalTrackContent = {
      ...content,
      trackPoints: content.trackPoints.map((segment) =>
        segment.map((point) => ({ ...point, elevationMeters: 42 })),
      ),
    };
    await expect(
      new WebCryptoTrackContentHasher().hash(withDifferentElevation),
    ).resolves.toBe(fixture.sha256);
  });

  it('round-trips segment boundaries, timestamps, and rounded coordinates without elevation', () => {
    const content: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:roundtrip',
      trackPoints: [
        [
          { coordinate: [44.1234564, 41.9876546], elevationMeters: 900 },
          { coordinate: [44.1, 41.9], recordedAt: '2026-01-01T00:00:00.000Z' },
        ],
        [
          { coordinate: [-180, -90] },
          { coordinate: [180, 90], recordedAt: '2026-01-01T00:00:01.000Z' },
        ],
      ],
    };
    expect(decodeTrackSyncGeometry(encodeTrackSyncGeometry(content))).toEqual([
      [
        { coordinate: [44.123456, 41.987655] },
        { coordinate: [44.1, 41.9], recordedAt: '2026-01-01T00:00:00.000Z' },
      ],
      [
        { coordinate: [-180, -90] },
        { coordinate: [180, 90], recordedAt: '2026-01-01T00:00:01.000Z' },
      ],
    ]);
  });

  it.each<[string, LocalTrackContent['trackPoints'][number][number]]>([
    ['non-finite coordinate', { coordinate: [Number.NaN, 42] }],
    ['out-of-range coordinate', { coordinate: [181, 42] }],
    ['invalid timestamp', { coordinate: [44, 42], recordedAt: 'not-a-time' }],
  ])('rejects %s while encoding', (_name, firstPoint) => {
    const content: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:invalid',
      trackPoints: [[firstPoint, { coordinate: [44, 42] }]],
    };
    expect(() => encodeTrackSyncGeometry(content)).toThrow(TrackSyncGeometryError);
  });

  it('rejects importer segment and point limits while encoding', () => {
    const point = { coordinate: [44, 42] as const };
    const tooManySegments: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:segments',
      trackPoints: Array.from({ length: 513 }, () => [point, point]),
    };
    const tooManyPoints: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:points',
      trackPoints: [Array.from({ length: 100_001 }, () => point)],
    };
    expect(() => encodeTrackSyncGeometry(tooManySegments)).toThrow(
      TrackSyncGeometryError,
    );
    expect(() => encodeTrackSyncGeometry(tooManyPoints)).toThrow(
      TrackSyncGeometryError,
    );
  });

  it.each([
    ['invalid header', Uint8Array.from([0, 0, 0, 0, 1, 0, 1, 2])],
    ['unknown version', Uint8Array.from([71, 82, 80, 84, 2, 0, 1, 2])],
    ['unknown flags', Uint8Array.from([71, 82, 80, 84, 1, 2, 1, 2])],
    ['truncated value', Uint8Array.from([71, 82, 80, 84, 1, 0, 1, 2, 128])],
    [
      'overlong varuint',
      Uint8Array.from([
        71, 82, 80, 84, 1, 0, 128, 128, 128, 128, 128, 128, 128, 128, 128, 0,
      ]),
    ],
    ['trailing bytes', Uint8Array.from([71, 82, 80, 84, 1, 0, 1, 2, 0, 0, 0, 0, 0])],
  ])('rejects %s', (_name, bytes) => {
    expect(() => decodeTrackSyncGeometry(bytes)).toThrow(TrackSyncGeometryError);
  });
});
