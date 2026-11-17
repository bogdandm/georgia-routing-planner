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

/** CSS-pixel area at the current zoom that Wikiloc fits into its map pane. */
const wikilocViewport = { width: 640, height: 480 };

/**
 * Wikiloc's map URL accepts only a bounding box, which it fits into its pane. The box
 * covers `wikilocViewport` at the current MapLibre zoom and is symmetric around the
 * point in Web Mercator, so the fitted view is centered on the point.
 */
export function wikilocMapUrl(
  zoom: number,
  point: MapCoordinate,
  locale: string,
): string {
  const worldSize = 512 * 2 ** zoom;
  const halfLongitude = (wikilocViewport.width / 2 / worldSize) * 360;
  const halfMercatorY = (wikilocViewport.height / 2 / worldSize) * 2 * Math.PI;
  const mercatorY = Math.log(Math.tan(Math.PI / 4 + (point.latitude * Math.PI) / 360));
  const latitudeAt = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI;
  const south = latitudeAt(mercatorY - halfMercatorY);
  const north = latitudeAt(mercatorY + halfMercatorY);
  const west = point.longitude - halfLongitude;
  const east = point.longitude + halfLongitude;
  const url = new URL(
    `https://${locale === 'ru' ? 'ru' : 'www'}.wikiloc.com/wikiloc/map.do`,
  );
  url.searchParams.set('sw', `${String(south)},${String(west)}`);
  url.searchParams.set('ne', `${String(north)},${String(east)}`);
  url.searchParams.set('page', '1');
  return url.toString();
}
