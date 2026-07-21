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

  it('accepts only unambiguous unlabeled order', () => {
    expect(parseCoordinateQuery('120, 41')).toMatchObject({
      status: 'valid',
      coordinate: { longitude: 120, latitude: 41 },
    });
    expect(parseCoordinateQuery('41, 120')).toMatchObject({
      status: 'valid',
      coordinate: { longitude: 120, latitude: 41 },
    });
  });

  it('rejects ambiguous and out-of-range coordinate-shaped input', () => {
    expect(parseCoordinateQuery('41.7, 44.8')).toMatchObject({ status: 'invalid' });
    expect(parseCoordinateQuery('lat: 91, lon: 44')).toMatchObject({
      status: 'invalid',
    });
    expect(parseCoordinateQuery('Tbilisi')).toEqual({ status: 'not-coordinate' });
  });
});
