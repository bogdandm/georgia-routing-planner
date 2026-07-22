import type { GeoJSONFeature } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import { selectNearestPoi } from '@/presentation/map/selectNearestPoi';

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
  it('selects the nearest named feature without a fixed distance cutoff', () => {
    const selected = { longitude: 44.8, latitude: 41.7 };
    const result = selectNearestPoi(
      [
        pointFeature('unnamed-nearby', 44.8, 41.7001, {
          subclass: 'alpine_hut',
        }),
        pointFeature('named-farther', 44.8, 41.73, { name: 'Farther village' }),
        pointFeature('named-nearest', 44.8, 41.72, {
          name: 'Glola',
          class: 'village',
        }),
      ],
      selected,
    );

    expect(result).toMatchObject({ name: 'Glola', category: 'village' });
    expect(result?.distanceMeters).toBeGreaterThan(100);
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
