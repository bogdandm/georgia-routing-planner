import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SAVED_MARKER_SCHEMA_VERSION,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
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

function marker(overrides: Partial<SavedMarker> = {}): SavedMarker {
  return {
    schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
    id: 'marker:1',
    name: 'Tbilisi view',
    normalizedName: 'tbilisi view',
    coordinate: [44.8, 41.7],
    iconKey: 'place',
    colorKey: 'blue',
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    ...overrides,
  };
}

function localTrackSummary(): LocalTrackSummary {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    id: 'local:legacy',
    name: 'Legacy ridge',
    normalizedName: 'legacy ridge',
    savedAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sourceFilename: 'legacy.gpx',
    sourceFormat: 'gpx',
    favorite: false,
    geometryKind: 'track',
    pointCount: 2,
    segmentCount: 1,
    metrics: {
      distanceMeters: 1_000,
      distanceAlgorithmVersion: 1,
      startCoordinate: [44, 42],
      endCoordinate: [44.01, 42.01],
      bounds: {
        west: 44,
        south: 42,
        east: 44.01,
        north: 42.01,
        crossesAntimeridian: false,
      },
      center: [44.005, 42.005],
      elevationSource: 'dem-assisted',
      elevationAlgorithmVersion: 3,
    },
    metadata: { version: '1.1', links: [] },
    warnings: [],
  };
}

