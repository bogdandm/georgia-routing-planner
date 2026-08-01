import { lineString, point } from '@turf/helpers';
import pointToLineDistance from '@turf/point-to-line-distance';
import type { Feature, Point } from 'geojson';
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

type FiniteCoordinate = [number, number, ...number[]];

function isFiniteCoordinate(value: unknown): value is FiniteCoordinate {
  if (!Array.isArray(value)) return false;
  const [longitude, latitude] = value;
  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    value.length >= 2 &&
    value.every(
      (coordinate) =>
        typeof coordinate === 'number' && Number.isFinite(coordinate),
    )
  );
}

function isFiniteLineCoordinates(
  coordinates: unknown,
): coordinates is FiniteCoordinate[] {
  return (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    coordinates.every(isFiniteCoordinate)
  );
}

function lineDistanceMeters(
  selectedPoint: Feature<Point>,
  coordinates: FiniteCoordinate[],
): number | null {
  try {
    const distance = pointToLineDistance(selectedPoint, lineString(coordinates), {
      units: 'meters',
    });
    return Number.isFinite(distance) ? distance : null;
  } catch {
    return null;
  }
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
  let distanceMeters: number | null;
  switch (feature.geometry.type) {
    case 'Point': {
      const coordinates = feature.geometry.coordinates;
      if (!isFiniteCoordinate(coordinates)) return null;
      const [longitude, latitude] = coordinates;
      distanceMeters = geodesicDistanceMeters(selected, { longitude, latitude });
      break;
    }
    case 'LineString':
      if (!isFiniteLineCoordinates(feature.geometry.coordinates)) return null;
      distanceMeters = lineDistanceMeters(
        point([selected.longitude, selected.latitude]),
        feature.geometry.coordinates,
      );
      break;
    case 'MultiLineString': {
      const lineCoordinates = feature.geometry.coordinates;
      if (!Array.isArray(lineCoordinates) || lineCoordinates.length === 0) return null;
      const selectedPoint = point([selected.longitude, selected.latitude]);
      let nearestDistanceMeters = Number.POSITIVE_INFINITY;
      for (const coordinates of lineCoordinates) {
        if (!isFiniteLineCoordinates(coordinates)) return null;
        const distance = lineDistanceMeters(selectedPoint, coordinates);
        if (distance === null) return null;
        nearestDistanceMeters = Math.min(nearestDistanceMeters, distance);
      }
      distanceMeters = Number.isFinite(nearestDistanceMeters)
        ? nearestDistanceMeters
        : null;
      break;
    }
    default:
      return null;
  }
  if (distanceMeters === null) return null;
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
    distanceMeters,
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
