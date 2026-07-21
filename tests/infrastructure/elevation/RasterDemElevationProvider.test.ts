import { describe, expect, it } from 'vitest';

import {
  decodeDemElevation,
  locateDemPixel,
} from '@/infrastructure/elevation/RasterDemElevationProvider';

describe('RasterDemElevationProvider helpers', () => {
  it('locates a deterministic pixel in a slippy-map tile', () => {
    expect(locateDemPixel({ longitude: 0, latitude: 0 }, 1, 256)).toEqual({
      z: 1,
      x: 1,
      y: 1,
      pixelX: 0,
      pixelY: 0,
    });
    expect(locateDemPixel({ longitude: 44.8, latitude: 90 }, 15, 256)).toBeNull();
  });

  it('decodes the supported Terrarium and Mapbox formulas', () => {
    expect(decodeDemElevation({ red: 128, green: 4, blue: 0 }, 'terrarium')).toBe(4);
    expect(decodeDemElevation({ red: 1, green: 134, blue: 160 }, 'mapbox')).toBe(0);
  });
});
