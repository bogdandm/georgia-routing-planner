import type { MapSharePreferences } from '@/application/map/MapSharePreferences';
import { satelliteSceneKey } from '@/domain/satellite/SatelliteScene';
import type { MapLayerState } from '@/presentation/map/mapLayerStore';
import type {
  MapCamera,
  MapCoordinate,
  MapDiagnosticsSnapshot,
  MapLayerPreset,
  TerrainMode,
} from '@/presentation/map/mapTypes';
import { parseTrackShareLocation } from '@/presentation/tracks/trackShareUrl';

const mapShareSchemaVersion = 2;

const coordinatePrecision = 5;
const zoomPrecision = 2;
const sceneKeyPattern = /^[a-z0-9._-]{1,100}:[a-z0-9._-]{1,300}$/iu;
const weatherTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/u;

/** Static satellite basemaps a link may select; Sentinel imagery travels as `scene`. */
export const satelliteBasemaps = [
  'google-satellite',
  'bing-satellite',
  'esri-satellite',
  'napr-orthophoto',
  'soviet-topographic',
] as const satisfies readonly MapLayerPreset[];

export type SatelliteBasemap = (typeof satelliteBasemaps)[number];

export type MapShareOrientation =
  | { readonly mode: '2d' }
  | { readonly mode: '3d'; readonly bearing: number; readonly pitch: number };

/** Everything a map link encodes; the page query and tab hash are kept as they are. */
export interface MapShareView {
  readonly center: MapCoordinate;
  readonly zoom: number;
  readonly orientation: MapShareOrientation;
  readonly basemap: SatelliteBasemap | null;
  readonly sceneKey: string | null;
}

/** What the map currently shows that a link can reproduce, before share preferences. */
export interface ShareableMapState {
  readonly camera: MapCamera;
  readonly terrainMode: TerrainMode;
  readonly basemap: SatelliteBasemap | null;
  readonly sceneKey: string | null;
}

export interface WeatherMapUrlState {
  readonly coordinate: MapCoordinate | null;
  readonly validTime: string | null;
}

