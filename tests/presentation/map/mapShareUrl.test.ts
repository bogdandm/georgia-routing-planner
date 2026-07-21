import { describe, expect, it } from 'vitest';

import {
  applySharedMapView,
  createMapShareUrl,
  parseSharedMapView,
} from '@/presentation/map/mapShareUrl';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';

describe('mapShareUrl', () => {
  it('round-trips a versioned center, zoom, and safe scene identity', () => {
    const url = createMapShareUrl(
      'https://example.test/app/?developer=1#layers',
      { longitude: 44.801234, latitude: 41.712345, zoom: 12.345 },
      'sentinel-2-l2a:S2B_38TMM_20260720_0_L2A',
    );

    expect(url).toContain('developer=1');
    expect(url).toContain('map=1');
    expect(url).toContain('lat=41.71234');
    expect(url).toContain('lon=44.80123');
    expect(url).toContain('z=12.35');
    expect(url).toContain('scene=sentinel-2-l2a%3AS2B_38TMM_20260720_0_L2A');
    expect(url).toContain('#layers');
    expect(parseSharedMapView(new URL(url).search)).toEqual({
      center: { longitude: 44.80123, latitude: 41.71234 },
      zoom: 12.35,
      sceneKey: 'sentinel-2-l2a:S2B_38TMM_20260720_0_L2A',
    });
  });

  it('supports legacy unversioned links and ignores unknown versions', () => {
    expect(parseSharedMapView('?lat=42&lon=44&zoom=9')).toMatchObject({ zoom: 9 });
    expect(parseSharedMapView('?map=2&lat=42&lon=44&z=9')).toBeNull();
  });

  it('rejects invalid bounds and preserves private camera fields on override', () => {
    expect(parseSharedMapView('?map=1&lat=91&lon=44&z=9')).toBeNull();
    expect(
      applySharedMapView(defaultGeorgiaCamera, {
        center: { longitude: 44.8, latitude: 41.7 },
        zoom: 13,
        sceneKey: null,
      }),
    ).toEqual({ ...defaultGeorgiaCamera, longitude: 44.8, latitude: 41.7, zoom: 13 });
  });
});
