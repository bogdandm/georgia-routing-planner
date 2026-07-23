import {
  GPX_PARSER_VERSION,
  GpxParseError,
  type ParsedGpx,
  type TrackPoint,
  type TrackSegment,
} from '@/domain/tracks/gpx';

const maximumBytes = 10 * 1024 * 1024;
const maximumPoints = 100_000;
const maximumSegments = 512;

function text(element: Element | null): string | undefined {
  const value = element?.textContent.trim();
  return value === undefined || value.length === 0 ? undefined : value.slice(0, 10_000);
}

function coordinatePoint(value: string): TrackPoint | null {
  const fields = value.trim().split(',');
  const longitude = Number(fields[0]);
  const latitude = Number(fields[1]);
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  const point: { coordinate: readonly [number, number]; elevationMeters?: number } = {
    coordinate: [longitude, latitude],
  };
  const altitude = Number(fields[2]);
  if (Number.isFinite(altitude)) point.elevationMeters = altitude;
  return point;
}

function lineStringSegments(document: Document): TrackSegment[] {
  return Array.from(document.getElementsByTagNameNS('*', 'LineString')).flatMap(
    (lineString) => {
      const altitudeMode = text(
        lineString.getElementsByTagNameNS('*', 'altitudeMode')[0] ?? null,
      );
      const useAltitude = altitudeMode === undefined || altitudeMode === 'absolute';
      const coordinates = text(
        lineString.getElementsByTagNameNS('*', 'coordinates')[0] ?? null,
      );
      if (coordinates === undefined) return [];
      const points = coordinates
        .split(/\s+/u)
        .map(coordinatePoint)
        .filter((point): point is TrackPoint => point !== null)
        .map((point) =>
          useAltitude ? point : ({ coordinate: point.coordinate } satisfies TrackPoint),
        );
      return points.length >= 2 ? [{ points }] : [];
    },
  );
}

function gxTrackSegments(document: Document): TrackSegment[] {
  return Array.from(document.getElementsByTagNameNS('*', 'Track')).flatMap((track) => {
    const coordinateElements = Array.from(track.getElementsByTagNameNS('*', 'coord'));
    const times = Array.from(track.getElementsByTagNameNS('*', 'when')).map(
      (element) => {
        const milliseconds = Date.parse(element.textContent.trim());
        return Number.isFinite(milliseconds)
          ? new Date(milliseconds).toISOString()
          : undefined;
      },
    );
    const points = coordinateElements.flatMap((element, index) => {
      const fields = element.textContent.trim().split(/\s+/u);
      const point = coordinatePoint(fields.join(','));
      if (point === null) return [];
      const recordedAt =
        times.length === coordinateElements.length ? times[index] : undefined;
      return [
        recordedAt === undefined ? point : { ...point, recordedAt },
      ] satisfies TrackPoint[];
    });
    return points.length >= 2 ? [{ points }] : [];
  });
}

/** Parses bounded line-based KML without resolving any external resource. */
export function parseKml(xml: string): ParsedGpx {
  if (new TextEncoder().encode(xml).byteLength > maximumBytes) {
    throw new GpxParseError(
      'file-too-large',
      'KML file is larger than the import limit.',
    );
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new GpxParseError(
      'unsafe-xml',
      'DTD and entity declarations are not supported.',
    );
  }
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror') !== null) {
    throw new GpxParseError('invalid-xml', 'The file is not valid XML.');
  }
  if (document.documentElement.localName !== 'kml') {
    throw new GpxParseError('invalid-xml', 'The file does not contain a KML document.');
  }
  const segments = [...lineStringSegments(document), ...gxTrackSegments(document)];
  const pointCount = segments.reduce(
    (total, segment) => total + segment.points.length,
    0,
  );
  if (segments.length === 0) {
    throw new GpxParseError(
      'empty-geometry',
      'The KML file has no renderable line or track geometry.',
    );
  }
  if (segments.length > maximumSegments || pointCount > maximumPoints) {
    throw new GpxParseError('limit-exceeded', 'KML contains too much track geometry.');
  }
  const documentElement =
    document.getElementsByTagNameNS('*', 'Document')[0] ?? document.documentElement;
  const placemark = document.getElementsByTagNameNS('*', 'Placemark')[0];
  const name =
    text(placemark?.getElementsByTagNameNS('*', 'name')[0] ?? null) ??
    text(documentElement.getElementsByTagNameNS('*', 'name')[0] ?? null);
  const description = text(
    placemark?.getElementsByTagNameNS('*', 'description')[0] ?? null,
  );
  return {
    parserVersion: GPX_PARSER_VERSION,
    geometryKind: 'track',
    segments,
    pointCount,
    metadata: {
      version: '1.1',
      links: [],
      ...(name === undefined ? {} : { selectedName: name }),
      ...(description === undefined
        ? {}
        : { selectedDescription: description.replace(/<[^>]*>/gu, '') }),
    },
    warnings: [],
  };
}
