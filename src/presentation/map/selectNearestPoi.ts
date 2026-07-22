import type { GeoJSONFeature } from 'maplibre-gl';

import type { MapCoordinate, NearbyPoi } from '@/presentation/map/mapTypes';

const earthRadiusMeters = 6_371_008.8;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function geodesicDistanceMeters(from: MapCoordinate, to: MapCoordinate): number {
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function safeProperty(
  properties: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = properties?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, 160)
    : null;
}

function toCandidate(
  feature: GeoJSONFeature,
  selected: MapCoordinate,
): (NearbyPoi & { readonly stableKey: string }) | null {
  if (feature.geometry.type !== 'Point') return null;
  const [longitude, latitude] = feature.geometry.coordinates;
  if (
    typeof longitude !== 'number' ||
    typeof latitude !== 'number' ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude)
  ) {
    return null;
  }
  const properties = feature.properties as Readonly<Record<string, unknown>> | null;
  const name =
    safeProperty(properties, 'name:en') ??
    safeProperty(properties, 'name:latin') ??
    safeProperty(properties, 'name_en') ??
    safeProperty(properties, 'name');
  if (name === null) return null;
  const category =
    safeProperty(properties, 'subclass') ??
    safeProperty(properties, 'class') ??
    'point of interest';
  return {
    name,
    category,
    distanceMeters: geodesicDistanceMeters(selected, { longitude, latitude }),
    stableKey: `${String(feature.id ?? '')}\u0000${name}\u0000${category}`,
  };
}

/** Chooses the nearest named loaded map feature with a stable identity tie-break. */
export function selectNearestPoi(
  features: readonly GeoJSONFeature[],
  selected: MapCoordinate,
): NearbyPoi | null {
  const nearest = features
    .map((feature) => toCandidate(feature, selected))
    .filter(
      (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
    )
    .sort(
      (left, right) =>
        left.distanceMeters - right.distanceMeters ||
        left.stableKey.localeCompare(right.stableKey, 'en'),
    )[0];
  if (nearest === undefined) return null;
  return {
    name: nearest.name,
    category: nearest.category,
    distanceMeters: nearest.distanceMeters,
  };
}
