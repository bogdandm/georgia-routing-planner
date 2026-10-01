import type {
  GpxMetadataProjection,
  GpxValidationWarning,
  TrackCoordinate,
  TrackPoint,
} from '@/domain/tracks/gpx';
import type { PoiCandidate, TrackMetrics } from '@/domain/tracks/trackCalculations';

export const LOCAL_TRACK_SCHEMA_VERSION = 6;
export const MAXIMUM_TRACK_MARKERS = 32;

export const trackSorts = ['created', 'name', 'oldest', 'distance'] as const;

export type TrackSort = (typeof trackSorts)[number];

export interface LocalTrackSummary {
  readonly schemaVersion: typeof LOCAL_TRACK_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly savedAt: string;
  readonly updatedAt: string;
  /** Absent only on rows migrated from local schema v2 or earlier. */
  readonly contentHash?: string;
  readonly sourceFilename: string;
  readonly sourceFormat: 'gpx' | 'fit' | 'kml';
  readonly favorite: boolean;
  readonly geometryKind: 'track' | 'route';
  readonly folderId: string | null;
  readonly pointCount: number;
  readonly segmentCount: number;
  readonly metrics: TrackMetrics;
  readonly calculatedMetrics?: TrackMetrics;
  readonly metadata: GpxMetadataProjection;
  readonly warnings: readonly GpxValidationWarning[];
  readonly generatedName?: string;
  readonly middleAnchorKind?: 'distance-midpoint' | 'dominant-summit';
  readonly startPoi?: PoiCandidate;
  readonly middlePoi?: PoiCandidate;
  readonly endPoi?: PoiCandidate;
  readonly fallbackPoi?: PoiCandidate;
}
export interface TrackMarker {
  readonly id: string;
  readonly name: string;
  readonly coordinate: TrackCoordinate;
}

export interface LocalTrackContent {
  readonly schemaVersion: typeof LOCAL_TRACK_SCHEMA_VERSION;
  readonly trackId: string;
  readonly trackPoints: readonly (readonly TrackPoint[])[];
  readonly calculatedTrackPoints?: readonly (readonly TrackPoint[])[];
  readonly markers: readonly TrackMarker[];
}

export function localTrackSegments(
  content: LocalTrackContent,
): readonly (readonly TrackCoordinate[])[] {
  return content.trackPoints.map((segment) => segment.map((point) => point.coordinate));
}

export type TrackNameProblem = 'required' | 'too-long';

/** Rejected track name; `problem` lets the UI show a localized explanation. */
export class TrackNameError extends Error {
  public constructor(public readonly problem: TrackNameProblem) {
    super(
      problem === 'required'
        ? 'Track name is required.'
        : 'Track name must be 200 characters or fewer.',
    );
    this.name = 'TrackNameError';
  }
}

export function normalizeLocalTrackName(name: string): {
  readonly name: string;
  readonly normalizedName: string;
} {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new TrackNameError('required');
  if (trimmed.length > 200) throw new TrackNameError('too-long');
  return {
    name: trimmed,
    normalizedName: trimmed.toLocaleLowerCase('en'),
  };
}
