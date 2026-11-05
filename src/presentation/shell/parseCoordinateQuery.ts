import type { MapCoordinate } from '@/presentation/map/mapTypes';

type CoordinateQueryResult =
  | { readonly status: 'not-coordinate' }
  | { readonly status: 'valid'; readonly coordinate: MapCoordinate }
  | {
      readonly status: 'invalid';
      readonly code: 'out-of-bounds' | 'duplicate-axis' | 'non-finite';
    };

type ParsedHemisphereComponent =
  | {
      readonly status: 'valid';
      readonly axis: 'latitude' | 'longitude';
      readonly value: number;
    }
  | {
      readonly status: 'invalid';
      readonly code: 'out-of-bounds' | 'non-finite';
    };

const DMS_ANGLE = /^(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]$/u;
const DECIMAL_DEGREES_ANGLE = /^(\d+(?:\.\d+)?)\s*°$/u;
const HEMISPHERE_COMPONENT_PATTERN = String.raw`(?:(?:\d+\s*°\s*\d+\s*['′]\s*\d+(?:\.\d+)?\s*["″])|(?:\d+(?:\.\d+)?\s*°))\s*[NSEW]`;
const HEMISPHERE_PAIR = new RegExp(
  `^(${HEMISPHERE_COMPONENT_PATTERN})(?:\\s*[,;]\\s*|\\s+)(${HEMISPHERE_COMPONENT_PATTERN})$`,
  'iu',
);

function parseHemisphereComponent(component: string): ParsedHemisphereComponent {
  const hemisphere = component.at(-1)?.toUpperCase();
  const angle = component.slice(0, -1).trim();
  const dms = DMS_ANGLE.exec(angle);
  let value: number;

  if (dms === null) {
    const decimalDegrees = DECIMAL_DEGREES_ANGLE.exec(angle);
    value = Number(decimalDegrees?.[1]);
  } else {
    const degrees = Number(dms[1]);
    const minutes = Number(dms[2]);
    const seconds = Number(dms[3]);
    if (minutes >= 60 || seconds >= 60) {
      return { status: 'invalid', code: 'out-of-bounds' };
    }
    value = degrees + minutes / 60 + seconds / 3_600;
  }

  if (!Number.isFinite(value)) {
    return { status: 'invalid', code: 'non-finite' };
  }

  const axis = hemisphere === 'N' || hemisphere === 'S' ? 'latitude' : 'longitude';
  return {
    status: 'valid',
    axis,
    value: hemisphere === 'S' || hemisphere === 'W' ? -value : value,
  };
}

function coordinate(longitude: number, latitude: number): CoordinateQueryResult {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return { status: 'invalid', code: 'non-finite' };
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return { status: 'invalid', code: 'out-of-bounds' };
  }
  return { status: 'valid', coordinate: { longitude, latitude } };
}

export function parseCoordinateQuery(raw: string): CoordinateQueryResult {
  const query = raw.trim();
  const hemispherePair = HEMISPHERE_PAIR.exec(query);
  if (hemispherePair !== null) {
    const first = parseHemisphereComponent(hemispherePair[1] ?? '');
    const second = parseHemisphereComponent(hemispherePair[2] ?? '');
    if (first.status === 'invalid') return first;
    if (second.status === 'invalid') return second;
    if (first.axis === second.axis) {
      return { status: 'invalid', code: 'duplicate-axis' };
    }
    return first.axis === 'latitude'
      ? coordinate(second.value, first.value)
      : coordinate(first.value, second.value);
  }

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
