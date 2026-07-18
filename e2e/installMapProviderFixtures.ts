import type { Page } from '@playwright/test';

const openFreeMapOrigin = 'https://tiles.openfreemap.org';

const tileJsonFixture = {
  tilejson: '3.0.0',
  name: 'Deterministic OpenMapTiles fixture',
  scheme: 'xyz',
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.0511, 180, 85.0511],
  attribution:
    '<a href="https://openfreemap.org">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
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
 * Replaces all configured basemap traffic with valid empty protobuf fixtures.
 * An empty vector-tile message is a valid tile with no layers or features.
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
}

export function isConfiguredProviderRequest(url: URL): boolean {
  return url.origin === openFreeMapOrigin;
}
