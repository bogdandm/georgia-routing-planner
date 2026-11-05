import { describe, expect, it } from 'vitest';

import { parseCoordinateQuery } from '@/presentation/shell/parseCoordinateQuery';

describe('parseCoordinateQuery', () => {
  it('accepts explicit latitude/longitude labels in either order', () => {
    expect(parseCoordinateQuery('lat: 41.7, lon: 44.8')).toMatchObject({
      status: 'valid',
      coordinate: { latitude: 41.7, longitude: 44.8 },
    });
    expect(parseCoordinateQuery('lng=44.8 lat=41.7')).toMatchObject({
      status: 'valid',
      coordinate: { latitude: 41.7, longitude: 44.8 },
    });
  });

  it('accepts decimal degrees with hemisphere suffixes in either order', () => {
    expect(parseCoordinateQuery('41.88919° N, 43.74222° E')).toMatchObject({
      status: 'valid',
      coordinate: { latitude: 41.88919, longitude: 43.74222 },
    });
    expect(parseCoordinateQuery('43.74222° W 41.88919° S')).toMatchObject({
      status: 'valid',
      coordinate: { latitude: -41.88919, longitude: -43.74222 },
    });
  });

  it('converts degrees, minutes, and seconds with hemisphere suffixes', () => {
    const result = parseCoordinateQuery(`42°14'44.24"N 44°37'23.10"E`);

    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    expect(result.coordinate.latitude).toBeCloseTo(42.2456222222, 10);
    expect(result.coordinate.longitude).toBeCloseTo(44.6230833333, 10);
  });

  it('rejects invalid hemisphere coordinates', () => {
    expect(parseCoordinateQuery(`42°60'0"N 44°37'23"E`)).toEqual({
      status: 'invalid',
      code: 'out-of-bounds',
    });
    expect(parseCoordinateQuery(`42°14'60"N 44°37'23"E`)).toEqual({
      status: 'invalid',
      code: 'out-of-bounds',
    });
    expect(parseCoordinateQuery('91° N, 44° E')).toEqual({
      status: 'invalid',
      code: 'out-of-bounds',
    });
    expect(parseCoordinateQuery('41° N, 42° S')).toEqual({
      status: 'invalid',
      code: 'duplicate-axis',
    });
  });

  it('interprets unlabeled pairs as latitude, longitude', () => {
    expect(parseCoordinateQuery('41.7, 44.8')).toMatchObject({
      status: 'valid',
      coordinate: { latitude: 41.7, longitude: 44.8 },
    });
    expect(parseCoordinateQuery('41, 120')).toMatchObject({
      status: 'valid',
      coordinate: { latitude: 41, longitude: 120 },
    });
    expect(parseCoordinateQuery('120, 41')).toMatchObject({
      status: 'invalid',
      code: 'out-of-bounds',
    });
    expect(parseCoordinateQuery('lon: 120, lat: 41')).toMatchObject({
      status: 'valid',
      coordinate: { latitude: 41, longitude: 120 },
    });
  });

  it('rejects out-of-range coordinate-shaped input', () => {
    expect(parseCoordinateQuery('lat: 91, lon: 44')).toEqual({
      status: 'invalid',
      code: 'out-of-bounds',
    });
    expect(parseCoordinateQuery('Tbilisi')).toEqual({ status: 'not-coordinate' });
  });
});
