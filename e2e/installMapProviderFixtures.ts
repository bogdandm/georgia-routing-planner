import type { Page } from '@playwright/test';
import { writeArrayBuffer } from 'geotiff';
import searchResponse from '../test/fixtures/satellite/search-response.json' with { type: 'json' };

const openFreeMapOrigin = 'https://tiles.openfreemap.org';
const terrainOrigin = 'https://s3.amazonaws.com';
const earthSearchOrigin = 'https://earth-search.aws.element84.com';
const satelliteRendererOrigin = 'https://titiler.xyz';
const sentinelCogFixtureOrigin = 'https://sentinel-cogs.example.test';
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

function createSentinelCogFixture(): Buffer {
  const width = 256;
  const height = 256;
  const reflectance = new Uint16Array(width * height);
  reflectance.fill(4_000);
  return Buffer.from(
    writeArrayBuffer(reflectance, {
      width,
      height,
      BitsPerSample: [16],
      SampleFormat: [1],
      SamplesPerPixel: 1,
      PhotometricInterpretation: 1,
      ModelPixelScale: [1_562.5, 1_953.125, 0],
      ModelTiepoint: [0, 0, 0, 300_000, 5_000_000, 0],
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
      ProjectedCSTypeGeoKey: 32_638,
      GDAL_NODATA: '0',
    }),
  );
}

const sentinelCogFixture = createSentinelCogFixture();

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
const satelliteSearchFixture = structuredClone(searchResponse);
const satelliteFeature = satelliteSearchFixture.features[0];
if (satelliteFeature !== undefined) {
  satelliteFeature.id = 'S2A_38TMN_20260709_0_L2A';
  satelliteFeature.properties.datetime = '2026-07-09T08:08:21.070000Z';
  satelliteFeature.properties['s2:product_uri'] =
    'S2A_MSIL2A_20260709T080821_N0512_R135_T38TMN_SYNTHETIC.SAFE';
}

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
    (route) => {
      const requestBody = route.request().postDataJSON() as {
        readonly datetime?: unknown;
      };
      const isCurrentMonth =
        typeof requestBody.datetime === 'string' &&
        requestBody.datetime.startsWith('2026-07-01');
      return route.fulfill({
        json: isCurrentMonth
          ? satelliteSearchFixture
          : {
              type: 'FeatureCollection',
              context: { matched: 0, returned: 0, limit: 100 },
              features: [],
              links: [],
            },
      });
    },
  );
  await page.route(
    new RegExp(`^${satelliteRendererOrigin.replaceAll('.', '\\.')}`),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: terrainDemFixture,
      }),
  );
  await page.route(
    new RegExp(`^${sentinelCogFixtureOrigin.replaceAll('.', '\\.')}`),
    (route) => {
      const range = /^bytes=(\d+)-(\d*)$/u.exec(route.request().headers().range ?? '');
      if (range === null) {
        return route.fulfill({
          status: 200,
          contentType: 'image/tiff',
          headers: {
            'accept-ranges': 'bytes',
            'access-control-allow-origin': '*',
          },
          body: sentinelCogFixture,
        });
      }
      const start = Number(range[1]);
      const requestedEnd =
        range[2] === '' ? sentinelCogFixture.length - 1 : Number(range[2]);
      const end = Math.min(requestedEnd, sentinelCogFixture.length - 1);
      return route.fulfill({
        status: 206,
        contentType: 'image/tiff',
        headers: {
          'accept-ranges': 'bytes',
          'access-control-allow-origin': '*',
          'content-range': `bytes ${String(start)}-${String(end)}/${String(sentinelCogFixture.length)}`,
        },
        body: sentinelCogFixture.subarray(start, end + 1),
      });
    },
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
    url.origin === earthSearchOrigin ||
    url.origin === satelliteRendererOrigin ||
    url.origin === sentinelCogFixtureOrigin
  );
}
