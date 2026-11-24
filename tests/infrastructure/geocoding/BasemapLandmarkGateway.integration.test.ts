import { HttpResponse, http } from 'msw';
import Pbf from 'pbf';
import { describe, expect, it } from 'vitest';

import { BasemapLandmarkGateway } from '@/infrastructure/geocoding/BasemapLandmarkGateway';
import { createTestServices } from '@test/helpers/createTestServices';
import { mswServer } from '@test/setup/mswServer';

const tileJsonUrl = 'https://basemap.test/planet';
const tileUrl = 'https://basemap.test/tiles/:z/:x/:y.pbf';
const extent = 4_096;
const anchor = { longitude: 44.64, latitude: 42.66 } as const;

interface FixtureFeature {
  readonly layer: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly properties: Readonly<Record<string, string>>;
}

function tilePosition(longitude: number, latitude: number) {
  const tileCount = 2 ** 14;
  const x = ((longitude + 180) / 360) * tileCount;
  const radians = (latitude * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * tileCount;
  return {
    key: `${String(Math.floor(x))}/${String(Math.floor(y))}`,
    pixelX: Math.round((x - Math.floor(x)) * extent),
    pixelY: Math.round((y - Math.floor(y)) * extent),
  };
}

/** Encodes point features as a Mapbox Vector Tile with one layer per `layer` value. */
function encodeTile(features: readonly FixtureFeature[]): Uint8Array {
  const pbf = new Pbf();
  for (const layerName of new Set(features.map((feature) => feature.layer))) {
    const layerFeatures = features.filter((feature) => feature.layer === layerName);
    const keys = [...new Set(layerFeatures.flatMap((f) => Object.keys(f.properties)))];
    const values = [
      ...new Set(layerFeatures.flatMap((f) => Object.values(f.properties))),
    ];
    pbf.writeMessage(
      3,
      () => {
        pbf.writeVarintField(15, 2);
        pbf.writeStringField(1, layerName);
        layerFeatures.forEach((feature, index) => {
          const { pixelX, pixelY } = tilePosition(feature.longitude, feature.latitude);
          pbf.writeMessage(
            2,
            () => {
              pbf.writeVarintField(1, index + 1);
              pbf.writePackedVarint(
                2,
                Object.entries(feature.properties).flatMap(([key, value]) => [
                  keys.indexOf(key),
                  values.indexOf(value),
                ]),
              );
              pbf.writeVarintField(3, 1);
              pbf.writePackedVarint(4, [9, pixelX * 2, pixelY * 2]);
            },
            null,
          );
        });
        for (const key of keys) pbf.writeStringField(3, key);
        for (const value of values) {
          pbf.writeMessage(
            4,
            () => {
              pbf.writeStringField(1, value);
            },
            null,
          );
        }
        pbf.writeVarintField(5, extent);
      },
      null,
    );
  }
  return pbf.finish();
}

function serveBasemap(features: readonly FixtureFeature[]): void {
  const tiles = new Map<string, FixtureFeature[]>();
  for (const feature of features) {
    const { key } = tilePosition(feature.longitude, feature.latitude);
    tiles.set(key, [...(tiles.get(key) ?? []), feature]);
  }
  mswServer.use(
    http.get(tileJsonUrl, () =>
      HttpResponse.json({
        tiles: [tileUrl.replace(':z/:x/:y', '{z}/{x}/{y}')],
        maxzoom: 14,
      }),
    ),
    http.get(tileUrl, ({ params }) => {
      const bytes = encodeTile(
        tiles.get(`${String(params.x)}/${String(params.y)}`) ?? [],
      );
      return HttpResponse.arrayBuffer(bytes.slice().buffer);
    }),
  );
}

function createGateway(): BasemapLandmarkGateway {
  const services = createTestServices();
  return new BasemapLandmarkGateway(
    services.httpClient,
    tileJsonUrl,
    // A provider override may rename layers; peaks use a non-default name here.
    { peaks: 'summits', pois: 'poi', places: 'place', waterNames: 'water_name' },
    5_000,
    services.idGenerator,
  );
}

describe('BasemapLandmarkGateway', () => {
  it('classifies named landmarks from the configured layers within 2 km across tiles', async () => {
    serveBasemap([
      {
        layer: 'summits',
        longitude: 44.645,
        latitude: 42.661,
        properties: { class: 'peak', name: 'ყაზბეგი', 'name:en': 'Kazbek' },
      },
      {
        layer: 'summits',
        longitude: 44.641,
        latitude: 42.661,
        properties: { class: 'ridge', name: 'Ridge' },
      },
      {
        layer: 'poi',
        longitude: 44.6436,
        latitude: 42.6625,
        properties: {
          class: 'place_of_worship',
          subclass: 'christian',
          name: 'Gergeti Trinity Church',
        },
      },
      {
        layer: 'poi',
        longitude: 44.63,
        latitude: 42.67,
        properties: { class: 'lodging', subclass: 'alpine_hut', name: 'Bethlemi Hut' },
      },
      {
        layer: 'poi',
        longitude: 44.641,
        latitude: 42.659,
        properties: { class: 'cafe', subclass: 'cafe', name: 'Café' },
      },
      {
        layer: 'place',
        longitude: 44.62,
        latitude: 42.655,
        properties: { class: 'village', name: 'გერგეტი', 'name:latin': 'Gergeti' },
      },
      {
        layer: 'place',
        longitude: 44.639,
        latitude: 42.66,
        properties: { class: 'quarter', name: 'Quarter' },
      },
      {
        layer: 'water_name',
        longitude: 44.65,
        latitude: 42.65,
        properties: { class: 'lake', name: 'Tsivi Lake' },
      },
      {
        layer: 'summits',
        longitude: 44.64,
        latitude: 42.69,
        properties: { class: 'peak', name: 'Too Far' },
      },
    ]);

    const results = await createGateway().nearby(anchor, new AbortController().signal);

    expect(
      results.map(({ label, category, kind }) => ({ label, category, kind })),
    ).toEqual(
      expect.arrayContaining([
        { label: 'Kazbek', category: 'natural:peak', kind: 'mountain' },
        {
          label: 'Gergeti Trinity Church',
          category: 'amenity:place_of_worship',
          kind: 'other',
        },
        { label: 'Bethlemi Hut', category: 'tourism:alpine_hut', kind: 'other' },
        { label: 'Gergeti', category: 'place:village', kind: 'settlement' },
        { label: 'Tsivi Lake', category: 'natural:water', kind: 'water' },
      ]),
    );
    expect(results).toHaveLength(5);
    const peak = results.find((result) => result.label === 'Kazbek');
    expect(peak?.coordinate.longitude).toBeCloseTo(44.645, 4);
    expect(peak?.coordinate.latitude).toBeCloseTo(42.661, 4);
  });

  it('reports a rate-limited tile request as a typed failure', async () => {
    serveBasemap([]);
    mswServer.use(http.get(tileUrl, () => new HttpResponse(null, { status: 429 })));

    await expect(
      createGateway().nearby(anchor, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'rate-limited' });
  });
});
