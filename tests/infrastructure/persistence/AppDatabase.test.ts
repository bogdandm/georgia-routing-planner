import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { createTestServices } from '@test/helpers/createTestServices';

let database: AppDatabase;
let services: ReturnType<typeof createTestServices>;

const camera = {
  longitude: 44.8,
  latitude: 41.7,
  zoom: 9,
  bearing: 12,
  pitch: 35,
};

beforeEach(async () => {
  services = createTestServices();
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

  it('persists and repairs the satellite maximum cloud-cover preference', async () => {
    await expect(database.loadMaximumCloudCoverPercent()).resolves.toBe(50);

    await database.saveMaximumCloudCoverPercent(75);
    await expect(database.loadMaximumCloudCoverPercent()).resolves.toBe(75);

    await database.settings.put({
      key: 'satellite.maximum-cloud-cover',
      value: 125,
      updatedAt: '2026-07-18T00:00:00.000Z',
    });
    await expect(database.loadMaximumCloudCoverPercent()).resolves.toBe(50);
    await expect(
      database.settings.get('satellite.maximum-cloud-cover'),
    ).resolves.toBeUndefined();
  });

  it('persists layer visibility and imagery presentation choices without scene data', async () => {
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
        'imported-tracks': false,
      },
      openStreetMapOpacity: 0.65,
      importedTrackOpacity: 0.7,
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
        'imported-tracks': true,
      },
      importedTrackOpacity: 1,
      satelliteRenderingMode: 'auto',
      renderingTuning: { reflectanceMax: 11_000, gamma: 2.25, saturation: 2.5 },
      terrainOverlays: {
        contourIntervalMeters: 50,
        filterInvalidDemPixels: true,
        shadeAboveSatellite: false,
      },
    });
    await expect(database.settings.get('map.layers')).resolves.not.toHaveProperty(
      'value.appliedScene',
    );
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

  it('stores only a versioned 2D position and clamps it to supported ranges', async () => {
    await database.save({
      ...camera,
      longitude: 500,
      latitude: -100,
      zoom: 30,
      bearing: -500,
      pitch: 100,
    });

    await expect(database.load()).resolves.toEqual({
      longitude: 180,
      latitude: -85,
      zoom: 20,
      bearing: 0,
      pitch: 0,
    });
    await expect(database.settings.get('map.camera')).resolves.toEqual(
      expect.objectContaining({
        value: {
          schemaVersion: 3,
          camera: { longitude: 180, latitude: -85, zoom: 20 },
        },
      }),
    );
  });

  it.each([
    { schemaVersion: 1, camera },
    { schemaVersion: 2, camera, terrainMode: 'terrain' },
  ])('loads legacy camera schema $schemaVersion as a flat camera', async (value) => {
    await database.settings.put({
      key: 'map.camera',
      value,
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(database.load()).resolves.toEqual({
      longitude: camera.longitude,
      latitude: camera.latitude,
      zoom: camera.zoom,
      bearing: 0,
      pitch: 0,
    });
  });

  it('repairs only a corrupt camera record and emits one bounded warning', async () => {
    await database.settings.put({
      key: 'map.camera',
      value: { schemaVersion: 1, camera: { ...camera, zoom: Number.NaN } },
      updatedAt: '2026-07-18T00:00:00.000Z',
    });
    await database.settings.put({
      key: 'unrelated.setting',
      value: true,
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(database.load()).resolves.toBeNull();
    await expect(database.settings.get('map.camera')).resolves.toBeUndefined();
    await expect(database.settings.get('unrelated.setting')).resolves.toBeDefined();
    expect(
      services.logger
        .getEvents()
        .filter((event) => event.name === 'storage.map-camera.repaired'),
    ).toHaveLength(1);
  });

  it('surfaces camera storage read and write failures to the caller', async () => {
    vi.spyOn(database.settings, 'get').mockRejectedValueOnce(
      new Error('read unavailable'),
    );
    await expect(database.load()).rejects.toThrow('read unavailable');

    vi.spyOn(database.settings, 'put').mockRejectedValueOnce(
      new Error('write unavailable'),
    );
    await expect(database.save(camera)).rejects.toThrow('write unavailable');
  });
});
