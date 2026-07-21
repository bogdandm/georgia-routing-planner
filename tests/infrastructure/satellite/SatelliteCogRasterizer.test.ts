import { describe, expect, it } from 'vitest';

import {
  tilePixelToLongitudeLatitude,
  visualPixel,
} from '@/infrastructure/satellite/SatelliteCogRasterizer';

describe('SatelliteCogRasterizer', () => {
  it('maps XYZ tile pixels to Web Mercator longitude and latitude', () => {
    expect(tilePixelToLongitudeLatitude(0, 0, 0, 128, 128, 256)).toEqual([0, 0]);
    const northWest = tilePixelToLongitudeLatitude(0, 0, 0, 0, 0, 256);
    expect(northWest[0]).toBe(-180);
    expect(northWest[1]).toBeCloseTo(85.051_128_78, 7);
  });

  it('preserves pre-rendered 8-bit RGB and makes black no-data transparent', () => {
    expect(visualPixel(0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(visualPixel(240, 125, 12)).toEqual([240, 125, 12, 255]);
    expect(visualPixel(300, -4, 128.4)).toEqual([255, 0, 128, 255]);
  });
});
