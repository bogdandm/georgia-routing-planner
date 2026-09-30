import type { MapCoordinate } from '@/presentation/map/mapTypes';

function coordinateWithHemisphere(
  value: number,
  positiveHemisphere: 'N' | 'E',
  negativeHemisphere: 'S' | 'W',
): string {
  return `${Math.abs(value).toString()}${value >= 0 ? positiveHemisphere : negativeHemisphere}`;
}

export function meteoblueForecastUrl(coordinate: MapCoordinate): string {
  const latitude = coordinateWithHemisphere(coordinate.latitude, 'N', 'S');
  const longitude = coordinateWithHemisphere(coordinate.longitude, 'E', 'W');
  return `https://www.meteoblue.com/en/weather/week/${latitude}${longitude}`;
}

export function windyForecastUrl(coordinate: MapCoordinate): string {
  return `https://www.windy.com/${coordinate.latitude.toString()}/${coordinate.longitude.toString()}`;
}
