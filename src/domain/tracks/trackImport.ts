import { parseFit } from '@/domain/tracks/fit';
import { parseGpx, type ParsedGpx } from '@/domain/tracks/gpx';
import { parseKml } from '@/domain/tracks/kml';

export type TrackSourceFormat = 'gpx' | 'fit' | 'kml';

export function trackSourceFormat(filename: string): TrackSourceFormat | null {
  const extension = filename.split('.').pop()?.toLocaleLowerCase('en');
  return extension === 'gpx' || extension === 'fit' || extension === 'kml'
    ? extension
    : null;
}

export async function parseTrackFile(
  file: File,
  format: TrackSourceFormat,
): Promise<ParsedGpx> {
  return format === 'fit'
    ? parseFit(await file.arrayBuffer())
    : format === 'kml'
      ? parseKml(await file.text())
      : parseGpx(await file.text());
}
