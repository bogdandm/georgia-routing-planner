import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SAVED_MARKER_SCHEMA_VERSION,
  markerIconKeys,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import {
  IMPORTS_FOLDER_ID,
  TRACK_FOLDER_SCHEMA_VERSION,
  normalizeTrackFolderName,
  type TrackFolder,
} from '@/domain/tracks/trackFolder';
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
    elevationMeters: null,
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
    folderId: 'imports',
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

function trackFolder(
  id: string,
  name: string,
  overrides: Partial<TrackFolder> = {},
): TrackFolder {
  return {
    schemaVersion: TRACK_FOLDER_SCHEMA_VERSION,
    id,
    ...normalizeTrackFolderName(name),
    iconKey: 'folder',
    position: 0,
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    ...overrides,
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
    markers: [],
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
      locale: null,
      navigationCollapsed: false,
      elevationGradeLegendDismissed: false,
      markerSort: 'created',
      trackSort: 'created',
      onboardingCompleted: false,
    });

    await database.saveUiPreferences({
      developerMode: true,
      locale: 'ru',
      navigationCollapsed: true,
      elevationGradeLegendDismissed: true,
      markerSort: 'distance',
      trackSort: 'distance',
      onboardingCompleted: true,
    });

    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: true,
      locale: 'ru',
      navigationCollapsed: true,
      elevationGradeLegendDismissed: true,
      markerSort: 'distance',
      trackSort: 'distance',
      onboardingCompleted: true,
    });

    await database.saveElevationGradeLegendDismissed(false);
    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: true,
      locale: 'ru',
      navigationCollapsed: true,
      elevationGradeLegendDismissed: false,
      markerSort: 'distance',
      trackSort: 'distance',
      onboardingCompleted: true,
    });
  });

  it('persists marker weather preferences and repairs invalid custom hours', async () => {
    await expect(database.loadWeatherIntervalPreferences()).resolves.toEqual({
      weekdays: [6, 0],
      period: { kind: 'day' },
      showOnMap: true,
    });

    await database.saveWeatherIntervalPreferences({
      weekdays: [1, 4],
      period: { kind: 'custom', startHour: 8, endHour: 17 },
      showOnMap: false,
    });
    await expect(database.loadWeatherIntervalPreferences()).resolves.toEqual({
      weekdays: [1, 4],
      period: { kind: 'custom', startHour: 8, endHour: 17 },
      showOnMap: false,
    });

    await database.settings.put({
      key: 'weather.interval-preferences',
      value: {
        weekdays: [1],
        period: { kind: 'custom', startHour: 8, endHour: 8 },
        showOnMap: true,
      },
      updatedAt: '2026-08-08T10:00:00.000Z',
    });
    await expect(database.loadWeatherIntervalPreferences()).resolves.toEqual({
      weekdays: [6, 0],
      period: { kind: 'day' },
      showOnMap: true,
    });
    await expect(
      database.settings.get('weather.interval-preferences'),
    ).resolves.toBeUndefined();
  });

  it('keeps track forecast preferences collapsed on Saturday until saved and repairs invalid ones', async () => {
    await expect(database.loadTrackWeatherPreferences()).resolves.toEqual({
      expanded: false,
      weekday: 6,
    });

    await database.saveTrackWeatherPreferences({ expanded: true, weekday: 3 });
    await expect(database.loadTrackWeatherPreferences()).resolves.toEqual({
      expanded: true,
      weekday: 3,
    });

    await database.settings.put({
      key: 'weather.track-preferences',
      value: { expanded: true, weekday: 7 },
      updatedAt: '2026-08-08T10:00:00.000Z',
    });
    await expect(database.loadTrackWeatherPreferences()).resolves.toEqual({
      expanded: false,
      weekday: 6,
    });
    await expect(
      database.settings.get('weather.track-preferences'),
    ).resolves.toBeUndefined();
  });

  it('persists at most 21 unique recently used marker icons and repairs invalid data', async () => {
    await expect(database.loadRecentMarkerIconKeys()).resolves.toEqual([]);

    await database.saveRecentMarkerIconKeys(['telescope', 'moon', 'lake']);
    await expect(database.loadRecentMarkerIconKeys()).resolves.toEqual([
      'telescope',
      'moon',
      'lake',
    ]);
    await expect(
      database.saveRecentMarkerIconKeys(markerIconKeys.slice(0, 22)),
    ).rejects.toThrow();

    await database.settings.put({
      key: 'markers.recent-icons',
      value: ['moon', 'moon'],
      updatedAt: '2026-08-08T10:00:00.000Z',
    });
    await expect(database.loadRecentMarkerIconKeys()).resolves.toEqual([]);
    await expect(
      database.settings.get('markers.recent-icons'),
    ).resolves.toBeUndefined();
  });

  it('adds default sorts and an unseen tour to persisted earlier UI preferences', async () => {
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
      locale: null,
      navigationCollapsed: true,
      elevationGradeLegendDismissed: false,
      markerSort: 'created',
      trackSort: 'created',
      onboardingCompleted: false,
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
    const elevated = await database.saveSavedMarkerElevation(original.id, 1_450.5);
    expect(elevated).toEqual({ ...updated, elevationMeters: 1_450.5 });
    await expect(database.listSavedMarkers()).resolves.toEqual([elevated]);

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
    await expect(database.listSavedMarkers()).resolves.toEqual([elevated]);

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

  it('persists one static basemap and imagery presentation choices without scene data', async () => {
    await expect(database.loadMapLayerPreferences()).resolves.toMatchObject({
      visibility: {
        'google-satellite': false,
        'bing-satellite': false,
        'esri-satellite': false,
      },
    });
    const preferences = {
      visibility: {
        'google-satellite': true,
        'bing-satellite': false,
        'esri-satellite': false,
        'napr-orthophoto': false,
        'satellite-imagery': false,
        'scene-footprint': true,
        'terrain-relief': false,
        'elevation-isolines': true,
        'natural-features': true,
        'restricted-areas': true,
        'detail-context': true,
        'hiking-paths': true,
        roads: false,
        'places-and-pois': true,
        'imported-tracks': false,
        'track-elevation-gradient': false,
      },
      openStreetMapOpacity: 0.65,
      importedTrackOpacity: 0.7,
      weatherMapOpacity: 0.8,
      satelliteRenderingMode: 'server',
      renderingTuning: { reflectanceMax: 6_500, gamma: 1.6, saturation: 1.2 },
      terrainOverlays: {
        contourIntervalMeters: 25,
        shadeAboveSatellite: true,
      },
    } as const;

    await database.saveMapLayerPreferences(preferences);

    await expect(database.loadMapLayerPreferences()).resolves.toEqual(preferences);
  });

  it('loads stored layer preferences that still carry the removed DEM repair flag', async () => {
    const preferences = await database.loadMapLayerPreferences();
    await database.settings.put({
      key: 'map.layers',
      value: {
        ...preferences,
        terrainOverlays: {
          contourIntervalMeters: 25,
          filterInvalidDemPixels: false,
          shadeAboveSatellite: true,
        },
      },
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    const loaded = await database.loadMapLayerPreferences();

    expect(loaded.terrainOverlays).toEqual({
      contourIntervalMeters: 25,
      shadeAboveSatellite: true,
    });
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
        'bing-satellite': false,
        'esri-satellite': false,
        'terrain-relief': true,
        'elevation-isolines': true,
        'natural-features': true,
        'restricted-areas': true,
        'imported-tracks': true,
        'track-elevation-gradient': true,
      },
      importedTrackOpacity: 1,
      weatherMapOpacity: 1,
      satelliteRenderingMode: 'auto',
      renderingTuning: { reflectanceMax: 11_000, gamma: 2.25, saturation: 2.5 },
      terrainOverlays: {
        contourIntervalMeters: 50,
        shadeAboveSatellite: false,
      },
    });
    await expect(database.settings.get('map.layers')).resolves.not.toHaveProperty(
      'value.appliedScene',
    );
    await expect(database.settings.get('map.layers')).resolves.toHaveProperty(
      'value.weatherMapOpacity',
      1,
    );
  });

  it('repairs otherwise valid older layer preferences missing NAPR visibility', async () => {
    const preferences = await database.loadMapLayerPreferences();
    const { 'napr-orthophoto': _naprOrthophoto, ...visibility } =
      preferences.visibility;
    await database.settings.put({
      key: 'map.layers',
      value: { ...preferences, visibility },
      updatedAt: '2026-08-08T00:00:00.000Z',
    });

    await expect(database.loadMapLayerPreferences()).resolves.toMatchObject({
      visibility: {
        'google-satellite': false,
        'napr-orthophoto': false,
      },
    });
    await expect(database.settings.get('map.layers')).resolves.toMatchObject({
      value: { visibility: { 'napr-orthophoto': false } },
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
        shadeAboveSatellite: false,
      },
    });
    await expect(database.settings.get('map.layers')).resolves.toBeUndefined();
  });

  it('runs a non-destructive storage probe', async () => {
    await database.probe();

    await expect(database.settings.get('__healthcheck__')).resolves.toBeUndefined();
  });

  it('stores a 2D view without orientation and clamps it to supported ranges', async () => {
    await database.save({
      camera: {
        longitude: 500,
        latitude: -100,
        zoom: 30,
        bearing: -500,
        pitch: 100,
      },
      terrainMode: 'flat',
    });

    const flatCamera = {
      longitude: 180,
      latitude: -85,
      zoom: 20,
      bearing: 0,
      pitch: 0,
    };
    await expect(database.load()).resolves.toEqual({
      camera: flatCamera,
      terrainMode: 'flat',
    });
    await expect(database.settings.get('map.camera')).resolves.toEqual(
      expect.objectContaining({
        value: { schemaVersion: 4, terrainMode: 'flat', camera: flatCamera },
      }),
    );
  });

  it('restores a 3D view with its clamped bearing and pitch', async () => {
    await database.save({
      camera: { ...camera, bearing: -500, pitch: 100 },
      terrainMode: 'terrain',
    });

    await expect(database.load()).resolves.toEqual({
      camera: { ...camera, bearing: -180, pitch: 85 },
      terrainMode: 'terrain',
    });
  });

  it.each([
    { schemaVersion: 1, camera },
    { schemaVersion: 2, camera, terrainMode: 'terrain' },
    {
      schemaVersion: 3,
      camera: {
        longitude: camera.longitude,
        latitude: camera.latitude,
        zoom: camera.zoom,
      },
    },
  ])('loads legacy camera schema $schemaVersion as a flat view', async (value) => {
    await database.settings.put({
      key: 'map.camera',
      value,
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(database.load()).resolves.toEqual({
      camera: {
        longitude: camera.longitude,
        latitude: camera.latitude,
        zoom: camera.zoom,
        bearing: 0,
        pitch: 0,
      },
      terrainMode: 'flat',
    });
  });

  it.each([
    { schemaVersion: 1, camera: { ...camera, zoom: Number.NaN } },
    { schemaVersion: 4, camera, terrainMode: 'globe' },
  ])(
    'repairs only a corrupt camera record and emits one bounded warning',
    async (value) => {
      await database.settings.put({
        key: 'map.camera',
        value,
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
    },
  );

  it('surfaces camera storage read and write failures to the caller', async () => {
    vi.spyOn(database.settings, 'get').mockRejectedValueOnce(
      new Error('read unavailable'),
    );
    await expect(database.load()).rejects.toThrow('read unavailable');

    vi.spyOn(database.settings, 'put').mockRejectedValueOnce(
      new Error('write unavailable'),
    );
    await expect(database.save({ camera, terrainMode: 'flat' })).rejects.toThrow(
      'write unavailable',
    );
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

  it('backfills pending sync state for saved markers when upgrading version 6', async () => {
    database.close();
    await database.delete();

    const legacy = new Dexie('GeorgiaRoutingPlanner');
    legacy.version(6).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
      trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
      savedMarkers: 'id,normalizedName,colorKey,createdAt',
    });
    const saved = marker();
    await legacy.table('savedMarkers').put(saved);
    legacy.close();

    database = new AppDatabase(services.logger);

    await expect(database.readMarkerSyncSnapshot()).resolves.toEqual([
      {
        marker: saved,
        state: {
          markerId: saved.id,
          remoteRevision: null,
          pendingKind: 'upsert',
          localVersion: 1,
        },
      },
    ]);
  });

  it('upgrades version 7 marker rows with unresolved elevation without changing sync state', async () => {
    database.close();
    await database.delete();

    const legacy = new Dexie('GeorgiaRoutingPlanner');
    legacy.version(7).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
      trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
      savedMarkers: 'id,normalizedName,colorKey,createdAt',
      markerSyncStates: 'markerId,remoteRevision,pendingKind',
    });
    const legacyMarker = {
      id: 'marker:legacy',
      schemaVersion: 1,
      name: 'Legacy marker',
      normalizedName: 'legacy marker',
      coordinate: [44.8, 41.7],
      iconKey: 'place',
      colorKey: 'blue',
      createdAt: '2026-08-08T10:00:00.000Z',
      updatedAt: '2026-08-08T10:00:00.000Z',
    };
    const syncState = {
      markerId: legacyMarker.id,
      remoteRevision: 3,
      pendingKind: null,
      localVersion: 2,
    };
    await legacy.table('savedMarkers').put(legacyMarker);
    await legacy.table('markerSyncStates').put(syncState);
    legacy.close();

    database = new AppDatabase(services.logger);

    const upgraded = {
      ...legacyMarker,
      schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
      elevationMeters: null,
    };
    await expect(database.listSavedMarkers()).resolves.toEqual([upgraded]);
    await expect(database.savedMarkers.get(legacyMarker.id)).resolves.toEqual(upgraded);
    await expect(database.markerSyncStates.get(legacyMarker.id)).resolves.toEqual(
      syncState,
    );
  });

  it('tracks marker local versions and retains unacknowledged delete tombstones', async () => {
    const saved = marker();
    await database.saveSavedMarker(saved);
    await expect(database.readMarkerSyncSnapshot()).resolves.toEqual([
      {
        marker: saved,
        state: {
          markerId: saved.id,
          remoteRevision: null,
          pendingKind: 'upsert',
          localVersion: 1,
        },
      },
    ]);

    await database.updateSavedMarker(saved.id, {
      name: 'Updated view',
      normalizedName: 'updated view',
      iconKey: 'place',
      colorKey: 'blue',
      updatedAt: '2026-08-08T11:00:00.000Z',
    });
    await database.deleteSavedMarker(saved.id);

    await expect(database.readMarkerSyncSnapshot()).resolves.toEqual([
      {
        marker: null,
        state: {
          markerId: saved.id,
          remoteRevision: null,
          pendingKind: 'delete',
          localVersion: 3,
        },
      },
    ]);
  });

  it('restores a cloud-deleted marker as a new remote incarnation', async () => {
    const saved = marker();
    await database.saveSavedMarker(saved);
    await database.markerSyncStates.put({
      markerId: saved.id,
      remoteRevision: 5,
      pendingKind: null,
      localVersion: 1,
    });
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-a',
      updatedAt: '2026-08-08T10:00:00.000Z',
    });

    await database.resolveRemoteDeletions({
      expectedUserId: 'user-a',
      trackCandidateIds: [],
      markerCandidateIds: [saved.id],
      tracks: { deleteIds: [], restoreIds: [] },
      markers: { deleteIds: [], restoreIds: [saved.id] },
    });

    await expect(database.readMarkerSyncSnapshot()).resolves.toEqual([
      {
        marker: saved,
        state: {
          markerId: saved.id,
          remoteRevision: null,
          pendingKind: 'upsert',
          localVersion: 2,
        },
      },
    ]);
  });

  it('rejects remote deletion decisions with non-candidate identifiers', async () => {
    await expect(
      database.resolveRemoteDeletions({
        expectedUserId: 'user-a',
        trackCandidateIds: [],
        markerCandidateIds: ['marker:1'],
        tracks: { deleteIds: [], restoreIds: [] },
        markers: { deleteIds: ['marker:1', 'marker:outside'], restoreIds: [] },
      }),
    ).rejects.toMatchObject({ code: 'record-invalid' });
  });

  it('upgrades version 8 tracks into exactly one Imports folder', async () => {
    database.close();
    await database.delete();

    const legacy = new Dexie('GeorgiaRoutingPlanner');
    legacy.version(8).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
      trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
      savedMarkers: 'id,normalizedName,colorKey,createdAt',
      markerSyncStates: 'markerId,remoteRevision,pendingKind',
    });
    const imported = localTrackSummary();
    const importedLegacy = {
      ...imported,
      schemaVersion: 5,
    } as Record<string, unknown>;
    delete importedLegacy.folderId;
    const routeLegacy = {
      ...importedLegacy,
      id: 'local:route',
      geometryKind: 'route',
      name: 'Route',
      normalizedName: 'route',
    };
    await legacy.table('localTracks').bulkPut([importedLegacy, routeLegacy]);
    await legacy.table('trackSyncStates').bulkPut([
      {
        trackId: imported.id,
        contentHash: imported.contentHash,
        lineageHash: imported.contentHash,
        geometryVersion: 2,
        remoteRevision: 4,
        pendingKind: null,
      },
      {
        trackId: 'local:route',
        contentHash: imported.contentHash,
        lineageHash: imported.contentHash,
        geometryVersion: 2,
        remoteRevision: 5,
        pendingKind: null,
      },
    ]);
    legacy.close();

    database = new AppDatabase(services.logger);

    await expect(database.listTrackFolders()).resolves.toEqual([
      expect.objectContaining({
        id: IMPORTS_FOLDER_ID,
        name: 'Imports',
        iconKey: 'folder',
        position: 0,
      }),
    ]);
    await expect(database.listLocalTracks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: imported.id, folderId: IMPORTS_FOLDER_ID }),
        expect.objectContaining({ id: 'local:route', folderId: null }),
      ]),
    );
    // Remote records without folderId resolve to the same placement, so the
    // upgrade must not queue stale metadata uploads for synchronized tracks.
    await expect(database.trackSyncStates.get(imported.id)).resolves.toEqual(
      expect.objectContaining({ pendingKind: null }),
    );
    await expect(database.trackSyncStates.get('local:route')).resolves.toEqual(
      expect.objectContaining({ pendingKind: null }),
    );
  });

  it('stores walking-time estimates for version 10 tracks without recorded time', async () => {
    database.close();
    await database.delete();

    const legacy = new Dexie('GeorgiaRoutingPlanner');
    legacy.version(10).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
      trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
      savedMarkers: 'id,normalizedName,colorKey,createdAt',
      markerSyncStates: 'markerId,remoteRevision,pendingKind',
      trackFolders: 'id,normalizedName,position',
      folderSyncStates: 'folderId,remoteRevision,pendingKind',
      localTrackThumbnails: 'trackId',
    });
    const untimed = localTrackSummary();
    const climbing: LocalTrackSummary = {
      ...untimed,
      metrics: { ...untimed.metrics, ascentMeters: 900, descentMeters: 500 },
      calculatedMetrics: {
        ...untimed.metrics,
        distanceMeters: 12_000,
        ascentMeters: 300,
        descentMeters: 0,
        elevationAlgorithmVersion: 4,
      },
    };
    const timed: LocalTrackSummary = {
      ...climbing,
      id: 'local:timed',
      metrics: { ...climbing.metrics, elapsedSeconds: 3_600 },
    };
    await legacy.table('localTracks').bulkPut([climbing, timed]);
    legacy.close();

    database = new AppDatabase(services.logger);

    // 1 km = 0.25 h; 900 m up + 500 m down = 4 h; 4 h + 0.25 h / 2.
    await expect(database.localTracks.get(climbing.id)).resolves.toMatchObject({
      metrics: { estimatedSeconds: 4.125 * 3_600 },
      calculatedMetrics: { estimatedSeconds: 3.5 * 3_600 },
    });
    const timedRow = await database.localTracks.get('local:timed');
    expect(timedRow?.metrics.estimatedSeconds).toBeUndefined();
    expect(timedRow?.calculatedMetrics?.estimatedSeconds).toBe(3.5 * 3_600);
  });

  it('keeps collapsed folders locally and discards an unreadable list', async () => {
    await database.saveCollapsedTrackFolderIds([IMPORTS_FOLDER_ID, 'folder:trips']);
    await expect(database.loadCollapsedTrackFolderIds()).resolves.toEqual([
      IMPORTS_FOLDER_ID,
      'folder:trips',
    ]);
    await expect(
      database.saveCollapsedTrackFolderIds([IMPORTS_FOLDER_ID, IMPORTS_FOLDER_ID]),
    ).rejects.toMatchObject({ code: 'record-invalid' });

    await database.settings.put({
      key: 'track-folders.collapsed',
      value: 'imports',
      updatedAt: '2026-09-29T00:00:00.000Z',
    });

    await expect(database.loadCollapsedTrackFolderIds()).resolves.toEqual([]);
    await expect(
      database.settings.get('track-folders.collapsed'),
    ).resolves.toBeUndefined();
  });

  it('creates empty folders at the end of the persisted order', async () => {
    const folder = trackFolder('folder:one', 'Weekend');
    const created = await database.createTrackFolder({
      schemaVersion: folder.schemaVersion,
      id: folder.id,
      name: folder.name,
      normalizedName: folder.normalizedName,
      iconKey: folder.iconKey,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    });

    expect(created.position).toBe(1);
    await expect(database.listTrackFolders()).resolves.toEqual([
      expect.objectContaining({ id: IMPORTS_FOLDER_ID, position: 0 }),
      expect.objectContaining({ id: folder.id, position: 1 }),
    ]);
    await expect(database.listLocalTracks()).resolves.toEqual([]);
  });

  it('rejects incomplete and duplicate folder orders and queues one complete order', async () => {
    const first = trackFolder('folder:first', 'First');
    const second = trackFolder('folder:second', 'Second');
    await database.createTrackFolder({
      schemaVersion: first.schemaVersion,
      id: first.id,
      name: first.name,
      normalizedName: first.normalizedName,
      iconKey: first.iconKey,
      createdAt: first.createdAt,
      updatedAt: first.updatedAt,
    });
    await database.createTrackFolder({
      schemaVersion: second.schemaVersion,
      id: second.id,
      name: second.name,
      normalizedName: second.normalizedName,
      iconKey: second.iconKey,
      createdAt: second.createdAt,
      updatedAt: second.updatedAt,
    });

    await expect(
      database.reorderTrackFolders([IMPORTS_FOLDER_ID, first.id]),
    ).rejects.toMatchObject({ code: 'record-invalid' });
    await expect(
      database.reorderTrackFolders([first.id, first.id, IMPORTS_FOLDER_ID]),
    ).rejects.toMatchObject({ code: 'record-invalid' });

    await expect(database.readPendingFolderOrder()).resolves.toBeNull();
    await database.reorderTrackFolders([second.id, IMPORTS_FOLDER_ID, first.id]);
    await expect(database.listTrackFolders()).resolves.toEqual([
      expect.objectContaining({ id: second.id, position: 0 }),
      expect.objectContaining({ id: IMPORTS_FOLDER_ID, position: 1 }),
      expect.objectContaining({ id: first.id, position: 2 }),
    ]);
    await database.reorderTrackFolders([first.id, second.id, IMPORTS_FOLDER_ID]);
    await expect(database.readPendingFolderOrder()).resolves.toEqual({
      version: 2,
      folderIds: [first.id, second.id, IMPORTS_FOLDER_ID],
    });
    await expect(database.folderSyncStates.get(first.id)).resolves.toMatchObject({
      localVersion: 1,
    });
  });

  it('keeps a newer local order until its own synchronization', async () => {
    const other = trackFolder('folder:other', 'Other');
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-a',
      updatedAt: '2026-09-28T00:00:00.000Z',
    });
    await database.createTrackFolder({
      schemaVersion: other.schemaVersion,
      id: other.id,
      name: other.name,
      normalizedName: other.normalizedName,
      iconKey: other.iconKey,
      createdAt: other.createdAt,
      updatedAt: other.updatedAt,
    });
    const state = {
      folderId: other.id,
      remoteRevision: 3,
      pendingKind: null,
      localVersion: 2,
    } as const;
    await database.folderSyncStates.put(state);
    await database.reorderTrackFolders([other.id, IMPORTS_FOLDER_ID]);
    const remote = {
      ...other,
      name: 'Renamed',
      normalizedName: 'renamed',
      position: 1,
    };
    const merge = (acknowledgedOrderVersion: number | null) =>
      database.applyRemoteFolderMergeBatch({
        put: [remote],
        deleteFolderIds: [],
        states: [{ ...state, remoteRevision: 4 }],
        deleteStateIds: [],
        expected: [{ folderId: other.id, state }],
        expectedUserId: 'user-a',
        acknowledgedOrderVersion,
      });

    await merge(null);

    await expect(database.trackFolders.get(other.id)).resolves.toMatchObject({
      name: 'Renamed',
      position: 0,
    });
    await expect(database.readPendingFolderOrder()).resolves.toMatchObject({
      version: 1,
    });

    await database.folderSyncStates.put(state);
    await merge(1);

    await expect(database.trackFolders.get(other.id)).resolves.toMatchObject({
      position: 1,
    });
    await expect(database.readPendingFolderOrder()).resolves.toBeNull();
  });

  it('never stores a folder change dated before the folder was created', async () => {
    await database.trackFolders.update(IMPORTS_FOLDER_ID, {
      createdAt: '2026-09-28T12:00:00.000Z',
      updatedAt: '2026-09-28T12:00:00.000Z',
    });

    const updated = await database.updateTrackFolder(IMPORTS_FOLDER_ID, {
      name: 'Inbox',
      normalizedName: 'inbox',
      iconKey: 'folder',
      updatedAt: '2026-09-28T11:59:00.000Z',
    });

    expect(updated.updatedAt).toBe('2026-09-28T12:00:00.000Z');
  });

  it('moves only track placement metadata and marks cloud metadata dirty', async () => {
    const summary = localTrackSummary();
    const content = localTrackContent();
    const destination = trackFolder('folder:destination', 'Destination');
    await database.saveLocalTrack(summary, content);
    await database.trackSyncStates.put({
      trackId: summary.id,
      contentHash: summary.contentHash ?? '',
      lineageHash: summary.contentHash ?? '',
      geometryVersion: 2,
      remoteRevision: 7,
      pendingKind: null,
    });
    await database.createTrackFolder({
      schemaVersion: destination.schemaVersion,
      id: destination.id,
      name: destination.name,
      normalizedName: destination.normalizedName,
      iconKey: destination.iconKey,
      createdAt: destination.createdAt,
      updatedAt: destination.updatedAt,
    });

    const moved = await database.moveLocalTrackToFolder(summary.id, destination.id);

    expect(moved).toMatchObject({
      id: summary.id,
      folderId: destination.id,
      contentHash: summary.contentHash,
    });
    await expect(database.loadLocalTrackContent(summary.id)).resolves.toEqual(content);
    await expect(database.trackSyncStates.get(summary.id)).resolves.toEqual(
      expect.objectContaining({
        contentHash: summary.contentHash,
        remoteRevision: 7,
        pendingKind: 'metadata',
      }),
    );
  });

  it('deletes populated folders without deleting tracks and keeps Imports', async () => {
    const summary = localTrackSummary();
    const content = localTrackContent();
    const removed = trackFolder('folder:removed', 'Removed');
    const retained = trackFolder('folder:retained', 'Retained');
    await database.saveLocalTrack(summary, content);
    for (const folder of [removed, retained]) {
      await database.createTrackFolder({
        schemaVersion: folder.schemaVersion,
        id: folder.id,
        name: folder.name,
        normalizedName: folder.normalizedName,
        iconKey: folder.iconKey,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      });
    }
    await database.moveLocalTrackToFolder(summary.id, removed.id);

    const affected = await database.deleteTrackFolder(removed.id);

    expect(affected).toEqual([
      expect.objectContaining({ id: summary.id, folderId: null }),
    ]);
    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: summary.id, folderId: null }),
    ]);
    await expect(database.loadLocalTrackContent(summary.id)).resolves.toEqual(content);
    await expect(database.listTrackFolders()).resolves.toEqual([
      expect.objectContaining({ id: IMPORTS_FOLDER_ID, position: 0 }),
      expect.objectContaining({ id: retained.id, position: 2 }),
    ]);
    await expect(database.deleteTrackFolder(IMPORTS_FOLDER_ID)).rejects.toMatchObject({
      code: 'record-invalid',
    });
  });

  it('applies remote folder deletion without deleting placed tracks', async () => {
    const summary = localTrackSummary();
    const content = localTrackContent();
    await database.saveLocalTrack(summary, content);
    await database.settings.put({
      key: 'sync.user-id',
      value: 'user-a',
      updatedAt: '2026-09-28T00:00:00.000Z',
    });
    const folderState = {
      folderId: IMPORTS_FOLDER_ID,
      remoteRevision: 4,
      pendingKind: null,
      localVersion: 2,
    } as const;
    await database.folderSyncStates.put(folderState);
    await database.trackSyncStates.put({
      trackId: summary.id,
      contentHash: summary.contentHash ?? '',
      lineageHash: summary.contentHash ?? '',
      geometryVersion: 2,
      remoteRevision: 5,
      pendingKind: null,
    });

    await expect(
      database.applyRemoteFolderMergeBatch({
        put: [],
        deleteFolderIds: [IMPORTS_FOLDER_ID],
        states: [],
        deleteStateIds: [IMPORTS_FOLDER_ID],
        expected: [{ folderId: IMPORTS_FOLDER_ID, state: folderState }],
        expectedUserId: 'user-a',
        acknowledgedOrderVersion: null,
      }),
    ).resolves.toEqual({ changed: true, tracksChanged: true });

    await expect(database.listTrackFolders()).resolves.toEqual([]);
    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: summary.id, folderId: null }),
    ]);
    await expect(database.loadLocalTrackContent(summary.id)).resolves.toEqual(content);
    await expect(database.trackSyncStates.get(summary.id)).resolves.toMatchObject({
      pendingKind: null,
    });
  });

  it('recreates a removed Imports folder at the end before a later file import', async () => {
    const additional = trackFolder('folder:kept', 'Kept');
    await database.createTrackFolder({
      schemaVersion: additional.schemaVersion,
      id: additional.id,
      name: additional.name,
      normalizedName: additional.normalizedName,
      iconKey: additional.iconKey,
      createdAt: additional.createdAt,
      updatedAt: additional.updatedAt,
    });
    await database.trackFolders.delete(IMPORTS_FOLDER_ID);

    const recreated = await database.ensureImportsFolder();
    const summary = localTrackSummary();
    await database.saveLocalTrack(summary, localTrackContent());

    expect(recreated).toMatchObject({
      id: IMPORTS_FOLDER_ID,
      name: 'Imports',
      iconKey: 'folder',
      position: 2,
    });
    await expect(database.listTrackFolders()).resolves.toEqual([
      expect.objectContaining({ id: additional.id, position: 1 }),
      expect.objectContaining({ id: IMPORTS_FOLDER_ID, position: 2 }),
    ]);
    await expect(database.listLocalTracks()).resolves.toEqual([
      expect.objectContaining({ id: summary.id, folderId: IMPORTS_FOLDER_ID }),
    ]);
  });
});
