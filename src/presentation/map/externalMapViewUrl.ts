import type { MapCamera, MapCoordinate } from '@/presentation/map/mapTypes';

/**
 * External 2D view URLs: MapLibre's 512 px world needs +1 on the providers' 256 px
 * zoom scale. Their documented URLs accept integer zooms only. Google map views
 * cannot include a pin; Yandex can keep the clicked point without recentering.
 */
export function externalMapViewUrl(
  action: 'open-google-maps' | 'open-yandex-maps',
  camera: MapCamera,
  point: MapCoordinate | null,
): string {
  const google = action === 'open-google-maps';
  const zoom = String(
    Math.max(google ? 0 : 1, Math.min(google ? 21 : 19, Math.round(camera.zoom + 1))),
  );
  const latitude = String(camera.latitude);
  const longitude = String(camera.longitude);
  const url = new URL(
    google ? 'https://www.google.com/maps/@' : 'https://yandex.com/maps/',
  );
  if (google) {
    url.searchParams.set('api', '1');
    url.searchParams.set('map_action', 'map');
    url.searchParams.set('center', `${latitude},${longitude}`);
    url.searchParams.set('zoom', zoom);
  } else {
    url.searchParams.set('ll', `${longitude},${latitude}`);
    url.searchParams.set('z', zoom);
    url.searchParams.set('l', 'map');
    if (point !== null) {
      url.searchParams.set(
        'pt',
        `${String(point.longitude)},${String(point.latitude)}`,
      );
    }
  }
  return url.toString();
}
