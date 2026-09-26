import type { MapCoordinate } from '@/presentation/map/mapTypes';

type CoordinateQueryResult =
  | { readonly status: 'not-coordinate' }
  | { readonly status: 'valid'; readonly coordinate: MapCoordinate }
  | {
      readonly status: 'invalid';
      readonly code: 'out-of-bounds' | 'duplicate-axis' | 'non-finite';
    };

function coordinate(longitude: number, latitude: number): CoordinateQueryResult {
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return { status: 'invalid', code: 'out-of-bounds' };
  }
  return { status: 'valid', coordinate: { longitude, latitude } };
}

export function parseCoordinateQuery(raw: string): CoordinateQueryResult {
  const query = raw.trim();
  const labelled =
    /^(lat(?:itude)?|lon(?:gitude)?|lng)\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*[,; ]+\s*(lat(?:itude)?|lon(?:gitude)?|lng)\s*[:=]\s*(-?\d+(?:\.\d+)?)$/iu.exec(
      query,
    );
  if (labelled !== null) {
    const firstLabel = labelled[1]?.toLowerCase();
    const secondLabel = labelled[3]?.toLowerCase();
    const first = Number(labelled[2]);
    const second = Number(labelled[4]);
    if (firstLabel?.startsWith('lat') === secondLabel?.startsWith('lat')) {
      return { status: 'invalid', code: 'duplicate-axis' };
    }
    return firstLabel?.startsWith('lat') === true
      ? coordinate(second, first)
      : coordinate(first, second);
  }

  const pair = /^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/u.exec(query);
  if (pair === null) return { status: 'not-coordinate' };
  const first = Number(pair[1]);
  const second = Number(pair[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return { status: 'invalid', code: 'non-finite' };
  }
  return coordinate(second, first);
}
