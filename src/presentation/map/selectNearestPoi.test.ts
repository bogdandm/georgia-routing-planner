import type { GeoJSONFeature } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import {
  geodesicDistanceMeters,
  nearbyPoiRadiusMeters,
  selectNearestPoi,
} from '@/presentation/map/selectNearestPoi';

function pointFeature(
  id: string,
  longitude: number,
  latitude: number,
  properties: Record<string, unknown>,
): GeoJSONFeature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties,
    source: 'basemap-vector',
    sourceLayer: 'poi',
    state: {},
    layer: { id: 'fixture', type: 'circle', source: 'basemap-vector' },
  } as unknown as GeoJSONFeature;
}

describe('selectNearestPoi', () => {
  it('selects only candidates within the 100 metre geodesic radius', () => {
    const selected = { longitude: 44.8, latitude: 41.7 };
    expect(
      geodesicDistanceMeters(selected, { ...selected, latitude: 41.7004 }),
    ).toBeLessThan(nearbyPoiRadiusMeters);
    expect(
      selectNearestPoi(
        [
          pointFeature('far', 44.8, 41.702, { name: 'Far hut' }),
          pointFeature('near', 44.8, 41.7004, {
            name: 'Near hut',
            subclass: 'alpine_hut',
          }),
        ],
        selected,
      ),
    ).toMatchObject({ name: 'Near hut', category: 'alpine_hut' });
  });

  it('uses stable identity ordering and preferred English names for ties', () => {
    const selected = { longitude: 44.8, latitude: 41.7 };
    expect(
      selectNearestPoi(
        [
          pointFeature('b', 44.8, 41.7, { name: 'Native B' }),
          pointFeature('a', 44.8, 41.7, {
            'name:en': 'English A',
            name: 'Native A',
            class: 'attraction',
          }),
        ],
        selected,
      ),
    ).toEqual({ name: 'English A', category: 'attraction', distanceMeters: 0 });
  });
});
