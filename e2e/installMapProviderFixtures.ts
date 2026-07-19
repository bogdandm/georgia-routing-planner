import type { Page } from '@playwright/test';

const openFreeMapOrigin = 'https://tiles.openfreemap.org';
const terrainOrigin = 'https://s3.amazonaws.com';
const earthSearchOrigin = 'https://earth-search.aws.element84.com';
const terrainDemFixture = Buffer.from(
  [
    'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAADGklEQVR4nO3OQQ0AMBAEoZVe6ZUxjyNBAHsbnNUPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQPINQP',
    'INQPIPQBcakHgcA1wzQAAAAASUVORK5CYII=',
  ].join(''),
  'base64',
);

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    const byte = remaining & 0x7f;
    remaining >>>= 7;
    bytes.push(remaining === 0 ? byte : byte | 0x80);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

function encodeField(field: number, wireType: 0 | 2, value: number | Buffer): Buffer {
  const tag = encodeVarint((field << 3) | wireType);
  if (typeof value === 'number') return Buffer.concat([tag, encodeVarint(value)]);
  return Buffer.concat([tag, encodeVarint(value.length), value]);
}

function encodePacked(values: readonly number[]): Buffer {
  return Buffer.concat(values.map((value) => encodeVarint(value)));
}

function zigZag(value: number): number {
  return ((value << 1) ^ (value >> 31)) >>> 0;
}

function createVectorLayer(
  name: string,
  feature: Buffer,
  keys: readonly string[] = [],
  values: readonly Buffer[] = [],
): Buffer {
  return Buffer.concat([
    encodeField(1, 2, Buffer.from(name)),
    encodeField(2, 2, feature),
    ...keys.map((key) => encodeField(3, 2, Buffer.from(key))),
    ...values.map((value) => encodeField(4, 2, value)),
    encodeField(5, 0, 4_096),
    encodeField(15, 0, 2),
  ]);
}

function createVectorTileFixture(): Buffer {
  const waterFeature = Buffer.concat([
    encodeField(1, 0, 1),
    encodeField(3, 0, 3),
    encodeField(
      4,
      2,
      encodePacked([
        9,
        zigZag(100),
        zigZag(100),
        26,
        zigZag(3_896),
        zigZag(0),
        zigZag(0),
        zigZag(3_896),
        zigZag(-3_896),
        zigZag(0),
        15,
      ]),
    ),
  ]);
  const pathFeature = Buffer.concat([
    encodeField(1, 0, 2),
    encodeField(2, 2, encodePacked([0, 0])),
    encodeField(3, 0, 2),
    encodeField(
      4,
      2,
      encodePacked([
        9,
        zigZag(500),
        zigZag(3_500),
        18,
        zigZag(1_500),
        zigZag(-1_000),
        zigZag(1_500),
        zigZag(500),
      ]),
    ),
  ]);
  const pathValue = encodeField(1, 2, Buffer.from('path'));
  return Buffer.concat([
    encodeField(3, 2, createVectorLayer('water', waterFeature)),
    encodeField(
      3,
      2,
      createVectorLayer('transportation', pathFeature, ['class'], [pathValue]),
    ),
  ]);
}

const vectorTileFixture = createVectorTileFixture();

const tileJsonFixture = {
  tilejson: '3.0.0',
  name: 'Deterministic OpenMapTiles fixture',
  scheme: 'xyz',
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.0511, 180, 85.0511],
  attribution:
    '<a href="https://openfreemap.org">OpenFreeMap</a> &middot; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  tiles: [`${openFreeMapOrigin}/fixtures/{z}/{x}/{y}.pbf`],
  vector_layers: [
    'landcover',
    'landuse',
    'park',
    'water',
    'waterway',
    'boundary',
    'transportation',
    'transportation_name',
    'mountain_peak',
    'poi',
    'place',
    'water_name',
  ].map((id) => ({ id, fields: {} })),
};

/**
 * Replaces all configured provider traffic with deterministic local responses.
 * The vector tile contains a synthetic water polygon and hiking path; the DEM is a
 * uniform 256 px PNG. Neither fixture contains real-world or user location data.
 */
export async function installMapProviderFixtures(page: Page): Promise<void> {
  await page.route(
    new RegExp(`^${openFreeMapOrigin.replaceAll('.', '\\.')}`),
    (route) => {
      const url = new URL(route.request().url());

      if (url.pathname === '/planet') {
        return route.fulfill({ json: tileJsonFixture });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/x-protobuf',
        body: vectorTileFixture,
      });
    },
  );
  await page.route(
    new RegExp(`^${earthSearchOrigin.replaceAll('.', '\\.')}`),
    (route) =>
      route.fulfill({
        json: { type: 'FeatureCollection', features: [], links: [] },
      }),
  );
  await page.route(
    new RegExp(`^${terrainOrigin.replaceAll('.', '\\.')}/elevation-tiles-prod/`),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: terrainDemFixture,
      }),
  );
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.protocol.startsWith('http') &&
      url.hostname !== '127.0.0.1' &&
      !isConfiguredProviderRequest(url)
    ) {
      throw new Error(`Unexpected public network request to ${url.origin}.`);
    }
  });
}

export function isConfiguredProviderRequest(url: URL): boolean {
  return (
    url.origin === openFreeMapOrigin ||
    url.origin === terrainOrigin ||
    url.origin === earthSearchOrigin
  );
}
