import { describe, expect, it } from 'vitest';

import {
  LOCAL_TRACK_SCHEMA_VERSION,
  localTrackPoints,
  localTrackSegments,
  normalizeLocalTrackDescription,
  normalizeLocalTrackName,
  type LocalTrackContent,
} from '@/domain/tracks/localTrack';

describe('normalizeLocalTrackName', () => {
  it('trims display text and derives an English-locale search value', () => {
    expect(normalizeLocalTrackName('  Kazbegi Ridge  ')).toEqual({
      name: 'Kazbegi Ridge',
      normalizedName: 'kazbegi ridge',
    });
  });

  it('distinguishes empty and overlong invalid names', () => {
    expect(() => normalizeLocalTrackName('   ')).toThrow('Track name is required.');
    expect(() => normalizeLocalTrackName('x'.repeat(201))).toThrow(
      'Track name must be 200 characters or fewer.',
    );
  });
});

describe('normalizeLocalTrackDescription', () => {
  it('keeps plain text unchanged and rejects content above the storage limit', () => {
    expect(normalizeLocalTrackDescription('  plain <b>text</b>  ')).toBe(
      '  plain <b>text</b>  ',
    );
    expect(() => normalizeLocalTrackDescription('x'.repeat(10_001))).toThrow(
      '10,000 characters',
    );
  });
});

describe('local track projections', () => {
  it('derives geometry and overlays aligned relief elevation without duplicating points', () => {
    const content: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:1',
      trackPoints: [
        [
          { coordinate: [44, 42] as const, elevationMeters: 100 },
          { coordinate: [45, 43] as const, elevationMeters: 110 },
        ],
      ],
      reliefElevations: [[900, 910]],
      elevationSource: 'relief' as const,
    };

    expect(localTrackSegments(content)).toEqual([
      [
        [44, 42],
        [45, 43],
      ],
    ]);
    expect(
      localTrackPoints(content).map((segment) =>
        segment.map((point) => point.elevationMeters),
      ),
    ).toEqual([[900, 910]]);
    expect(content.trackPoints[0]?.[0]?.elevationMeters).toBe(100);
  });
});
