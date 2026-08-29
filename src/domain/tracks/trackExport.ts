import { strToU8, zipSync } from 'fflate';

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

function gpxPoint(point: TrackPoint): string {
  const [longitude, latitude] = point.coordinate;
  return `<trkpt lat="${String(latitude)}" lon="${String(longitude)}">${point.elevationMeters === undefined ? '' : `<ele>${String(point.elevationMeters)}</ele>`}${point.recordedAt === undefined ? '' : `<time>${escapeXml(point.recordedAt)}</time>`}</trkpt>`;
}

function uniqueGpxFilename(name: string, usedNames: ReadonlySet<string>): string {
  const filename = safeTrackFilename(name, 'gpx');
  if (!usedNames.has(filename)) return filename;

  const stem = filename.slice(0, -'.gpx'.length);
  let suffix = 2;
  let candidate = `${stem} (${String(suffix)}).gpx`;
  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = `${stem} (${String(suffix)}).gpx`;
  }
  return candidate;
}

export function exportTrackAsGpx(
  summary: LocalTrackSummary,
  content: LocalTrackContent,
): string {
  const escapedName = escapeXml(summary.name);
  const documentStart = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Trail Planner" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapedName}</name></metadata>`;
  const segments = content.trackPoints
    .map(
      (segment) =>
        `<trkseg>${segment.map((point) => gpxPoint(point)).join('')}</trkseg>`,
    )
    .join('');
  return `${documentStart}<trk><name>${escapedName}</name>${segments}</trk></gpx>`;
}

export function exportTracksAsZip(
  tracks: readonly {
    readonly summary: LocalTrackSummary;
    readonly content: LocalTrackContent;
  }[],
): Uint8Array {
  const usedNames = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  for (const { summary, content } of tracks) {
    const filename = uniqueGpxFilename(summary.name, usedNames);
    usedNames.add(filename);
    entries[filename] = strToU8(exportTrackAsGpx(summary, content));
  }
  return zipSync(entries, { level: 6, mtime: new Date(1980, 0, 1) });
}

export function exportTrackAsKml(
  summary: LocalTrackSummary,
  content: LocalTrackContent,
): string {
  const geometries = content.trackPoints
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
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(summary.name)}</name><Placemark><name>${escapeXml(summary.name)}</name><MultiGeometry>${geometries}</MultiGeometry></Placemark></Document></kml>`;
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