function localTrackContent(): LocalTrackContent {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId: 'local:legacy',
    trackPoints: [
      [
        { coordinate: [44, 42], elevationMeters: 1_000 },
        { coordinate: [44.01, 42.01], elevationMeters: 1_100 },
      ],
    ],
  };
}

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
      elevationGradeLegendDismissed: false,
      markerSort: 'created',
    });

    await database.saveUiPreferences({
      developerMode: true,
      navigationCollapsed: true,
      elevationGradeLegendDismissed: true,
      markerSort: 'distance',
    });

    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: true,
      navigationCollapsed: true,
      elevationGradeLegendDismissed: true,
      markerSort: 'distance',
    });

    await database.saveElevationGradeLegendDismissed(false);
    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: true,
      navigationCollapsed: true,
      elevationGradeLegendDismissed: false,
      markerSort: 'distance',
    });
  });

  it('adds the default marker sort to persisted earlier UI preferences', async () => {
    await database.settings.put({
      key: 'ui.preferences',
      value: {
        developerMode: true,
        navigationCollapsed: true,
        elevationGradeLegendDismissed: false,
      },
      updatedAt: '2026-08-08T10:00:00.000Z',
    });

    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: true,
      navigationCollapsed: true,
      elevationGradeLegendDismissed: false,
      markerSort: 'created',
    });
  });

  it('persists markers atomically and validates storage boundaries', async () => {
    const original = marker();
    await database.saveSavedMarker(original);
    const updated = await database.updateSavedMarker(original.id, {
      name: 'Updated view',
      normalizedName: 'updated view',
      iconKey: 'hiking',
      colorKey: 'teal',
      updatedAt: '2026-08-08T11:00:00.000Z',
    });
    expect(updated).toEqual({
      ...original,
      name: 'Updated view',
      normalizedName: 'updated view',
      iconKey: 'hiking',
      colorKey: 'teal',
      updatedAt: '2026-08-08T11:00:00.000Z',
    });
    await expect(database.listSavedMarkers()).resolves.toEqual([updated]);

    await expect(
      database.saveSavedMarker({ ...updated, id: original.id }),
    ).rejects.toMatchObject({ code: 'record-invalid' });
    await expect(
      database.saveSavedMarker({ ...updated, coordinate: [181, 41.7] }),
    ).rejects.toMatchObject({ code: 'record-invalid' });
    await expect(
      database.updateSavedMarker(original.id, {
        name: 'Not normalized ',
        normalizedName: 'not normalized',
        iconKey: 'hiking',
        colorKey: 'teal',
        updatedAt: '2026-08-08T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'record-invalid' });
    await expect(database.listSavedMarkers()).resolves.toEqual([updated]);

    await expect(
      database.updateSavedMarker('missing', {
        name: 'Missing',
        normalizedName: 'missing',
        iconKey: 'place',
        colorKey: 'blue',
        updatedAt: '2026-08-08T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(database.deleteSavedMarker('missing')).rejects.toMatchObject({
      code: 'not-found',
    });

    await database.deleteSavedMarker(original.id);
    await expect(database.listSavedMarkers()).resolves.toEqual([]);
  });

  it('persists a bounded Unicode name when normalization expands it', async () => {
    const name = 'İ'.repeat(200);
    const normalizedName = name.toLocaleLowerCase('en');
    expect(normalizedName.length).toBeGreaterThan(name.length);
    const saved = marker({ name, normalizedName });

    await database.saveSavedMarker(saved);

    await expect(database.listSavedMarkers()).resolves.toEqual([saved]);
  });

  it('omits malformed saved-marker rows and reports their count without deleting them', async () => {
    const valid = marker();
    await database.saveSavedMarker(valid);
    await database.table('savedMarkers').put({
      id: 'malformed',
      schemaVersion: 1,
      name: 'Malformed',
      normalizedName: 'different',
      coordinate: [44.8, 41.7],
      iconKey: 'place',
      colorKey: 'blue',
      createdAt: '2026-08-08T10:00:00.000Z',
      updatedAt: '2026-08-08T10:00:00.000Z',
    });

    await expect(database.listSavedMarkers()).resolves.toEqual([valid]);
    expect(
      services.logger
        .getEvents()
        .filter((event) => event.name === 'storage.saved-markers.invalid-record'),
    ).toEqual([
      expect.objectContaining({
        data: { invalidCount: 1 },
      }),
    ]);
    await expect(
      database.table('savedMarkers').get('malformed'),
    ).resolves.toBeDefined();
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

  it('persists Google-only layer visibility and imagery presentation choices without scene data', async () => {
    await expect(database.loadMapLayerPreferences()).resolves.toMatchObject({
      visibility: { 'google-satellite': false },
    });
    const preferences = {
      visibility: {
        'google-satellite': true,
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
        'track-elevation-gradient': false,
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
        'google-satellite': false,
        'terrain-relief': true,
        'elevation-isolines': true,
        'natural-features': true,
        'restricted-areas': true,
        'imported-tracks': true,
        'track-elevation-gradient': true,
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

  it('persists the Google default into otherwise valid older layer preferences', async () => {
    const preferences = await database.loadMapLayerPreferences();
    const { 'google-satellite': _googleSatellite, ...visibility } =
      preferences.visibility;
    await database.settings.put({
      key: 'map.layers',
      value: { ...preferences, visibility },
      updatedAt: '2026-08-06T00:00:00.000Z',
    });

    await expect(database.loadMapLayerPreferences()).resolves.toMatchObject({
      visibility: { 'google-satellite': false },
    });
    await expect(database.settings.get('map.layers')).resolves.toMatchObject({
      value: { visibility: { 'google-satellite': false } },
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

  it('upgrades version 5 without changing existing rows and creates savedMarkers', async () => {
    database.close();
    await database.delete();

    const legacy = new Dexie('GeorgiaRoutingPlanner');
    legacy.version(5).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
      trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
    });
    const summary = localTrackSummary();
    const content = localTrackContent();
    const syncState = {
      trackId: summary.id,
      contentHash: summary.contentHash ?? '',
      remoteRevision: null,
      pendingKind: 'upsert',
    };
    const settings = {
      key: 'ui.preferences',
      value: {
        developerMode: false,
        navigationCollapsed: true,
        elevationGradeLegendDismissed: false,
      },
      updatedAt: '2026-08-08T10:00:00.000Z',
    };
    await legacy.table('settings').put(settings);
    await legacy.table('localTracks').put(summary);
    await legacy.table('localTrackContents').put(content);
    await legacy.table('trackSyncStates').put(syncState);
    legacy.close();

    database = new AppDatabase(services.logger);

    await expect(database.settings.get(settings.key)).resolves.toEqual(settings);
    await expect(database.localTracks.get(summary.id)).resolves.toEqual(summary);
    await expect(database.localTrackContents.get(content.trackId)).resolves.toEqual(
      content,
    );
    await expect(database.trackSyncStates.get(syncState.trackId)).resolves.toEqual(
      syncState,
    );
    expect(database.tables.map((table) => table.name)).toContain('savedMarkers');
    await expect(database.listSavedMarkers()).resolves.toEqual([]);

    const saved = marker();
    await database.saveSavedMarker(saved);
    await expect(database.listSavedMarkers()).resolves.toEqual([saved]);
  });
});
