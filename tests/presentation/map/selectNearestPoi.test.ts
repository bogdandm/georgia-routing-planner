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

function waterNameFeature(
  id: string,
  geometryType: 'LineString' | 'MultiLineString',
  coordinates: unknown,
  properties: Record<string, unknown>,
): GeoJSONFeature {
  return {
    type: 'Feature',
    id,
    geometry: { type: geometryType, coordinates },
    properties,
    source: 'basemap-vector',
    sourceLayer: 'water_name',
    state: {},
    layer: {
      id: 'basemap-water-labels',
      type: 'symbol',
      source: 'basemap-vector',
    },
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

  it('measures named lake lines and prefers English names', () => {
    const selected = { longitude: 44.8, latitude: 41.7 };
    const result = selectNearestPoi(
      [
        pointFeature('nearby-hut', 44.8, 41.7001, {
          name: 'Nearby hut',
          subclass: 'alpine_hut',
        }),
        waterNameFeature(
          'lake-line',
          'LineString',
          [
            [44.8, 41.69],
            [44.8, 41.71],
          ],
          { 'name:en': 'English lake', name: 'ადგილობრივი ტბა', class: 'lake' },
        ),
      ],
      selected,
    );

    expect(result).toMatchObject({ name: 'English lake', category: 'lake' });
    expect(result?.distanceMeters).toBeLessThan(0.001);
  });

  it('chooses the nearest segment of a named lake multiline before point features', () => {
    const selected = { longitude: 44.8, latitude: 41.7 };
    const result = selectNearestPoi(
      [
        pointFeature('nearby-shelter', 44.8, 41.7001, {
          name: 'Nearby shelter',
          subclass: 'shelter',
        }),
        waterNameFeature(
          'lake-multiline',
          'MultiLineString',
          [
            [
              [44.9, 41.8],
              [44.91, 41.8],
            ],
            [
              [44.8, 41.69],
              [44.8, 41.71],
            ],
          ],
          { name: 'Segmented lake', class: 'lake' },
        ),
      ],
      selected,
    );

    expect(result).toMatchObject({ name: 'Segmented lake', category: 'lake' });
    expect(result?.distanceMeters).toBeLessThan(0.001);
  });

  it('ignores malformed named water lines without discarding valid nearby features', () => {
    const selected = { longitude: 44.8, latitude: 41.7 };
    expect(
      selectNearestPoi(
        [
          waterNameFeature('incomplete-lake-line', 'LineString', [[44.8, 41.7]], {
            name: 'Incomplete lake',
            class: 'lake',
          }),
          waterNameFeature(
            'non-finite-lake-line',
            'MultiLineString',
            [
              [
                [44.8, Number.NaN],
                [44.81, 41.7],
              ],
            ],
            { name: 'Non-finite lake', class: 'lake' },
          ),
          pointFeature('valid-hut', 44.8, 41.7001, {
            name: 'Valid hut',
            subclass: 'alpine_hut',
          }),
        ],
        selected,
      ),
    ).toMatchObject({ name: 'Valid hut', category: 'alpine_hut' });
  });
});
