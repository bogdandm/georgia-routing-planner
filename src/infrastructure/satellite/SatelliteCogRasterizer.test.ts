import { describe, expect, it } from 'vitest';

import {
  colorizeSatellitePixel,
  tilePixelToLongitudeLatitude,
} from '@/infrastructure/satellite/SatelliteCogRasterizer';

describe('SatelliteCogRasterizer', () => {
  it('maps XYZ tile pixels to Web Mercator longitude and latitude', () => {
    expect(tilePixelToLongitudeLatitude(0, 0, 0, 128, 128, 256)).toEqual([0, 0]);
    const northWest = tilePixelToLongitudeLatitude(0, 0, 0, 0, 0, 256);
    expect(northWest[0]).toBe(-180);
    expect(northWest[1]).toBeCloseTo(85.051_128_78, 7);
  });

  it('applies bounded reflectance, gamma, saturation, and transparent no-data', () => {
    const tuning = { reflectanceMax: 10_000, gamma: 1, saturation: 1 };
    expect(colorizeSatellitePixel(0, 0, 0, tuning)).toEqual([0, 0, 0, 0]);
    expect(colorizeSatellitePixel(10_000, 5_000, 20_000, tuning)).toEqual([
      255, 128, 255, 255,
    ]);
    const gray = colorizeSatellitePixel(5_000, 5_000, 5_000, {
      ...tuning,
      saturation: 5,
    });
    expect(gray).toEqual([128, 128, 128, 255]);
  });
});
