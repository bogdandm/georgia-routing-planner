import { describe, expect, it } from 'vitest';

import {
  LOCAL_TRACK_SCHEMA_VERSION,
  localTrackSegments,
  normalizeLocalTrackName,
  trackSorts,
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

describe('track sorting', () => {
  it('defines the stable persisted sort options', () => {
    expect(trackSorts).toEqual(['created', 'name', 'oldest', 'distance']);
  });
});

describe('local track projections', () => {
  it('projects coordinates from source points', () => {
    const content: LocalTrackContent = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:1',
      trackPoints: [
        [
          { coordinate: [44, 42] as const, elevationMeters: 100 },
          { coordinate: [45, 43] as const, elevationMeters: 110 },
        ],
      ],
    };

    expect(localTrackSegments(content)).toEqual([
      [
        [44, 42],
        [45, 43],
      ],
    ]);
  });
});
