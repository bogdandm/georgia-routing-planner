import type { LocalTrackContent, LocalTrackSummary } from '@/domain/tracks/localTrack';
import type { TrackPoint } from '@/domain/tracks/gpx';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function storedPoints(content: LocalTrackContent): readonly (readonly TrackPoint[])[] {
  return (
    content.trackPoints ??
    content.segments.map((segment) => segment.map((coordinate) => ({ coordinate })))
  );
}

function gpxPoint(point: TrackPoint): string {
  const [longitude, latitude] = point.coordinate;
  return `<trkpt lat="${String(latitude)}" lon="${String(longitude)}">${point.elevationMeters === undefined ? '' : `<ele>${String(point.elevationMeters)}</ele>`}${point.recordedAt === undefined ? '' : `<time>${escapeXml(point.recordedAt)}</time>`}</trkpt>`;
}

export function exportTrackAsGpx(
  summary: LocalTrackSummary,
  content: LocalTrackContent,
): string {
  const segments = storedPoints(content)
    .map((segment) => `<trkseg>${segment.map(gpxPoint).join('')}</trkseg>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Georgia Routing Planner" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml(summary.name)}</name><desc>${escapeXml(summary.description)}</desc></metadata><trk><name>${escapeXml(summary.name)}</name><desc>${escapeXml(summary.description)}</desc>${segments}</trk></gpx>`;
}

export function exportTrackAsKml(
  summary: LocalTrackSummary,
  content: LocalTrackContent,
): string {
  const geometries = storedPoints(content)
    .map(
      (segment) =>
        `<LineString><altitudeMode>absolute</altitudeMode><coordinates>${segment
          .map(
            (point) =>
              `${String(point.coordinate[0])},${String(point.coordinate[1])},${String(point.elevationMeters ?? 0)}`,
          )
          .join(' ')}</coordinates></LineString>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(summary.name)}</name><Placemark><name>${escapeXml(summary.name)}</name><description>${escapeXml(summary.description)}</description><MultiGeometry>${geometries}</MultiGeometry></Placemark></Document></kml>`;
}

export function safeTrackFilename(name: string, extension: 'gpx' | 'kml'): string {
  const stem = Array.from(name)
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? '-'
        : character,
    )
    .join('')
    .replace(/[. ]+$/gu, '')
    .slice(0, 120);
  return `${stem.length === 0 ? 'track' : stem}.${extension}`;
}
