import type { Page } from '@playwright/test';

const openFreeMapOrigin = 'https://tiles.openfreemap.org';
const terrainOrigin = 'https://s3.amazonaws.com';
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
 * The vector tile is an empty protobuf message and the DEM is a uniform 256 px PNG.
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
        body: Buffer.alloc(0),
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
}

export function isConfiguredProviderRequest(url: URL): boolean {
  return url.origin === openFreeMapOrigin || url.origin === terrainOrigin;
}
