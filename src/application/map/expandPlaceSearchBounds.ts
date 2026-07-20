import type { PlaceSearchBounds } from '@/application/ports/PlaceSearchGateway';

export const maximumPlaceSearchRadiusKm = 500;
export const maximumPlaceSearchSideKm = maximumPlaceSearchRadiusKm * 2;

// Geodesic calculations cannot represent the scaled cap exactly at every latitude.
// Treat sub-metre differences as the cap so expansion always terminates.
const maximumSideToleranceKm = 0.001;
const minimumExpansionKm = 0.000_001;

const earthRadiusKm = 6_371.0088;
const degreesToRadians = Math.PI / 180;

export function geodesicDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const latitudeDelta = (latitudeB - latitudeA) * degreesToRadians;
  const longitudeDelta = (longitudeB - longitudeA) * degreesToRadians;
  const latitudeARadians = latitudeA * degreesToRadians;
  const latitudeBRadians = latitudeB * degreesToRadians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function largerPlaceSearchSideKm(bounds: PlaceSearchBounds): number {
  const centerLatitude = (bounds.south + bounds.north) / 2;
  const width = geodesicDistanceKm(
    centerLatitude,
    bounds.west,
    centerLatitude,
    bounds.east,
  );
  const centerLongitude = (bounds.west + bounds.east) / 2;
  const height = geodesicDistanceKm(
    bounds.south,
    centerLongitude,
    bounds.north,
    centerLongitude,
  );
  return Math.max(width, height);
}

function scaleBounds(bounds: PlaceSearchBounds, scale: number): PlaceSearchBounds {
  const centerLongitude = (bounds.west + bounds.east) / 2;
  const centerLatitude = (bounds.south + bounds.north) / 2;
  const longitudeHalfSpan = ((bounds.east - bounds.west) / 2) * scale;
  const latitudeHalfSpan = ((bounds.north - bounds.south) / 2) * scale;
  return {
    west: Math.max(-180, centerLongitude - longitudeHalfSpan),
    south: Math.max(-90, centerLatitude - latitudeHalfSpan),
    east: Math.min(180, centerLongitude + longitudeHalfSpan),
    north: Math.min(90, centerLatitude + latitudeHalfSpan),
  };
}

export function limitPlaceSearchBounds(bounds: PlaceSearchBounds): PlaceSearchBounds {
  const largerSideKm = largerPlaceSearchSideKm(bounds);
  if (largerSideKm <= maximumPlaceSearchSideKm) return bounds;
  return scaleBounds(bounds, maximumPlaceSearchSideKm / largerSideKm);
}

/** Doubles a viewport-centred search area without exceeding its 500 km radius cap. */
export function expandPlaceSearchBounds(
  bounds: PlaceSearchBounds,
): PlaceSearchBounds | null {
  const currentLargerSideKm = largerPlaceSearchSideKm(bounds);
  if (
    !Number.isFinite(currentLargerSideKm) ||
    currentLargerSideKm <= 0 ||
    currentLargerSideKm >= maximumPlaceSearchSideKm - maximumSideToleranceKm
  ) {
    return null;
  }

  const scale = Math.min(2, maximumPlaceSearchSideKm / currentLargerSideKm);
  const expandedBounds = scaleBounds(bounds, scale);
  if (
    largerPlaceSearchSideKm(expandedBounds) <=
    currentLargerSideKm + minimumExpansionKm
  ) {
    return null;
  }
  return expandedBounds;
}
