import { describe, expect, it } from 'vitest';

import { defaultMapSharePreferences } from '@/application/map/MapSharePreferences';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import {
  applySharedMapView,
  createMapShareUrl,
  parseSharedMapView,
  parseWeatherMapUrlState,
  readShareableMapState,
  selectMapShareView,
  updateWeatherMapUrl,
  type ShareableMapState,
} from '@/presentation/map/mapShareUrl';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';
import { syntheticSatelliteScene } from '@test/helpers/workspaceShellTestSupport';

const terrainCamera = {
  longitude: 44.8,
  latitude: 41.7,
  zoom: 12.35,
  bearing: 18.126,
  pitch: 35.556,
};

describe('mapShareUrl', () => {
  it('round-trips a 2D center, zoom, and safe scene identity', () => {
    const url = createMapShareUrl('https://example.test/app/?developer=1#layers', {
      center: { longitude: 44.801234, latitude: 41.712345 },
      zoom: 12.345,
      orientation: { mode: '2d' },
      basemap: null,
      sceneKey: 'sentinel-2-l2a:S2B_38TMM_20260720_0_L2A',
    });

    expect(url).toContain('developer=1');
    expect(url).toContain('map=2');
    expect(url).toContain('view=2d');
    expect(url).not.toContain('bearing=');
    expect(url).not.toContain('base=');
    expect(url).toContain('#satellite');
    expect(parseSharedMapView(new URL(url).search)).toEqual({
      center: { longitude: 44.80123, latitude: 41.71234 },
      zoom: 12.35,
      orientation: { mode: '2d' },
      basemap: null,
      sceneKey: 'sentinel-2-l2a:S2B_38TMM_20260720_0_L2A',
    });
  });

  it('round-trips a 3D camera and a satellite basemap while keeping the tab hash', () => {
    const url = createMapShareUrl(
      'https://example.test/app/?bearing=99&pitch=70&scene=old%3Ascene#tracks',
      {
        center: { longitude: 44.8, latitude: 41.7 },
        zoom: 12.35,
        orientation: { mode: '3d', bearing: 18.126, pitch: 35.556 },
        basemap: 'napr-orthophoto',
        sceneKey: null,
      },
    );

    expect(new URL(url).hash).toBe('#tracks');
    expect(parseSharedMapView(new URL(url).search)).toEqual({
      center: { longitude: 44.8, latitude: 41.7 },
      zoom: 12.35,
      orientation: { mode: '3d', bearing: 18.13, pitch: 35.56 },
      basemap: 'napr-orthophoto',
      sceneKey: null,
    });
  });

  it('supports legacy links and ignores unknown versions and basemaps', () => {
    expect(parseSharedMapView('?lat=42&lon=44&zoom=9&base=vector-osm')).toMatchObject({
      zoom: 9,
      orientation: { mode: '2d' },
      basemap: null,
    });
    expect(parseSharedMapView('?map=3&lat=42&lon=44&z=9')).toBeNull();
  });

  it('rejects invalid bounds and flattens ordinary shared cameras', () => {
    expect(parseSharedMapView('?map=1&lat=91&lon=44&z=9')).toBeNull();
    expect(
      applySharedMapView(defaultGeorgiaCamera, {
        center: { longitude: 44.8, latitude: 41.7 },
        zoom: 13,
        orientation: { mode: '2d' },
        basemap: null,
        sceneKey: null,
      }),
    ).toEqual({
      longitude: 44.8,
      latitude: 41.7,
      zoom: 13,
      bearing: 0,
      pitch: 0,
    });
  });

  it('shares only the imagery visible on the map', () => {
    const { visibility } = mapLayerStore.getState();
    const scene = syntheticSatelliteScene('visible-scene', '2026-07-20T10:12:00.000Z');
    const snapshot = { camera: terrainCamera, terrainMode: 'terrain' as const };

    expect(
      readShareableMapState(snapshot, { visibility, selectedScene: scene }),
    ).toMatchObject({ basemap: null, sceneKey: 'sentinel-2-l2a:visible-scene' });
    // A static basemap hides the still-selected scene, so only the basemap is shared.
    expect(
      readShareableMapState(snapshot, {
        visibility: { ...visibility, 'bing-satellite': true },
        selectedScene: scene,
      }),
    ).toMatchObject({ basemap: 'bing-satellite', sceneKey: null });
    expect(
      readShareableMapState(snapshot, {
        visibility: { ...visibility, 'satellite-imagery': false },
        selectedScene: scene,
      }),
    ).toMatchObject({ basemap: null, sceneKey: null });
  });

  it('drops each excluded part of the view and recenters on a clicked point', () => {
    const state: ShareableMapState = {
      camera: terrainCamera,
      terrainMode: 'terrain',
      basemap: 'google-satellite',
      sceneKey: 'sentinel-2-l2a:scene',
    };

    expect(selectMapShareView(state, defaultMapSharePreferences, null)).toEqual({
      center: { longitude: 44.8, latitude: 41.7 },
      zoom: 12.35,
      orientation: { mode: '3d', bearing: 18.126, pitch: 35.556 },
      basemap: 'google-satellite',
      sceneKey: 'sentinel-2-l2a:scene',
    });
    expect(
      selectMapShareView(
        state,
        {
          includeSatelliteLayer: false,
          includeSentinelImage: false,
          include3dCamera: false,
        },
        { longitude: 43.1, latitude: 42.2 },
      ),
    ).toEqual({
      center: { longitude: 43.1, latitude: 42.2 },
      zoom: 12.35,
      orientation: { mode: '2d' },
      basemap: null,
      sceneKey: null,
    });
    expect(
      selectMapShareView(
        { ...state, terrainMode: 'flat' },
        defaultMapSharePreferences,
        null,
      ).orientation,
    ).toEqual({ mode: '2d' });
  });

  it('round-trips enabled weather, its forecast point, and selected valid time', () => {
    const url = updateWeatherMapUrl('https://example.test/app/?developer=1#weather', {
      coordinate: { longitude: 44.801234, latitude: 41.712345 },
      validTime: '2026-09-25T12:00Z',
    });

    expect(url).toContain('developer=1');
    expect(url).toContain('weather=1');
    expect(url).toContain('weatherLat=41.71234');
    expect(url).toContain('weatherLon=44.80123');
    expect(url).toContain('weatherTime=2026-09-25T12%3A00Z');
    expect(parseWeatherMapUrlState(new URL(url).search)).toEqual({
      coordinate: { longitude: 44.80123, latitude: 41.71234 },
      validTime: '2026-09-25T12:00Z',
    });
  });

  it('keeps weather enabled without optional selection and removes its complete URL state', () => {
    expect(
      parseWeatherMapUrlState('?weather=1&weatherLat=91&weatherTime=invalid'),
    ).toEqual({
      coordinate: null,
      validTime: null,
    });
    expect(
      updateWeatherMapUrl(
        'https://example.test/app/?developer=1&weather=1&weatherLat=41&weatherLon=44&weatherTime=2026-09-25T12%3A00Z#weather',
        null,
      ),
    ).toBe('https://example.test/app/?developer=1#weather');
  });
});
