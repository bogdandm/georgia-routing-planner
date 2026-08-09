import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
} from '@/domain/tracks/localTrack';
import {
  decodeTrackSyncGeometry,
  encodeLegacyTrackSyncGeometry,
  encodeTrackSyncGeometry,
  TrackSyncGeometryError,
} from '@/domain/tracks/trackSyncGeometry';
import { WebCryptoTrackContentHasher } from '@/infrastructure/runtime/WebCryptoTrackContentHasher';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('GRPT geometry', () => {
  it('keeps the checked-in v1 compatibility vector elevation-free', async () => {
    const fixture = JSON.parse(
      await readFile('tests/fixtures/track-sync/geometry-v1.json', 'utf8'),
    ) as {
      readonly canonicalHex: string;
    };
    const content: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:fixture-v1',
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

    const canonical = encodeLegacyTrackSyncGeometry(content);

    expect(hex(canonical)).toBe(fixture.canonicalHex);
    expect(decodeTrackSyncGeometry(canonical)).toEqual([
      [
        {
          coordinate: [44.793, 41.709],
          recordedAt: '2024-01-01T00:00:00.000Z',
        },
        { coordinate: [44.793001, 41.709002] },
        {
          coordinate: [44.79301, 41.709005],
          recordedAt: '2024-01-01T00:01:00.000Z',
        },
      ],
    ]);
  });

  it('matches the v2 canonical vector, hash, and elevation values', async () => {
    const fixture = JSON.parse(
      await readFile('tests/fixtures/track-sync/geometry-v2.json', 'utf8'),
    ) as {
      readonly canonicalHex: string;
      readonly sha256: string;
    };
    const content: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:fixture-v2',
      trackPoints: [
        [
          {
            coordinate: [44.793, 41.709],
            elevationMeters: 120.25,
            recordedAt: '2024-01-01T00:00:00.000Z',
          },
          { coordinate: [44.793001, 41.709002], elevationMeters: -14.5 },
          {
            coordinate: [44.79301, 41.709005],
            elevationMeters: 987.654321,
            recordedAt: '2024-01-01T00:01:00.000Z',
          },
          {
            coordinate: [44.79302, 41.709015],
            elevationMeters: 0,
            recordedAt: '2024-01-01T00:01:30.000Z',
          },
          { coordinate: [44.79303, 41.709025] },
        ],
      ],
    };

    const canonical = encodeTrackSyncGeometry(content);

    expect(hex(canonical)).toBe(fixture.canonicalHex);
    expect(decodeTrackSyncGeometry(canonical)).toEqual(content.trackPoints);
    await expect(new WebCryptoTrackContentHasher().hash(content)).resolves.toBe(
      fixture.sha256,
    );

    const firstSegment = content.trackPoints[0];
    expect(firstSegment).toBeDefined();
    if (firstSegment === undefined) return;
    const changedElevation: LocalTrackContent = {
      ...content,
      trackPoints: [
        firstSegment.map((point, index) =>
          index === 0 ? { ...point, elevationMeters: 120.5 } : point,
        ),
      ],
    };
    const missingElevation: LocalTrackContent = {
      ...content,
      trackPoints: [
        firstSegment.map((point, index) => {
          if (index !== 0) return point;
          const { elevationMeters: _elevationMeters, ...withoutElevation } = point;
          return withoutElevation;
        }),
      ],
    };
    await expect(
      new WebCryptoTrackContentHasher().hash(changedElevation),
    ).resolves.not.toBe(fixture.sha256);
    await expect(
      new WebCryptoTrackContentHasher().hash(missingElevation),
    ).resolves.not.toBe(fixture.sha256);
  });

  it('round-trips segment boundaries and rounded coordinates in v2', () => {
    const content: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:roundtrip',
      trackPoints: [
        [
          { coordinate: [44.1234564, 41.9876546], elevationMeters: 900 },
          { coordinate: [44.1, 41.9], recordedAt: '2026-01-01T00:00:00.000Z' },
        ],
        [
          { coordinate: [-180, -90], elevationMeters: 0 },
          {
            coordinate: [180, 90],
            elevationMeters: -1,
            recordedAt: '2026-01-01T00:00:01.000Z',
          },
        ],
      ],
    };
    expect(decodeTrackSyncGeometry(encodeTrackSyncGeometry(content))).toEqual([
      [
        { coordinate: [44.123456, 41.987655], elevationMeters: 900 },
        { coordinate: [44.1, 41.9], recordedAt: '2026-01-01T00:00:00.000Z' },
      ],
      [
        { coordinate: [-180, -90], elevationMeters: 0 },
        {
          coordinate: [180, 90],
          elevationMeters: -1,
          recordedAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    ]);
  });

  it.each<[string, LocalTrackContent['trackPoints'][number][number]]>([
    ['non-finite coordinate', { coordinate: [Number.NaN, 42] }],
    ['out-of-range coordinate', { coordinate: [181, 42] }],
    ['invalid timestamp', { coordinate: [44, 42], recordedAt: 'not-a-time' }],
    ['NaN elevation', { coordinate: [44, 42], elevationMeters: Number.NaN }],
    [
      'infinite elevation',
      { coordinate: [44, 42], elevationMeters: Number.POSITIVE_INFINITY },
    ],
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
    ['unknown version', Uint8Array.from([71, 82, 80, 84, 3, 0, 1, 2])],
    ['unknown v1 flags', Uint8Array.from([71, 82, 80, 84, 1, 2, 1, 2])],
    ['unknown v2 flags', Uint8Array.from([71, 82, 80, 84, 2, 4, 1, 2])],
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

  it('rejects malformed and truncated v2 elevation fields', () => {
    const invalidTag = Uint8Array.from([71, 82, 80, 84, 2, 2, 1, 2, 0, 0, 2, 0, 0, 0]);
    const truncatedValue = Uint8Array.from([71, 82, 80, 84, 2, 2, 1, 2, 0, 0, 1, 0, 0]);

    expect(() => decodeTrackSyncGeometry(invalidTag)).toThrow(
      'Track geometry contains an invalid elevation.',
    );
    expect(() => decodeTrackSyncGeometry(truncatedValue)).toThrow(
      'Track geometry contains an invalid elevation.',
    );
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects decoded %s elevation', (_name, elevationMeters) => {
    const bytes = Uint8Array.from([
      71, 82, 80, 84, 2, 2, 1, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    new DataView(bytes.buffer).setFloat64(11, elevationMeters, false);

    expect(() => decodeTrackSyncGeometry(bytes)).toThrow(
      'Track geometry contains an invalid elevation.',
    );
  });
});
