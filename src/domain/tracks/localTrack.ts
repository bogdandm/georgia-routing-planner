import type {
  GpxMetadataProjection,
  GpxValidationWarning,
  TrackCoordinate,
  TrackPoint,
} from '@/domain/tracks/gpx';
import type { TrackMetrics } from '@/domain/tracks/trackCalculations';
import type {
  PoiCandidate,
  TrackNameLandmarkAnchor,
} from '@/domain/tracks/trackNaming';

export const LOCAL_TRACK_SCHEMA_VERSION = 6;
export const MAXIMUM_TRACK_MARKERS = 100;
export const MAXIMUM_TRACK_NAME_LENGTH = 200;

export const trackSorts = ['created', 'name', 'oldest', 'distance'] as const;

export type TrackSort = (typeof trackSorts)[number];

/** Whether a Komoot import asks to keep its elevations, or always keeps or replaces them. */
export const komootElevationPreferences = ['ask', 'keep', 'terrain'] as const;

export type KomootElevationPreference = (typeof komootElevationPreferences)[number];

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
  readonly middleAnchorKind?: TrackNameLandmarkAnchor;
  readonly startPoi?: PoiCandidate;
  /** Named landmark at the dominant summit or closed-track turnaround. */
  readonly middlePoi?: PoiCandidate;
  readonly endPoi?: PoiCandidate;
  /**
   * The track's Route timing adjustments; absent while they equal the defaults. They
   * synchronize with the track's metadata.
   */
  readonly routeTiming?: TrackRouteTiming;
}

/**
 * Route timeline adjustments for one track; they never change its recorded time. They
 * also decide whether and how the map labels the track with these times.
 */
export interface TrackRouteTiming {
  /** Fractional local hour of the day at which the hike starts. */
  readonly startHour: number;
  /** Multiplier of hiking time: above 1 is slower, below 1 faster. */
  readonly paceFactor: number;
  /** Times the route by the DIN 33466 estimate even when it has recorded time. */
  readonly ignoreRecordedTime: boolean;
  /** Clock times on the map line; null follows the Layers default. */
  readonly timeMarkers: boolean | null;
  /** Map times count from 00:00 at the start instead of the route start's clock time. */
  readonly relativeTimeMarkers: boolean;
  /**
   * Local `YYYY-MM-DD` of the hike for lighting; null uses the recording date, or today
   * for a planned route.
   */
  readonly hikeDate: string | null;
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
  if (trimmed.length > MAXIMUM_TRACK_NAME_LENGTH) throw new TrackNameError('too-long');
  return {
    name: trimmed,
    normalizedName: trimmed.toLocaleLowerCase('en'),
  };
}
