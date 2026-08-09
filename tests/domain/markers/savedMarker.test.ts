import { describe, expect, it } from 'vitest';

import {
  SAVED_MARKER_SCHEMA_VERSION,
  markerColorKeys,
  markerIconKeys,
  markerSorts,
  normalizeSavedMarkerName,
} from '@/domain/markers/savedMarker';

describe('saved markers', () => {
  it('exposes the stable schema and broad unique icon catalog', () => {
    expect(SAVED_MARKER_SCHEMA_VERSION).toBe(1);
    expect(markerIconKeys.length).toBeGreaterThanOrEqual(100);
    expect(new Set(markerIconKeys).size).toBe(markerIconKeys.length);
    expect(markerIconKeys).toEqual(
      expect.arrayContaining([
        'place',
        'home',
        'parking',
        'forest',
        'water',
        'hiking',
        'camping',
        'restaurant',
        'camera',
        'hospital',
        'warning',
        'train',
      ]),
    );
    expect(markerColorKeys).toEqual([
      'blue',
      'teal',
      'purple',
      'olive',
      'orange',
      'rose',
      'navy',
      'blue-green',
      'green',
      'red',
    ]);
    expect(markerSorts).toEqual(['created', 'name', 'color', 'distance']);
  });

  it('trims a name and derives an English-locale comparison key', () => {
    expect(normalizeSavedMarkerName('  Kazbegi Ridge  ')).toEqual({
      name: 'Kazbegi Ridge',
      normalizedName: 'kazbegi ridge',
    });
  });

  it('rejects empty and overlong names', () => {
    expect(() => normalizeSavedMarkerName('   ')).toThrow('Marker name is required.');
    expect(() => normalizeSavedMarkerName('x'.repeat(201))).toThrow(
      'Marker name must be 200 characters or fewer.',
    );
  });
});
