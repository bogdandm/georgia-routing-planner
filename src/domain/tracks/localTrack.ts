import type {
  GpxMetadataProjection,
  GpxValidationWarning,
  TrackCoordinate,
  TrackPoint,
} from '@/domain/tracks/gpx';
import type { PoiCandidate, TrackMetrics } from '@/domain/tracks/trackCalculations';

export const LOCAL_TRACK_SCHEMA_VERSION = 1;

export interface LocalTrackSummary {
  readonly schemaVersion: typeof LOCAL_TRACK_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly savedAt: string;
  readonly sourceFilename: string;
  readonly sourceFormat: 'gpx' | 'fit' | 'kml';
  readonly description: string;
  readonly favorite: boolean;
  readonly elevationFilterMeters: number;
  readonly geometryKind: 'track' | 'route';
  readonly pointCount: number;
  readonly segmentCount: number;
  readonly metrics: TrackMetrics;
  readonly metadata: GpxMetadataProjection;
  readonly warnings: readonly GpxValidationWarning[];
  readonly generatedName?: string;
  readonly middleAnchorKind?: 'distance-midpoint' | 'dominant-summit';
  readonly startPoi?: PoiCandidate;
  readonly middlePoi?: PoiCandidate;
  readonly endPoi?: PoiCandidate;
  readonly fallbackPoi?: PoiCandidate;
}

export interface LocalTrackContent {
  readonly schemaVersion: typeof LOCAL_TRACK_SCHEMA_VERSION;
  readonly trackId: string;
  readonly trackPoints: readonly (readonly TrackPoint[])[];
  readonly reliefElevations?: readonly (readonly number[])[] | undefined;
  readonly elevationSource?: 'source' | 'relief';
}

export function localTrackPoints(
  content: LocalTrackContent,
): readonly (readonly TrackPoint[])[] {
  if (content.elevationSource !== 'relief' || content.reliefElevations === undefined) {
    return content.trackPoints;
  }
  return content.trackPoints.map((segment, segmentIndex) =>
    segment.map((point, pointIndex) => {
      const elevationMeters = content.reliefElevations?.[segmentIndex]?.[pointIndex];
      return elevationMeters === undefined ? point : { ...point, elevationMeters };
    }),
  );
}

export function localTrackSegments(
  content: LocalTrackContent,
): readonly (readonly TrackCoordinate[])[] {
  return content.trackPoints.map((segment) => segment.map((point) => point.coordinate));
}

export function normalizeLocalTrackName(name: string): {
  readonly name: string;
  readonly normalizedName: string;
} {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Track name is required.');
  if (trimmed.length > 200)
    throw new Error('Track name must be 200 characters or fewer.');
  return {
    name: trimmed,
    normalizedName: trimmed.toLocaleLowerCase('en'),
  };
}

export function normalizeLocalTrackDescription(description: string): string {
  if (description.length > 10_000) {
    throw new Error('Track description must be 10,000 characters or fewer.');
  }
  return description;
}
