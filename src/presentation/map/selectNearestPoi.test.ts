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
    const nearLatitude = selected.latitude + 0.0004;
    const farLatitude = selected.latitude + 0.002;

    expect(
      geodesicDistanceMeters(selected, { ...selected, latitude: nearLatitude }),
    ).toBeLessThan(nearbyPoiRadiusMeters);
    expect(
      selectNearestPoi(
        [
          pointFeature('far', selected.longitude, farLatitude, { name: 'Far hut' }),
          pointFeature('near', selected.longitude, nearLatitude, {
            name: 'Near hut',
            subclass: 'alpine_hut',
          }),
        ],
        selected,
      ),
    ).toMatchObject({ name: 'Near hut', category: 'alpine_hut' });
  });

  it('uses stable identity ordering for equidistant features and preferred names', () => {
    const selected = { longitude: 44.8, latitude: 41.7 };
    expect(
      selectNearestPoi(
        [
          pointFeature('b', selected.longitude, selected.latitude, {
            name: 'Native B',
          }),
          pointFeature('a', selected.longitude, selected.latitude, {
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
