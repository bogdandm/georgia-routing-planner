import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { createTestServices } from '../../../test/helpers/createTestServices';

let database: AppDatabase;

beforeEach(async () => {
  const services = createTestServices();
  database = services.database;
  await database.delete();
  database = new AppDatabase(services.logger);
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe('AppDatabase', () => {
  it('uses safe defaults and persists validated UI preferences', async () => {
    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: false,
      navigationCollapsed: false,
    });

    await database.saveUiPreferences({
      developerMode: true,
      navigationCollapsed: true,
    });

    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: true,
      navigationCollapsed: true,
    });
  });

  it('repairs invalid persisted preferences', async () => {
    await database.settings.put({
      key: 'ui.preferences',
      value: { developerMode: 'yes' },
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: false,
      navigationCollapsed: false,
    });
    await expect(database.settings.get('ui.preferences')).resolves.toBeUndefined();
  });

  it('persists validated layer visibility and the currently applied scene', async () => {
    const appliedScene: SatelliteScene = {
      id: 'saved-scene',
      collection: 'sentinel-2-l2a',
      platform: 'sentinel-2a',
      productLevel: 'L2A',
      acquiredAt: '2026-07-12T10:12:00.000Z',
      cloudCoverPercent: 4,
      footprint: {
        type: 'Polygon',
        coordinates: [
          [
            [44, 42],
            [45, 42],
            [45, 43],
            [44, 42],
          ],
        ],
      },
      tileId: '38TMN',
      orbit: 'R036',
      productId: 'S2A_SAVED',
      thumbnailHref: null,
      visualAsset: {
        kind: 'sentinel-rgb-cogs',
        itemHref: 'https://earth-search.example.test/items/saved-scene',
        redHref: 'https://sentinel.example.test/saved-scene/B04.tif',
        greenHref: 'https://sentinel.example.test/saved-scene/B03.tif',
        blueHref: 'https://sentinel.example.test/saved-scene/B02.tif',
        projectionEpsg: 32638,
      },
      attribution: 'Synthetic test data',
    };
    const preferences = {
      visibility: {
        'satellite-imagery': false,
        'scene-footprint': true,
        'hiking-paths': true,
        roads: false,
        'places-and-pois': true,
      },
      appliedScene,
    } as const;

    await database.saveMapLayerPreferences(preferences);

    await expect(database.loadMapLayerPreferences()).resolves.toEqual(preferences);
  });

  it('runs a non-destructive storage probe', async () => {
    await database.probe();

    await expect(database.settings.get('__healthcheck__')).resolves.toBeUndefined();
  });
});
