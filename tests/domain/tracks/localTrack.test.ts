import { describe, expect, it } from 'vitest';

import {
  normalizeLocalTrackDescription,
  normalizeLocalTrackName,
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