function finiteInRange(value: string | null, minimum: number, maximum: number) {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}
function validWeatherTime(value: string | null): string | null {
  if (
    value === null ||
    value.length > 40 ||
    !weatherTimePattern.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  return value;
}

/**
 * Reads the current v2 contract plus v1 and the original unversioned shape. Unknown
 * future versions fail closed so local camera persistence still wins.
 */
export function parseSharedMapView(search: string): MapShareView | null {
  const parameters = new URLSearchParams(search);
  const version = parameters.get('map');
  if (
    version !== null &&
    version !== '1' &&
    version !== String(mapShareSchemaVersion)
  ) {
    return null;
  }

  const latitude = finiteInRange(parameters.get('lat'), -90, 90);
  const longitude = finiteInRange(parameters.get('lon'), -180, 180);
  const zoom = finiteInRange(parameters.get('z') ?? parameters.get('zoom'), 0, 22);
  if (latitude === null || longitude === null || zoom === null) return null;

  const candidateScene = parameters.get('scene');
  const sceneKey =
    candidateScene !== null && sceneKeyPattern.test(candidateScene)
      ? candidateScene
      : null;
  const candidateBasemap = parameters.get('base');
  const basemap = satelliteBasemaps.find((id) => id === candidateBasemap) ?? null;
  const mode =
    version === String(mapShareSchemaVersion) ? parameters.get('view') : null;
  const bearing = finiteInRange(parameters.get('bearing'), -180, 180);
  const pitch = finiteInRange(parameters.get('pitch'), 0, 85);
  const orientation =
    mode === '3d' && bearing !== null && pitch !== null
      ? ({ mode: '3d', bearing, pitch } as const)
      : ({ mode: '2d' } as const);
  return { center: { longitude, latitude }, zoom, orientation, basemap, sceneKey };
}

export function applySharedMapView(
  camera: MapCamera,
  shared: MapShareView | null,
): MapCamera {
  if (shared === null) return camera;
  return {
    longitude: shared.center.longitude,
    latitude: shared.center.latitude,
    zoom: shared.zoom,
    bearing: shared.orientation.mode === '3d' ? shared.orientation.bearing : 0,
    pitch: shared.orientation.mode === '3d' ? shared.orientation.pitch : 0,
  };
}

/**
 * Reads the shareable content of the current map. Static basemaps and Sentinel imagery
 * are mutually exclusive on the map, and a selected scene hidden from view is not shared.
 */
export function readShareableMapState(
  snapshot: Pick<MapDiagnosticsSnapshot, 'camera' | 'terrainMode'>,
  layers: Pick<MapLayerState, 'visibility' | 'selectedScene'>,
): ShareableMapState {
  const basemap = satelliteBasemaps.find((id) => layers.visibility[id]) ?? null;
  const sceneKey =
    basemap === null &&
    layers.visibility['satellite-imagery'] &&
    layers.selectedScene !== null
      ? satelliteSceneKey(layers.selectedScene)
      : null;
  return {
    camera: snapshot.camera,
    terrainMode: snapshot.terrainMode,
    basemap,
    sceneKey,
  };
}

/**
 * Applies the user's share preferences to the current map. A non-null `center` (a
 * right-clicked point) replaces the camera center and keeps the zoom and orientation.
 */
export function selectMapShareView(
  state: ShareableMapState,
  preferences: MapSharePreferences,
  center: MapCoordinate | null,
): MapShareView {
  const orientation: MapShareOrientation =
    state.terrainMode === 'terrain' && preferences.include3dCamera
      ? { mode: '3d', bearing: state.camera.bearing, pitch: state.camera.pitch }
      : { mode: '2d' };
  return {
    center: center ?? {
      longitude: state.camera.longitude,
      latitude: state.camera.latitude,
    },
    zoom: state.camera.zoom,
    orientation,
    basemap: preferences.includeSatelliteLayer ? state.basemap : null,
    sceneKey: preferences.includeSentinelImage ? state.sceneKey : null,
  };
}

export function parseWeatherMapUrlState(search: string): WeatherMapUrlState | null {
  const parameters = new URLSearchParams(search);
  if (parameters.get('weather') !== '1') return null;
  const latitude = finiteInRange(parameters.get('weatherLat'), -90, 90);
  const longitude = finiteInRange(parameters.get('weatherLon'), -180, 180);
  return {
    coordinate:
      latitude === null || longitude === null ? null : { longitude, latitude },
    validTime: validWeatherTime(parameters.get('weatherTime')),
  };
}

export function updateWeatherMapUrl(
  currentUrl: string,
  state: WeatherMapUrlState | null,
): string {
  const url = new URL(currentUrl);
  if (state === null) {
    url.searchParams.delete('weather');
    url.searchParams.delete('weatherLat');
    url.searchParams.delete('weatherLon');
    url.searchParams.delete('weatherTime');
    return url.toString();
  }
  url.searchParams.set('weather', '1');
  if (state.coordinate === null) {
    url.searchParams.delete('weatherLat');
    url.searchParams.delete('weatherLon');
  } else {
    url.searchParams.set(
      'weatherLat',
      state.coordinate.latitude.toFixed(coordinatePrecision),
    );
    url.searchParams.set(
      'weatherLon',
      state.coordinate.longitude.toFixed(coordinatePrecision),
    );
  }
  if (state.validTime === null) {
    url.searchParams.delete('weatherTime');
  } else {
    url.searchParams.set('weatherTime', state.validTime);
  }
  return url.toString();
}

/**
 * Creates a share URL only when called from an explicit user action. Other query
 * parameters and the workspace-tab hash are kept; a shared scene opens Satellite. An
 * open shared-track capability is reduced to `#tracks`: a map link never shares a track.
 */
export function createMapShareUrl(currentUrl: string, view: MapShareView): string {
  const url = new URL(currentUrl);
  if (parseTrackShareLocation(url.hash).kind !== 'none') url.hash = '#tracks';
  url.searchParams.set('map', String(mapShareSchemaVersion));
  url.searchParams.set('lat', view.center.latitude.toFixed(coordinatePrecision));
  url.searchParams.set('lon', view.center.longitude.toFixed(coordinatePrecision));
  url.searchParams.set('z', view.zoom.toFixed(zoomPrecision));
  url.searchParams.delete('zoom');
  url.searchParams.set('view', view.orientation.mode);
  if (view.orientation.mode === '3d') {
    url.searchParams.set('bearing', view.orientation.bearing.toFixed(zoomPrecision));
    url.searchParams.set('pitch', view.orientation.pitch.toFixed(zoomPrecision));
  } else {
    url.searchParams.delete('bearing');
    url.searchParams.delete('pitch');
  }
  if (view.basemap === null) {
    url.searchParams.delete('base');
  } else {
    url.searchParams.set('base', view.basemap);
  }
  if (view.sceneKey !== null && sceneKeyPattern.test(view.sceneKey)) {
    url.searchParams.set('scene', view.sceneKey);
    url.hash = '#satellite';
  } else {
    url.searchParams.delete('scene');
  }
  return url.toString();
}
