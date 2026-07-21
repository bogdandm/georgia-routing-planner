import type { MapCamera } from '@/presentation/map/mapTypes';

export const mapShareSchemaVersion = 2;

const coordinatePrecision = 5;
const zoomPrecision = 2;
const sceneKeyPattern = /^[a-z0-9._-]{1,100}:[a-z0-9._-]{1,300}$/iu;

export interface SharedMapView {
  readonly center: {
    readonly longitude: number;
    readonly latitude: number;
  };
  readonly zoom: number;
  readonly sceneKey: string | null;
  readonly orientation:
    | { readonly mode: '2d' }
    | { readonly mode: '3d'; readonly bearing: number; readonly pitch: number };
}

function finiteInRange(value: string | null, minimum: number, maximum: number) {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

/**
 * Reads the current v2 contract plus v1 and the original unversioned shape.
 * shape. Unknown future versions fail closed so local camera persistence still wins.
 */
export function parseSharedMapView(search: string): SharedMapView | null {
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
  const mode =
    version === String(mapShareSchemaVersion) ? parameters.get('view') : null;
  const bearing = finiteInRange(parameters.get('bearing'), -180, 180);
  const pitch = finiteInRange(parameters.get('pitch'), 0, 85);
  const orientation =
    mode === '3d' && bearing !== null && pitch !== null
      ? ({ mode: '3d', bearing, pitch } as const)
      : ({ mode: '2d' } as const);
  return { center: { longitude, latitude }, zoom, sceneKey, orientation };
}

export function applySharedMapView(
  camera: MapCamera,
  shared: SharedMapView | null,
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

/** Creates a share URL only when called from an explicit user action. */
export function createMapShareUrl(
  currentUrl: string,
  camera: Pick<MapCamera, 'longitude' | 'latitude' | 'zoom'>,
  sceneKey: string | null,
  orientation:
    | { readonly mode: '2d' }
    | {
        readonly mode: '3d';
        readonly bearing: number;
        readonly pitch: number;
      } = { mode: '2d' },
): string {
  const url = new URL(currentUrl);
  url.searchParams.set('map', String(mapShareSchemaVersion));
  url.searchParams.set('lat', camera.latitude.toFixed(coordinatePrecision));
  url.searchParams.set('lon', camera.longitude.toFixed(coordinatePrecision));
  url.searchParams.set('z', camera.zoom.toFixed(zoomPrecision));
  url.searchParams.delete('zoom');
  url.searchParams.set('view', orientation.mode);
  if (orientation.mode === '3d') {
    url.searchParams.set('bearing', orientation.bearing.toFixed(zoomPrecision));
    url.searchParams.set('pitch', orientation.pitch.toFixed(zoomPrecision));
  } else {
    url.searchParams.delete('bearing');
    url.searchParams.delete('pitch');
  }
  if (sceneKey !== null && sceneKeyPattern.test(sceneKey)) {
    url.searchParams.set('scene', sceneKey);
    url.hash = '#satellite';
  } else {
    url.searchParams.delete('scene');
  }
  return url.toString();
}
