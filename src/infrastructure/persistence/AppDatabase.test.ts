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

  it('persists layer visibility, imagery stretch, and the applied scene', async () => {
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
        kind: 'sentinel-l2a',
        itemHref: 'https://earth-search.example.test/items/saved-scene',
        visualHref: 'https://sentinel.example.test/saved-scene/TCI.tif',
        mediaType: 'image/tiff; application=geotiff; profile=cloud-optimized',
        projectionEpsg: 32638,
      },
      attribution: 'Synthetic test data',
    };
    const preferences = {
      visibility: {
        'satellite-imagery': false,
        'scene-footprint': true,
        'terrain-relief': false,
        'elevation-isolines': true,
        'natural-features': true,
        'restricted-areas': true,
        'hiking-paths': true,
        roads: false,
        'places-and-pois': true,
      },
      openStreetMapOpacity: 0.65,
      appliedScene,
      satelliteRenderingMode: 'server',
      renderingTuning: { reflectanceMax: 6_500, gamma: 1.6, saturation: 1.2 },
      terrainOverlays: {
        contourIntervalMeters: 25,
        filterInvalidDemPixels: false,
        shadeAboveSatellite: true,
      },
    } as const;

    await database.saveMapLayerPreferences(preferences);

    await expect(database.loadMapLayerPreferences()).resolves.toEqual(preferences);
  });

  it('adds safe imagery stretch defaults to older layer preference records', async () => {
    await database.settings.put({
      key: 'map.layers',
      value: {
        visibility: {
          'satellite-imagery': true,
          'scene-footprint': true,
          'hiking-paths': true,
          roads: true,
          'places-and-pois': true,
        },
        appliedScene: null,
      },
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(database.loadMapLayerPreferences()).resolves.toMatchObject({
      visibility: {
        'terrain-relief': true,
        'elevation-isolines': true,
        'natural-features': true,
        'restricted-areas': true,
      },
      satelliteRenderingMode: 'auto',
      renderingTuning: { reflectanceMax: 11_000, gamma: 2.25, saturation: 2.5 },
      terrainOverlays: {
        contourIntervalMeters: 50,
        filterInvalidDemPixels: true,
        shadeAboveSatellite: false,
      },
    });
  });

  it('repairs unsupported persisted terrain overlay values to safe defaults', async () => {
    await database.settings.put({
      key: 'map.layers',
      value: {
        visibility: {
          'satellite-imagery': true,
          'scene-footprint': true,
          'hiking-paths': true,
          roads: true,
          'places-and-pois': true,
        },
        appliedScene: null,
        renderingTuning: {
          reflectanceMax: 11_000,
          gamma: 2.25,
          saturation: 2.5,
        },
        terrainOverlays: {
          contourIntervalMeters: 30,
          shadeAboveSatellite: 'yes',
        },
      },
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(database.loadMapLayerPreferences()).resolves.toMatchObject({
      terrainOverlays: {
        contourIntervalMeters: 50,
        filterInvalidDemPixels: true,
        shadeAboveSatellite: false,
      },
    });
    await expect(database.settings.get('map.layers')).resolves.toBeUndefined();
  });

  it('runs a non-destructive storage probe', async () => {
    await database.probe();

    await expect(database.settings.get('__healthcheck__')).resolves.toBeUndefined();
  });
});
