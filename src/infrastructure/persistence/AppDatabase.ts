import Dexie, { type EntityTable } from 'dexie';
import { z } from 'zod';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  SavedMarkerStorageError,
  type SavedMarkerRepository,
} from '@/application/ports/SavedMarkerRepository';
import {
  LocalTrackStorageError,
  type LocalTrackRepository,
} from '@/application/ports/LocalTrackRepository';
import {
  normalizeMapCamera,
  type MapCamera,
  type MapCameraRepository,
} from '@/application/ports/MapCameraRepository';
import type {
  MapLayerPreferencesRepository,
  PersistedMapLayerPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';
import {
  defaultSatelliteRenderingMode,
  defaultSatelliteRenderingTuning,
} from '@/application/ports/MapLayerPreferencesRepository';
import { defaultTerrainOverlayPreferences } from '@/application/ports/MapLayerPreferencesRepository';
import type {
  GpxLink,
  GpxMetadataProjection,
  GpxValidationWarning,
  TrackPoint,
} from '@/domain/tracks/gpx';
import {
  SAVED_MARKER_SCHEMA_VERSION,
  markerColorKeys,
  markerIconKeys,
  markerSorts,
  normalizeSavedMarkerName,
  type MarkerSort,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  normalizeLocalTrackName,
  trackSorts,
  type LocalTrackContent,
  type LocalTrackSummary,
  type TrackSort,
} from '@/domain/tracks/localTrack';
import type { PoiCandidate, TrackMetrics } from '@/domain/tracks/trackCalculations';

interface SettingRecord {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: string;
}

interface PersistedDiagnosticRecord {
  readonly id?: number;
  readonly timestamp: string;
  readonly name: string;
  readonly level: string;
}

export interface TrackSyncState {
  readonly trackId: string;
  readonly contentHash: string;
  readonly lineageHash: string;
  readonly geometryVersion: 1 | 2;
  readonly remoteRevision: number | null;
  readonly pendingKind: 'upsert' | 'metadata' | 'delete' | null;
}

function equalTrackSyncStates(left: TrackSyncState, right: TrackSyncState): boolean {
  return (
    left.trackId === right.trackId &&
    left.contentHash === right.contentHash &&
    left.lineageHash === right.lineageHash &&
    left.geometryVersion === right.geometryVersion &&
    left.remoteRevision === right.remoteRevision &&
    left.pendingKind === right.pendingKind
  );
}

export interface MarkerSyncState {
  readonly markerId: string;
  readonly remoteRevision: number | null;
  readonly pendingKind: 'upsert' | 'delete' | null;
  readonly localVersion: number;
}

const markerSyncStateSchema: z.ZodType<MarkerSyncState> = z
  .object({
    markerId: z.string().min(1).max(200),
    remoteRevision: z.number().int().positive().refine(Number.isSafeInteger).nullable(),
    pendingKind: z.enum(['upsert', 'delete']).nullable(),
    localVersion: z.number().int().positive().refine(Number.isSafeInteger),
  })
  .strict()
  .refine(
    (state) => state.pendingKind !== null || state.remoteRevision !== null,
    'Clean marker state requires a remote revision.',
  );

function equalMarkerSyncStates(
  left: MarkerSyncState | null,
  right: MarkerSyncState | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.markerId === right.markerId &&
      left.remoteRevision === right.remoteRevision &&
      left.pendingKind === right.pendingKind &&
      left.localVersion === right.localVersion)
  );
}

function nextMarkerLocalVersion(state: MarkerSyncState | null): number {
  if (state === null) return 1;
  if (
    !Number.isSafeInteger(state.localVersion) ||
    state.localVersion >= Number.MAX_SAFE_INTEGER
  ) {
    throw new SavedMarkerStorageError(
      'record-invalid',
      'The saved marker version is invalid.',
    );
  }
  return state.localVersion + 1;
}

export interface MarkerSyncEntry {
  readonly marker: SavedMarker | null;
  readonly state: MarkerSyncState;
}

export interface MarkerMergeExpectation {
  readonly markerId: string;
  readonly state: MarkerSyncState | null;
}
export interface RemoteMarkerMergeBatch {
  readonly put: readonly SavedMarker[];
  readonly deleteMarkerIds: readonly string[];
  readonly states: readonly MarkerSyncState[];
  readonly deleteStateIds: readonly string[];
  readonly expected: readonly MarkerMergeExpectation[];
  readonly expectedUserId: string;
  readonly signal?: AbortSignal;
}

export interface RemoteMarkerMergeResult {
  readonly changed: boolean;
}
export interface LocalTrackSyncPair {
  readonly summary: LocalTrackSummary;
  readonly content: LocalTrackContent;
}

export interface RemoteTrackMergeBatch {
  readonly put: readonly LocalTrackSyncPair[];
  readonly deleteTrackIds: readonly string[];
  readonly states: readonly TrackSyncState[];
  readonly expectedStates?: readonly TrackSyncState[];
  readonly expectedUserId?: string;
  readonly signal?: AbortSignal;
  readonly usage: TrackSyncUsage;
}

export interface LocalTrackSyncHash {
  readonly trackId: string;
  readonly contentHash: string;
  readonly legacyContentHash: string;
}

export interface TrackSyncUsage {
  readonly usedBytes: number;
  readonly reservedBytes: number;
  readonly limitBytes: number;
}

const defaultTrackSyncUsage: TrackSyncUsage = {
  usedBytes: 0,
  reservedBytes: 0,
  limitBytes: 8_388_608,
};

const trackSyncEnabledSchema = z.boolean();
const trackSyncUsageSchema: z.ZodType<TrackSyncUsage> = z
  .object({
    usedBytes: z.number().int().nonnegative().max(8_388_608),
    reservedBytes: z.number().int().nonnegative().max(8_388_608),
    limitBytes: z.literal(8_388_608),
  })
  .strict();

const uiPreferencesSchema = z
  .object({
    developerMode: z.boolean(),
    navigationCollapsed: z.boolean().default(false),
    elevationGradeLegendDismissed: z.boolean().default(false),
    markerSort: z.enum(markerSorts).default('created'),
    trackSort: z.enum(trackSorts).default('created'),
  })
  .strict();

interface UiPreferences {
  readonly developerMode: boolean;
  readonly navigationCollapsed: boolean;
  readonly elevationGradeLegendDismissed: boolean;
  readonly markerSort: MarkerSort;
  readonly trackSort: TrackSort;
}

const defaultUiPreferences: UiPreferences = {
  developerMode: false,
  navigationCollapsed: false,
  elevationGradeLegendDismissed: false,
  markerSort: 'created',
  trackSort: 'created',
};

const mapCameraKey = 'map.camera';

interface PersistedMapView {
  readonly schemaVersion: 3;
  readonly camera: Pick<MapCamera, 'longitude' | 'latitude' | 'zoom'>;
}

function readPersistedCamera(value: unknown): MapCamera | null {
  if (typeof value !== 'object' || value === null) return null;

  const candidate = value as Record<string, unknown>;
  const storedCamera =
    candidate.schemaVersion === 3 &&
    typeof candidate.camera === 'object' &&
    candidate.camera !== null
      ? { ...(candidate.camera as Record<string, unknown>), bearing: 0, pitch: 0 }
      : candidate.camera;
  const camera = normalizeMapCamera(storedCamera);
  if (camera === null || ![1, 2, 3].includes(candidate.schemaVersion as number)) {
    return null;
  }
  return { ...camera, bearing: 0, pitch: 0 };
}

const maximumCloudCoverPercentSchema = z.number().min(0).max(100);
const defaultMaximumCloudCoverPercent = 50;
const mapLayerPreferencesSchema = z
  .object({
    visibility: z
      .object({
        'google-satellite': z.boolean().default(false),
        'napr-orthophoto': z.boolean().default(false),
        'satellite-imagery': z.boolean(),
        'scene-footprint': z.boolean(),
        'terrain-relief': z.boolean().default(true),
        'elevation-isolines': z.boolean().default(true),
        'natural-features': z.boolean().default(true),
        'restricted-areas': z.boolean().default(true),
        'detail-context': z.boolean().default(true),
        'hiking-paths': z.boolean(),
        roads: z.boolean(),
        'places-and-pois': z.boolean(),
        'imported-tracks': z.boolean().default(true),
        'track-elevation-gradient': z.boolean().default(true),
      })
      .strict(),
    openStreetMapOpacity: z.number().min(0).max(1).default(1),
    importedTrackOpacity: z.number().min(0).max(1).default(1),
    satelliteRenderingMode: z
      .enum(['auto', 'server', 'direct'])
      .default(defaultSatelliteRenderingMode),
    renderingTuning: z
      .object({
        reflectanceMax: z.number().min(2_000).max(15_000),
        gamma: z.number().min(0.3).max(4),
        saturation: z.number().min(0).max(5),
      })
      .default(defaultSatelliteRenderingTuning),
    terrainOverlays: z
      .object({
        contourIntervalMeters: z.union([
          z.literal(20),
          z.literal(25),
          z.literal(40),
          z.literal(50),
          z.literal(100),
        ]),
        filterInvalidDemPixels: z.boolean().default(true),
        shadeAboveSatellite: z.boolean(),
      })
      .default(defaultTerrainOverlayPreferences),
  })
  .strict();

function withoutLegacyAppliedScene(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Object.hasOwn(value, 'appliedScene')
  ) {
    return value;
  }
  const sanitized = { ...(value as Record<string, unknown>) };
  delete sanitized.appliedScene;
  return sanitized;
}

const defaultMapLayerPreferences: PersistedMapLayerPreferences = {
  visibility: {
    'google-satellite': false,
    'napr-orthophoto': false,
    'satellite-imagery': true,
    'scene-footprint': true,
    'terrain-relief': true,
    'elevation-isolines': true,
    'natural-features': true,
    'restricted-areas': true,
    'detail-context': true,
    'hiking-paths': true,
    roads: true,
    'places-and-pois': true,
    'imported-tracks': true,
    'track-elevation-gradient': true,
  },
  openStreetMapOpacity: 1,
  importedTrackOpacity: 1,
  satelliteRenderingMode: defaultSatelliteRenderingMode,
  renderingTuning: defaultSatelliteRenderingTuning,
  terrainOverlays: defaultTerrainOverlayPreferences,
};

const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

type PoiCandidateBuilder = {
  -readonly [Key in keyof PoiCandidate]: PoiCandidate[Key];
};

const poiCandidateSchema = z
  .object({
    label: z.string().trim().min(1).max(2_000),
    kind: z.string().trim().min(1).max(200),
    matchedCoordinate: coordinateSchema,
    distanceMeters: z.number().nonnegative().optional(),
    lookedUpAt: z.iso.datetime(),
  })
  .strict()
  .transform((value): PoiCandidate => {
    const result: PoiCandidateBuilder = {
      label: value.label,
      kind: value.kind,
      matchedCoordinate: value.matchedCoordinate,
      lookedUpAt: value.lookedUpAt,
    };
    if (value.distanceMeters !== undefined) {
      result.distanceMeters = value.distanceMeters;
    }
    return result;
  });

type PersistedTrackMetricsBuilder = {
  -readonly [Key in keyof TrackMetrics]: TrackMetrics[Key];
};

const trackMetricsSchema = z
  .object({
    distanceMeters: z.number().nonnegative(),
    distanceAlgorithmVersion: z.literal(1),
    startCoordinate: coordinateSchema,
    endCoordinate: coordinateSchema,
    bounds: z
      .object({
        west: z.number().min(-180).max(180),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        north: z.number().min(-90).max(90),
        crossesAntimeridian: z.boolean(),
      })
      .strict(),
    center: coordinateSchema,
    recordedStartAt: z.iso.datetime().optional(),
    recordedEndAt: z.iso.datetime().optional(),
    elapsedSeconds: z.number().nonnegative().optional(),
    ascentMeters: z.number().nonnegative().optional(),
    descentMeters: z.number().nonnegative().optional(),
    minimumElevationMeters: z.number().optional(),
    maximumElevationMeters: z.number().optional(),
    elevationSource: z.enum(['gpx', 'dem-assisted']).optional(),
    elevationAlgorithmVersion: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const provenanceIsValid =
      (value.elevationSource === undefined &&
        value.elevationAlgorithmVersion === undefined) ||
      (value.elevationSource === 'gpx' && value.elevationAlgorithmVersion === 1) ||
      (value.elevationSource === 'dem-assisted' &&
        value.elevationAlgorithmVersion === 2) ||
      ((value.elevationSource === 'gpx' || value.elevationSource === 'dem-assisted') &&
        value.elevationAlgorithmVersion === 3) ||
      (value.elevationSource === 'dem-assisted' &&
        value.elevationAlgorithmVersion === 4);
    if (!provenanceIsValid) {
      context.addIssue({
        code: 'custom',
        message: 'Elevation source and algorithm version do not match.',
      });
    }
  })
  .transform((value): TrackMetrics => {
    const result: PersistedTrackMetricsBuilder = {
      distanceMeters: value.distanceMeters,
      distanceAlgorithmVersion: value.distanceAlgorithmVersion,
      startCoordinate: value.startCoordinate,
      endCoordinate: value.endCoordinate,
      bounds: value.bounds,
      center: value.center,
    };
    if (value.recordedStartAt !== undefined) {
      result.recordedStartAt = value.recordedStartAt;
    }
    if (value.recordedEndAt !== undefined) result.recordedEndAt = value.recordedEndAt;
    if (value.elapsedSeconds !== undefined)
      result.elapsedSeconds = value.elapsedSeconds;
    if (value.ascentMeters !== undefined) result.ascentMeters = value.ascentMeters;
    if (value.descentMeters !== undefined) result.descentMeters = value.descentMeters;
    if (value.minimumElevationMeters !== undefined) {
      result.minimumElevationMeters = value.minimumElevationMeters;
    }
    if (value.maximumElevationMeters !== undefined) {
      result.maximumElevationMeters = value.maximumElevationMeters;
    }
    if (value.elevationSource !== undefined) {
      result.elevationSource = value.elevationSource;
    }
    if (value.elevationAlgorithmVersion !== undefined) {
      result.elevationAlgorithmVersion = value.elevationAlgorithmVersion;
    }
    return result;
  });

const calculatedTrackMetricsSchema = trackMetricsSchema.refine(
  (value) =>
    value.elevationSource === 'dem-assisted' && value.elevationAlgorithmVersion === 4,
  { message: 'Calculated elevation metrics require algorithm version 4.' },
);

type GpxWarningBuilder = {
  -readonly [Key in keyof GpxValidationWarning]: GpxValidationWarning[Key];
};

const warningSchema = z
  .object({
    code: z.enum([
      'invalid-point',
      'short-segment',
      'track-preferred-over-route',
      'invalid-time',
      'warning-limit-reached',
    ]),
    message: z.string().min(1).max(500),
    segmentIndex: z.number().int().nonnegative().optional(),
    pointIndex: z.number().int().nonnegative().optional(),
  })
  .strict()
  .transform((value): GpxValidationWarning => {
    const result: GpxWarningBuilder = {
      code: value.code,
      message: value.message,
    };
    if (value.segmentIndex !== undefined) result.segmentIndex = value.segmentIndex;
    if (value.pointIndex !== undefined) result.pointIndex = value.pointIndex;
    return result;
  });

const linkSchema = z
  .object({ href: z.url(), text: z.string().max(2_000).optional() })
  .strict()
  .transform((value): GpxLink => {
    const result: { href: string; text?: string } = { href: value.href };
    if (value.text !== undefined) result.text = value.text;
    return result;
  });

type GpxMetadataRecordBuilder = {
  -readonly [Key in keyof GpxMetadataProjection]: GpxMetadataProjection[Key];
};

const metadataSchema = z
  .object({
    version: z.enum(['1.0', '1.1']),
    creator: z.string().max(2_000).optional(),
    name: z.string().max(2_000).optional(),
    description: z.string().max(2_000).optional(),
    time: z.iso.datetime().optional(),
    keywords: z.string().max(2_000).optional(),
    authorName: z.string().max(2_000).optional(),
    copyrightLabel: z.string().max(2_000).optional(),
    copyrightYear: z.number().int().optional(),
    links: z.array(linkSchema).max(10),
    selectedName: z.string().max(2_000).optional(),
    selectedDescription: z.string().max(2_000).optional(),
    selectedComment: z.string().max(2_000).optional(),
    selectedSource: z.string().max(2_000).optional(),
    selectedType: z.string().max(2_000).optional(),
    selectedNumber: z.number().optional(),
  })
  .strict()
  .transform((value): GpxMetadataProjection => {
    const result: GpxMetadataRecordBuilder = {
      version: value.version,
      links: value.links,
    };
    if (value.creator !== undefined) result.creator = value.creator;
    if (value.name !== undefined) result.name = value.name;
    if (value.description !== undefined) result.description = value.description;
    if (value.time !== undefined) result.time = value.time;
    if (value.keywords !== undefined) result.keywords = value.keywords;
    if (value.authorName !== undefined) result.authorName = value.authorName;
    if (value.copyrightLabel !== undefined) {
      result.copyrightLabel = value.copyrightLabel;
    }
    if (value.copyrightYear !== undefined) result.copyrightYear = value.copyrightYear;
    if (value.selectedName !== undefined) result.selectedName = value.selectedName;
    if (value.selectedDescription !== undefined) {
      result.selectedDescription = value.selectedDescription;
    }
    if (value.selectedComment !== undefined) {
      result.selectedComment = value.selectedComment;
    }
    if (value.selectedSource !== undefined)
      result.selectedSource = value.selectedSource;
    if (value.selectedType !== undefined) result.selectedType = value.selectedType;
    if (value.selectedNumber !== undefined)
      result.selectedNumber = value.selectedNumber;
    return result;
  });

type LocalTrackSummaryBuilder = {
  -readonly [Key in keyof LocalTrackSummary]: LocalTrackSummary[Key];
};
type LocalTrackContentBuilder = {
  -readonly [Key in keyof LocalTrackContent]: LocalTrackContent[Key];
};

function withCurrentLocalTrackSchemaVersion(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    (value.schemaVersion !== 1 &&
      value.schemaVersion !== 2 &&
      value.schemaVersion !== 3)
  ) {
    return value;
  }
  const migrated = {
    ...value,
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
  };
  if ('savedAt' in migrated && !('updatedAt' in migrated)) {
    return { ...migrated, updatedAt: migrated.savedAt };
  }
  return migrated;
}
function withoutCalculatedElevation(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const sourceRecord: Record<string, unknown> = { ...value };
  delete sourceRecord.calculatedMetrics;
  delete sourceRecord.calculatedTrackPoints;
  return sourceRecord;
}

const currentLocalTrackSummarySchema = z
  .object({
    schemaVersion: z.literal(LOCAL_TRACK_SCHEMA_VERSION),
    id: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    normalizedName: z.string().min(1).max(200),
    savedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    contentHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    sourceFilename: z.string().min(1).max(500),
    sourceFormat: z.enum(['gpx', 'fit', 'kml']).default('gpx'),
    favorite: z.boolean().default(false),
    geometryKind: z.enum(['track', 'route']),
    pointCount: z.number().int().min(2).max(100_000),
    segmentCount: z.number().int().min(1).max(512),
    metrics: trackMetricsSchema,
    calculatedMetrics: calculatedTrackMetricsSchema.optional(),
    metadata: metadataSchema,
    warnings: z.array(warningSchema).max(50),
    generatedName: z.string().trim().min(1).max(200).optional(),
    middleAnchorKind: z.enum(['distance-midpoint', 'dominant-summit']).optional(),
    startPoi: poiCandidateSchema.optional(),
    middlePoi: poiCandidateSchema.optional(),
    endPoi: poiCandidateSchema.optional(),
    fallbackPoi: poiCandidateSchema.optional(),
  })
  .strict()
  .transform((value): LocalTrackSummary => {
    const result: LocalTrackSummaryBuilder = {
      schemaVersion: value.schemaVersion,
      id: value.id,
      name: value.name,
      normalizedName: value.normalizedName,
      savedAt: value.savedAt,
      updatedAt: value.updatedAt,
      sourceFilename: value.sourceFilename,
      sourceFormat: value.sourceFormat,
      favorite: value.favorite,
      geometryKind: value.geometryKind,
      pointCount: value.pointCount,
      segmentCount: value.segmentCount,
      metrics: value.metrics,
      metadata: value.metadata,
      warnings: value.warnings,
    };
    if (value.calculatedMetrics !== undefined) {
      result.calculatedMetrics = value.calculatedMetrics;
    }
    if (value.generatedName !== undefined) result.generatedName = value.generatedName;
    if (value.middleAnchorKind !== undefined) {
      result.middleAnchorKind = value.middleAnchorKind;
    }
    if (value.startPoi !== undefined) result.startPoi = value.startPoi;
    if (value.middlePoi !== undefined) result.middlePoi = value.middlePoi;
    if (value.endPoi !== undefined) result.endPoi = value.endPoi;
    if (value.fallbackPoi !== undefined) result.fallbackPoi = value.fallbackPoi;
    if (value.contentHash !== undefined) result.contentHash = value.contentHash;
    return result;
  });

const localTrackSummarySchema = z.preprocess(
  withCurrentLocalTrackSchemaVersion,
  currentLocalTrackSummarySchema,
);

const storedTrackPointSchema: z.ZodType<TrackPoint> = z
  .object({
    coordinate: coordinateSchema,
    elevationMeters: z.number().optional(),
    recordedAt: z.iso.datetime().optional(),
  })
  .strict()
  .transform((value): TrackPoint => {
    const point: {
      coordinate: TrackPoint['coordinate'];
      elevationMeters?: number;
      recordedAt?: string;
    } = { coordinate: value.coordinate };
    if (value.elevationMeters !== undefined) {
      point.elevationMeters = value.elevationMeters;
    }
    if (value.recordedAt !== undefined) point.recordedAt = value.recordedAt;
    return point;
  });

const storedTrackSegmentsSchema = z
  .array(z.array(storedTrackPointSchema).min(2))
  .min(1)
  .max(512);

const storedCalculatedTrackSegmentsSchema = storedTrackSegmentsSchema.optional();

const currentLocalTrackContentSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_TRACK_SCHEMA_VERSION),
    trackId: z.string().min(1).max(200),
    trackPoints: storedTrackSegmentsSchema,
    calculatedTrackPoints: storedCalculatedTrackSegmentsSchema,
  })
  .strict()
  .transform((value): LocalTrackContent => {
    const content: LocalTrackContentBuilder = {
      schemaVersion: value.schemaVersion,
      trackId: value.trackId,
      trackPoints: value.trackPoints,
    };
    if (value.calculatedTrackPoints !== undefined) {
      content.calculatedTrackPoints = value.calculatedTrackPoints;
    }
    return content;
  });

const legacyLocalTrackContentSchema: z.ZodType<LocalTrackContent> = z
  .object({
    schemaVersion: z.literal(LOCAL_TRACK_SCHEMA_VERSION),
    trackId: z.string().min(1).max(200),
    segments: z.array(z.array(coordinateSchema).min(2)).min(1).max(512),
    trackPoints: storedTrackSegmentsSchema.optional(),
  })
  .loose()
  .transform((value): LocalTrackContent => ({
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId: value.trackId,
    trackPoints:
      value.trackPoints ??
      value.segments.map((segment) => segment.map((coordinate) => ({ coordinate }))),
  }));

const localTrackContentSchema: z.ZodType<LocalTrackContent> = z.preprocess(
  withCurrentLocalTrackSchemaVersion,
  z.union([currentLocalTrackContentSchema, legacyLocalTrackContentSchema]),
);

function parseLocalTrackSummary(value: unknown): LocalTrackSummary | null {
  const result = localTrackSummarySchema.safeParse(value);
  return result.success ? result.data : null;
}

function parseLocalTrackContent(value: unknown): LocalTrackContent | null {
  const result = localTrackContentSchema.safeParse(value);
  return result.success ? result.data : null;
}

const trackSyncStateSchema: z.ZodType<TrackSyncState> = z
  .object({
    trackId: z.string().min(1).max(200),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    lineageHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    geometryVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    remoteRevision: z.number().int().positive().nullable(),
    pendingKind: z.enum(['upsert', 'metadata', 'delete']).nullable(),
  })
  .strict()
  .transform((value): TrackSyncState => ({
    ...value,
    lineageHash: value.lineageHash ?? value.contentHash,
    geometryVersion: value.geometryVersion ?? 1,
  }));

function pendingKindWithHighestPrecedence(
  states: readonly TrackSyncState[],
): TrackSyncState['pendingKind'] {
  if (states.some((state) => state.pendingKind === 'upsert')) return 'upsert';
  if (states.some((state) => state.pendingKind === 'metadata')) return 'metadata';
  return null;
}

function parseTrackSyncState(value: unknown): TrackSyncState | null {
  const result = trackSyncStateSchema.safeParse(value);
  return result.success ? result.data : null;
}

const markerNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() === value, 'Marker names must be trimmed.');

const savedMarkerSchema: z.ZodType<SavedMarker> = z
  .object({
    schemaVersion: z.literal(SAVED_MARKER_SCHEMA_VERSION),
    id: z.string().min(1).max(200),
    name: markerNameSchema,
    normalizedName: z.string().min(1),
    coordinate: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    iconKey: z.enum(markerIconKeys),
    colorKey: z.enum(markerColorKeys),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    const normalized = normalizeSavedMarkerName(value.name);
    if (value.normalizedName !== normalized.normalizedName) {
      context.addIssue({
        code: 'custom',
        message: 'Marker normalized name does not match its name.',
        path: ['normalizedName'],
      });
    }
  });

const savedMarkerUpdateSchema = z
  .object({
    name: markerNameSchema,
    normalizedName: z.string().min(1),
    iconKey: z.enum(markerIconKeys),
    colorKey: z.enum(markerColorKeys),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    const normalized = normalizeSavedMarkerName(value.name);
    if (value.normalizedName !== normalized.normalizedName) {
      context.addIssue({
        code: 'custom',
        message: 'Marker normalized name does not match its name.',
        path: ['normalizedName'],
      });
    }
  });

const savedMarkerIdSchema = z.string().min(1).max(200);

function parseSavedMarker(value: unknown): SavedMarker | null {
  const result = savedMarkerSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function validateSavedMarkerRecord(value: unknown): SavedMarker {
  const result = savedMarkerSchema.safeParse(value);
  if (!result.success) {
    throw new SavedMarkerStorageError(
      'record-invalid',
      'The saved marker record is invalid.',
    );
  }
  return result.data;
}

function parseSavedMarkerUpdate(
  value: unknown,
): Readonly<
  Pick<SavedMarker, 'name' | 'normalizedName' | 'iconKey' | 'colorKey' | 'updatedAt'>
> | null {
  const result = savedMarkerUpdateSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function validateLocalTrackSyncPair(value: unknown): LocalTrackSyncPair {
  if (typeof value !== 'object' || value === null) {
    throw new LocalTrackStorageError(
      'record-invalid',
      'The local track record is invalid.',
    );
  }
  const candidate = value as Record<string, unknown>;
  const summary = parseLocalTrackSummary(candidate.summary);
  const content = parseLocalTrackContent(candidate.content);
  if (summary?.contentHash === undefined || content?.trackId !== summary.id) {
    throw new LocalTrackStorageError(
      'record-invalid',
      'The local track record is invalid.',
    );
  }
  return { summary, content };
}

/** Owns the versioned IndexedDB schema and validates values crossing storage boundaries. */
export class AppDatabase
  extends Dexie
  implements
    MapLayerPreferencesRepository,
    MapCameraRepository,
    LocalTrackRepository,
    SavedMarkerRepository
{
  public readonly settings!: EntityTable<SettingRecord, 'key'>;
  public readonly diagnostics!: EntityTable<PersistedDiagnosticRecord, 'id'>;
  public readonly localTracks!: EntityTable<LocalTrackSummary, 'id'>;
  public readonly localTrackContents!: EntityTable<LocalTrackContent, 'trackId'>;
  public readonly trackSyncStates!: EntityTable<TrackSyncState, 'trackId'>;
  public readonly savedMarkers!: EntityTable<SavedMarker, 'id'>;
  public readonly markerSyncStates!: EntityTable<MarkerSyncState, 'markerId'>;
  public constructor(private readonly logger: DiagnosticLogger) {
    super('GeorgiaRoutingPlanner');
    this.version(1).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
    });
    this.version(2).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
    });
    this.version(3).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
    });
    this.version(4)
      .stores({
        settings: 'key,updatedAt',
        diagnostics: '++id,timestamp,name,level',
        localTracks: 'id,normalizedName,savedAt',
        localTrackContents: 'trackId',
      })
      .upgrade(async (transaction) => {
        const summaryTable = transaction.table('localTracks');
        const summaries: unknown[] = await summaryTable.toArray();
        for (const summary of summaries) {
          const parsed = parseLocalTrackSummary(summary);
          if (parsed !== null) await summaryTable.put(parsed);
        }
        const contentTable = transaction.table('localTrackContents');
        const contents: unknown[] = await contentTable.toArray();
        for (const content of contents) {
          const parsed = parseLocalTrackContent(content);
          if (parsed !== null) await contentTable.put(parsed);
        }
      });
    this.version(5)
      .stores({
        settings: 'key,updatedAt',
        diagnostics: '++id,timestamp,name,level',
        localTracks: 'id,normalizedName,savedAt',
        localTrackContents: 'trackId',
        trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
      })
      .upgrade(async (transaction) => {
        const summaryTable = transaction.table('localTracks');
        const summaries: unknown[] = await summaryTable.toArray();
        for (const summary of summaries) {
          const parsed = parseLocalTrackSummary(summary);
          if (parsed !== null) await summaryTable.put(parsed);
        }
        const contentTable = transaction.table('localTrackContents');
        const contents: unknown[] = await contentTable.toArray();
        for (const content of contents) {
          const parsed = parseLocalTrackContent(content);
          if (parsed !== null) await contentTable.put(parsed);
        }
      });
    this.version(6)
      .stores({
        settings: 'key,updatedAt',
        diagnostics: '++id,timestamp,name,level',
        localTracks: 'id,normalizedName,savedAt',
        localTrackContents: 'trackId',
        trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
        savedMarkers: 'id,normalizedName,colorKey,createdAt',
      })
      .upgrade(async (transaction) => {
        const summaryTable = transaction.table('localTracks');
        const summaries: unknown[] = await summaryTable.toArray();
        for (const summary of summaries) {
          const parsed = parseLocalTrackSummary(withoutCalculatedElevation(summary));
          if (parsed !== null) await summaryTable.put(parsed);
        }
        const contentTable = transaction.table('localTrackContents');
        const contents: unknown[] = await contentTable.toArray();
        for (const content of contents) {
          const parsed = parseLocalTrackContent(withoutCalculatedElevation(content));
          if (parsed !== null) await contentTable.put(parsed);
        }
      });
    this.version(7).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
      localTracks: 'id,normalizedName,savedAt',
      localTrackContents: 'trackId',
      trackSyncStates: 'trackId,contentHash,remoteRevision,pendingKind',
      savedMarkers: 'id,normalizedName,colorKey,createdAt',
      markerSyncStates: 'markerId,remoteRevision,pendingKind',
    });
  }

  public async saveLocalTrack(
    summary: LocalTrackSummary,
    content: LocalTrackContent,
  ): Promise<void> {
    const validSummary = parseLocalTrackSummary(summary);
    const validContent = parseLocalTrackContent(content);
    const idsMatch = validSummary?.id === validContent?.trackId;
    if (validSummary?.contentHash === undefined || validContent === null || !idsMatch) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The local track record is invalid.',
      );
    }
    const state: TrackSyncState = {
      trackId: validSummary.id,
      contentHash: validSummary.contentHash,
      lineageHash: validSummary.contentHash,
      geometryVersion: 2,
      remoteRevision: null,
      pendingKind: 'upsert',
    };
    await this.transaction(
      'rw',
      this.localTracks,
      this.localTrackContents,
      this.trackSyncStates,
      async () => {
        await this.localTracks.put(validSummary);
        await this.localTrackContents.put(validContent);
        await this.trackSyncStates.put(state);
      },
    );
  }

  public async replaceCalculatedTrackElevation(
    trackId: string,
    calculatedMetrics: TrackMetrics | null,
    calculatedTrackPoints: LocalTrackContent['calculatedTrackPoints'],
    options: { readonly expectedContentHash?: string } = {},
  ): Promise<LocalTrackSummary> {
    const validCalculatedMetrics =
      calculatedMetrics === null
        ? null
        : calculatedTrackMetricsSchema.safeParse(calculatedMetrics);
    const validCalculatedTrackPoints =
      storedCalculatedTrackSegmentsSchema.safeParse(calculatedTrackPoints);
    if (
      (validCalculatedMetrics !== null && !validCalculatedMetrics.success) ||
      !validCalculatedTrackPoints.success ||
      (calculatedMetrics === null) !== (calculatedTrackPoints === undefined)
    ) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The calculated track elevation is invalid.',
      );
    }
    return this.transaction(
      'rw',
      this.localTracks,
      this.localTrackContents,
      async () => {
        const existingSummary = await this.localTracks.get(trackId);
        const summary = parseLocalTrackSummary(existingSummary);
        if (summary === null) {
          throw new LocalTrackStorageError(
            'not-found',
            'The saved track was not found.',
          );
        }
        const existingContent = await this.localTrackContents.get(trackId);
        const content = parseLocalTrackContent(existingContent);
        if (content === null) {
          throw new LocalTrackStorageError(
            'content-missing',
            'The saved track content is missing.',
          );
        }
        if (
          options.expectedContentHash !== undefined &&
          summary.contentHash !== options.expectedContentHash
        ) {
          return summary;
        }
        const updatedSummary: LocalTrackSummaryBuilder = { ...summary };
        const updatedContent: LocalTrackContentBuilder = { ...content };
        if (validCalculatedTrackPoints.data === undefined) {
          delete updatedContent.calculatedTrackPoints;
        } else {
          updatedContent.calculatedTrackPoints = validCalculatedTrackPoints.data;
        }
        if (validCalculatedMetrics === null) {
          delete updatedSummary.calculatedMetrics;
        } else {
          updatedSummary.calculatedMetrics = validCalculatedMetrics.data;
        }
        const summaryResult = parseLocalTrackSummary(updatedSummary);
        const contentResult = parseLocalTrackContent(updatedContent);
        if (summaryResult === null || contentResult === null) {
          throw new LocalTrackStorageError(
            'record-invalid',
            'The calculated track elevation is invalid.',
          );
        }
        await this.localTracks.put(summaryResult);
        await this.localTrackContents.put(contentResult);
        return summaryResult;
      },
    );
  }

  public async listLocalTracks(): Promise<readonly LocalTrackSummary[]> {
    const records = await this.localTracks.toArray();
    const valid: LocalTrackSummary[] = [];
    let invalidCount = 0;
    for (const record of records) {
      const parsed = parseLocalTrackSummary(record);
      if (parsed === null) {
        invalidCount += 1;
      } else {
        valid.push(parsed);
      }
    }
    if (invalidCount > 0) {
      this.logger.log({
        level: 'warn',
        name: 'storage.local-tracks.invalid-summary',
        data: { invalidCount },
      });
    }
    return valid.sort((left, right) => {
      if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
      const bySavedAt = right.savedAt.localeCompare(left.savedAt, 'en');
      return bySavedAt === 0 ? left.id.localeCompare(right.id, 'en') : bySavedAt;
    });
  }

  public async listSavedMarkers(): Promise<readonly SavedMarker[]> {
    const records = await this.savedMarkers.toArray();
    const valid: SavedMarker[] = [];
    let invalidCount = 0;
    for (const record of records) {
      const parsed = parseSavedMarker(record);
      if (parsed === null) {
        invalidCount += 1;
      } else {
        valid.push(parsed);
      }
    }
    if (invalidCount > 0) {
      this.logger.log({
        level: 'warn',
        name: 'storage.saved-markers.invalid-record',
        data: { invalidCount },
      });
    }
    return valid;
  }

  public async readMarkerSyncSnapshot(): Promise<readonly MarkerSyncEntry[]> {
    return await this.transaction(
      'r',
      this.savedMarkers,
      this.markerSyncStates,
      async () => {
        const states = await this.markerSyncStates.orderBy('markerId').toArray();
        const snapshot: MarkerSyncEntry[] = [];
        for (const value of states) {
          const parsedState = markerSyncStateSchema.safeParse(value);
          if (!parsedState.success) continue;
          const marker = parseSavedMarker(
            await this.savedMarkers.get(parsedState.data.markerId),
          );
          snapshot.push({ marker, state: parsedState.data });
        }
        return snapshot;
      },
    );
  }

  public async saveSavedMarker(marker: SavedMarker): Promise<void> {
    const parsed = parseSavedMarker(marker);
    if (parsed === null) {
      throw new SavedMarkerStorageError(
        'record-invalid',
        'The saved marker record is invalid.',
      );
    }
    try {
      await this.transaction(
        'rw',
        this.savedMarkers,
        this.markerSyncStates,
        async () => {
          await this.savedMarkers.add(parsed);
          await this.markerSyncStates.put({
            markerId: parsed.id,
            remoteRevision: null,
            pendingKind: 'upsert',
            localVersion: 1,
          });
        },
      );
    } catch (error) {
      if (error instanceof Dexie.ConstraintError) {
        throw new SavedMarkerStorageError(
          'record-invalid',
          'A saved marker with this identifier already exists.',
        );
      }
      throw error;
    }
  }

  public async updateSavedMarker(
    markerId: string,
    changes: Readonly<
      Pick<
        SavedMarker,
        'name' | 'normalizedName' | 'iconKey' | 'colorKey' | 'updatedAt'
      >
    >,
  ): Promise<SavedMarker> {
    const validMarkerId = savedMarkerIdSchema.safeParse(markerId);
    const validChanges = parseSavedMarkerUpdate(changes);
    if (!validMarkerId.success || validChanges === null) {
      throw new SavedMarkerStorageError(
        'record-invalid',
        'The saved marker update is invalid.',
      );
    }
    return this.transaction(
      'rw',
      this.savedMarkers,
      this.markerSyncStates,
      async () => {
        const existing = await this.savedMarkers.get(validMarkerId.data);
        if (existing === undefined) {
          throw new SavedMarkerStorageError(
            'not-found',
            'The saved marker was not found.',
          );
        }
        const marker = parseSavedMarker(existing);
        if (marker === null) {
          throw new SavedMarkerStorageError(
            'record-invalid',
            'The saved marker record is invalid.',
          );
        }
        const updated = parseSavedMarker({ ...marker, ...validChanges });
        if (updated === null) {
          throw new SavedMarkerStorageError(
            'record-invalid',
            'The saved marker update is invalid.',
          );
        }
        const parsedState = markerSyncStateSchema.safeParse(
          await this.markerSyncStates.get(validMarkerId.data),
        );
        const existingState = parsedState.success ? parsedState.data : null;
        await this.savedMarkers.put(updated);
        await this.markerSyncStates.put({
          markerId: updated.id,
          remoteRevision: existingState?.remoteRevision ?? null,
          pendingKind: 'upsert',
          localVersion: nextMarkerLocalVersion(existingState),
        });
        return updated;
      },
    );
  }

  public async deleteSavedMarker(markerId: string): Promise<void> {
    const validMarkerId = savedMarkerIdSchema.safeParse(markerId);
    if (!validMarkerId.success) {
      throw new SavedMarkerStorageError(
        'record-invalid',
        'The saved marker identifier is invalid.',
      );
    }
    await this.transaction('rw', this.savedMarkers, this.markerSyncStates, async () => {
      const existing = await this.savedMarkers.get(validMarkerId.data);
      if (existing === undefined) {
        throw new SavedMarkerStorageError(
          'not-found',
          'The saved marker was not found.',
        );
      }
      if (parseSavedMarker(existing) === null) {
        throw new SavedMarkerStorageError(
          'record-invalid',
          'The saved marker record is invalid.',
        );
      }
      const storedState = await this.markerSyncStates.get(validMarkerId.data);
      const parsedState = markerSyncStateSchema.safeParse(storedState);
      const state = parsedState.success ? parsedState.data : null;
      await this.savedMarkers.delete(validMarkerId.data);
      if (storedState !== undefined) {
        await this.markerSyncStates.put({
          markerId: validMarkerId.data,
          remoteRevision: state?.remoteRevision ?? null,
          pendingKind: 'delete',
          localVersion: nextMarkerLocalVersion(state),
        });
      }
    });
  }

  public async loadLocalTrackContent(trackId: string): Promise<LocalTrackContent> {
    const content = await this.localTrackContents.get(trackId);
    if (content === undefined) {
      throw new LocalTrackStorageError(
        'content-missing',
        'The saved track content is unavailable.',
      );
    }
    const parsed = parseLocalTrackContent(content);
    if (parsed?.trackId !== trackId) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The saved track content is invalid.',
      );
    }
    return parsed;
  }

  public async renameLocalTrack(
    trackId: string,
    name: string,
  ): Promise<LocalTrackSummary> {
    const normalized = normalizeLocalTrackName(name);
    return this.updateLocalTrackMetadata(trackId, normalized, undefined);
  }

  public async setLocalTrackFavorite(
    trackId: string,
    favorite: boolean,
  ): Promise<LocalTrackSummary> {
    return this.updateLocalTrackMetadata(trackId, undefined, favorite);
  }

  private async updateLocalTrackMetadata(
    trackId: string,
    name: ReturnType<typeof normalizeLocalTrackName> | undefined,
    favorite: boolean | undefined,
  ): Promise<LocalTrackSummary> {
    return this.transaction('rw', this.localTracks, this.trackSyncStates, async () => {
      const existing = await this.localTracks.get(trackId);
      const summary = parseLocalTrackSummary(existing);
      if (summary === null) {
        throw new LocalTrackStorageError('not-found', 'The saved track was not found.');
      }
      const updated: LocalTrackSummary = {
        ...summary,
        ...name,
        ...(favorite === undefined ? {} : { favorite }),
        updatedAt: new Date().toISOString(),
      };
      await this.localTracks.put(updated);
      const state = parseTrackSyncState(await this.trackSyncStates.get(trackId));
      if (state !== null) {
        await this.trackSyncStates.put({
          ...state,
          pendingKind: state.pendingKind === 'upsert' ? 'upsert' : 'metadata',
        });
      }
      return updated;
    });
  }

  public async loadLatestOpenedTrackId(): Promise<string | null> {
    const record = await this.settings.get('local-tracks.latest-opened');
    if (record === undefined) return null;
    if (typeof record.value === 'string' && record.value.length <= 200) {
      return record.value;
    }
    await this.settings.delete('local-tracks.latest-opened');
    return null;
  }

  public async saveLatestOpenedTrackId(trackId: string | null): Promise<void> {
    if (trackId === null) {
      await this.settings.delete('local-tracks.latest-opened');
      return;
    }
    if (trackId.length === 0 || trackId.length > 200) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The latest opened track identifier is invalid.',
      );
    }
    await this.settings.put({
      key: 'local-tracks.latest-opened',
      value: trackId,
      updatedAt: new Date().toISOString(),
    });
  }

  public async deleteLocalTrack(trackId: string): Promise<void> {
    await this.transaction(
      'rw',
      this.settings,
      this.localTracks,
      this.localTrackContents,
      this.trackSyncStates,
      async () => {
        const state = parseTrackSyncState(await this.trackSyncStates.get(trackId));
        await this.localTrackContents.delete(trackId);
        await this.localTracks.delete(trackId);
        if (state !== null) {
          await this.trackSyncStates.put({
            trackId,
            contentHash: state.contentHash,
            lineageHash: state.lineageHash,
            geometryVersion: state.geometryVersion,
            remoteRevision: state.remoteRevision,
            pendingKind: 'delete',
          });
        } else {
          await this.trackSyncStates.delete(trackId);
        }
        const latest = await this.settings.get('local-tracks.latest-opened');
        if (latest?.value === trackId) {
          await this.settings.delete('local-tracks.latest-opened');
        }
      },
    );
  }

  public async loadTrackSyncState(trackId: string): Promise<TrackSyncState | null> {
    const state = await this.trackSyncStates.get(trackId);
    if (state === undefined) return null;
    const parsed = parseTrackSyncState(state);
    if (parsed === null) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The track synchronization state is invalid.',
      );
    }
    return parsed;
  }

  public async saveTrackSyncState(state: TrackSyncState): Promise<void> {
    const parsed = parseTrackSyncState(state);
    if (parsed === null) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The track synchronization state is invalid.',
      );
    }
    await this.trackSyncStates.put(parsed);
  }

  public async listLocalTrackPairsWithoutSyncState(): Promise<
    readonly LocalTrackSyncPair[]
  > {
    return this.transaction(
      'r',
      this.localTracks,
      this.localTrackContents,
      this.trackSyncStates,
      async () => {
        const summaries = await this.localTracks.toArray();
        const pairs: LocalTrackSyncPair[] = [];
        for (const record of summaries) {
          const summary = parseLocalTrackSummary(record);
          if (summary === null) continue;
          if ((await this.trackSyncStates.get(summary.id)) !== undefined) continue;
          const content = parseLocalTrackContent(
            await this.localTrackContents.get(summary.id),
          );
          if (content?.trackId !== summary.id) {
            throw new LocalTrackStorageError(
              'content-missing',
              'The saved track content is unavailable.',
            );
          }
          pairs.push({ summary, content });
        }
        return pairs;
      },
    );
  }

  /**
   * Prepares the entire local user-data snapshot before the worker makes a server
   * mutation, including legacy track hash deduplication and marker mutation intent.
   */
  public async prepareUserDataSync(
    userId: string,
    contentHashes: readonly LocalTrackSyncHash[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (userId.length === 0 || userId.length > 200) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The synchronization account identifier is invalid.',
      );
    }
    signal?.throwIfAborted();
    const hashesByTrackId = new Map<string, LocalTrackSyncHash>();
    for (const entry of contentHashes) {
      if (
        !savedMarkerIdSchema.safeParse(entry.trackId).success ||
        !/^[0-9a-f]{64}$/.test(entry.contentHash) ||
        !/^[0-9a-f]{64}$/.test(entry.legacyContentHash) ||
        hashesByTrackId.has(entry.trackId)
      ) {
        throw new LocalTrackStorageError(
          'record-invalid',
          'The local track synchronization hashes are invalid.',
        );
      }
      hashesByTrackId.set(entry.trackId, entry);
    }
    await this.transaction(
      'rw',
      [
        this.settings,
        this.localTracks,
        this.localTrackContents,
        this.trackSyncStates,
        this.savedMarkers,
        this.markerSyncStates,
      ],
      async () => {
        const owner = await this.settings.get('sync.user-id');
        const sameAccount = owner?.value === userId;
        const stateByTrackId = new Map<string, TrackSyncState>();
        if (sameAccount) {
          for (const candidate of await this.trackSyncStates.toArray()) {
            const state = parseTrackSyncState(candidate);
            if (state !== null) stateByTrackId.set(state.trackId, state);
          }
        }

        const pairs: LocalTrackSyncPair[] = [];
        const identitiesByTrackId = new Map<
          string,
          Pick<TrackSyncState, 'lineageHash' | 'geometryVersion'>
        >();
        for (const candidate of await this.localTracks.toArray()) {
          const summary = parseLocalTrackSummary(candidate);
          const content = parseLocalTrackContent(
            await this.localTrackContents.get(candidate.id),
          );
          if (summary === null || content?.trackId !== candidate.id) continue;
          const hashes = hashesByTrackId.get(summary.id);
          if (hashes === undefined) {
            throw new LocalTrackStorageError(
              'record-invalid',
              'The local track content hash is unavailable.',
            );
          }
          const persistedState = stateByTrackId.get(summary.id);
          const existingHash =
            summary.contentHash ?? persistedState?.contentHash ?? hashes.contentHash;
          const isCurrent = existingHash === hashes.contentHash;
          const isLegacy = existingHash === hashes.legacyContentHash;
          if (!isCurrent && !isLegacy) {
            throw new LocalTrackStorageError(
              'record-invalid',
              'The local track content hash does not match its geometry.',
            );
          }
          const state =
            persistedState?.contentHash === existingHash ? persistedState : undefined;
          const shouldPromote =
            isLegacy &&
            (state?.remoteRevision === null ||
              state === undefined ||
              summary.metrics.elevationSource === 'gpx');
          let contentHash = existingHash;
          let identity: Pick<TrackSyncState, 'lineageHash' | 'geometryVersion'>;
          if (shouldPromote) {
            contentHash = hashes.contentHash;
            identity = {
              lineageHash:
                state?.remoteRevision === null || state === undefined
                  ? hashes.legacyContentHash
                  : state.lineageHash,
              geometryVersion: 2,
            };
            stateByTrackId.set(summary.id, {
              trackId: summary.id,
              contentHash,
              ...identity,
              remoteRevision: null,
              pendingKind: 'upsert',
            });
          } else {
            identity = {
              lineageHash: state?.remoteRevision
                ? state.lineageHash
                : hashes.legacyContentHash,
              geometryVersion: isCurrent ? 2 : 1,
            };
            if (state !== undefined) {
              stateByTrackId.set(summary.id, { ...state, ...identity });
            }
          }
          identitiesByTrackId.set(summary.id, identity);
          pairs.push({ summary: { ...summary, contentHash }, content });
        }

        const groups = new Map<
          string,
          { pairs: LocalTrackSyncPair[]; states: TrackSyncState[] }
        >();
        for (const pair of pairs) {
          const contentHash = pair.summary.contentHash;
          if (contentHash === undefined) continue;
          const group = groups.get(contentHash);
          if (group === undefined) {
            groups.set(contentHash, { pairs: [pair], states: [] });
          } else {
            group.pairs.push(pair);
          }
        }
        for (const state of stateByTrackId.values()) {
          const group = groups.get(state.contentHash);
          if (group === undefined) {
            groups.set(state.contentHash, { pairs: [], states: [state] });
          } else {
            group.states.push(state);
          }
        }

        const latestOpened = await this.settings.get('local-tracks.latest-opened');
        const latestOpenedTrackId =
          typeof latestOpened?.value === 'string' ? latestOpened.value : null;
        const deleteTrackIds = new Set<string>();
        const nextPairs: LocalTrackSyncPair[] = [];
        const nextStates: TrackSyncState[] = [];

        for (const [contentHash, group] of groups) {
          if (group.pairs.length === 0) continue;
          const deletion = group.states.find(
            (state) =>
              state.pendingKind === 'delete' &&
              state.remoteRevision !== null &&
              !group.pairs.some((pair) => pair.summary.id === state.trackId),
          );
          if (sameAccount && deletion !== undefined) {
            for (const pair of group.pairs) deleteTrackIds.add(pair.summary.id);
            for (const state of group.states) {
              if (state.trackId !== deletion.trackId) deleteTrackIds.add(state.trackId);
            }
            const remoteRevision = Math.max(
              ...group.states.flatMap((state) =>
                state.remoteRevision === null ? [] : [state.remoteRevision],
              ),
            );
            nextStates.push({
              trackId: deletion.trackId,
              contentHash,
              lineageHash: deletion.lineageHash,
              geometryVersion: deletion.geometryVersion,
              remoteRevision,
              pendingKind: 'delete',
            });
            if (
              latestOpenedTrackId === deletion.trackId ||
              group.pairs.some((pair) => pair.summary.id === latestOpenedTrackId)
            ) {
              await this.settings.delete('local-tracks.latest-opened');
            }
            continue;
          }

          const [canonical] = [...group.pairs].sort((left, right) => {
            if (left.summary.updatedAt !== right.summary.updatedAt) {
              return right.summary.updatedAt.localeCompare(left.summary.updatedAt);
            }
            if (left.summary.savedAt !== right.summary.savedAt) {
              return right.summary.savedAt.localeCompare(left.summary.savedAt);
            }
            return left.summary.id.localeCompare(right.summary.id);
          });
          if (canonical === undefined) continue;
          const remoteRevision = Math.max(
            0,
            ...group.states.flatMap((state) =>
              state.remoteRevision === null ? [] : [state.remoteRevision],
            ),
          );
          const pendingKind = pendingKindWithHighestPrecedence(group.states);
          const identity =
            [...group.states].sort(
              (left, right) => (right.remoteRevision ?? 0) - (left.remoteRevision ?? 0),
            )[0] ?? identitiesByTrackId.get(canonical.summary.id);
          if (identity === undefined) {
            throw new LocalTrackStorageError(
              'record-invalid',
              'The local track synchronization identity is unavailable.',
            );
          }
          const summary = {
            ...canonical.summary,
            contentHash,
            favorite: group.pairs.some((pair) => pair.summary.favorite),
            savedAt: group.pairs.reduce(
              (earliest, pair) =>
                pair.summary.savedAt < earliest ? pair.summary.savedAt : earliest,
              canonical.summary.savedAt,
            ),
          };
          nextPairs.push({ summary, content: canonical.content });
          nextStates.push({
            trackId: canonical.summary.id,
            contentHash,
            lineageHash: identity.lineageHash,
            geometryVersion: identity.geometryVersion,
            remoteRevision: sameAccount && remoteRevision !== 0 ? remoteRevision : null,
            pendingKind:
              !sameAccount ||
              group.states.length === 0 ||
              (remoteRevision === 0 && pendingKind === null)
                ? 'upsert'
                : pendingKind,
          });
          for (const pair of group.pairs) {
            if (pair.summary.id !== canonical.summary.id) {
              deleteTrackIds.add(pair.summary.id);
            }
          }
          for (const state of group.states) {
            if (state.trackId !== canonical.summary.id)
              deleteTrackIds.add(state.trackId);
          }
          if (
            latestOpenedTrackId !== null &&
            group.pairs.some((pair) => pair.summary.id === latestOpenedTrackId) &&
            latestOpenedTrackId !== canonical.summary.id
          ) {
            await this.settings.put({
              key: 'local-tracks.latest-opened',
              value: canonical.summary.id,
              updatedAt: new Date().toISOString(),
            });
          }
        }

        for (const trackId of deleteTrackIds) {
          await this.localTracks.delete(trackId);
          await this.localTrackContents.delete(trackId);
          await this.trackSyncStates.delete(trackId);
        }
        if (!sameAccount) await this.trackSyncStates.clear();
        for (const pair of nextPairs) {
          await this.localTracks.put(pair.summary);
          await this.localTrackContents.put(pair.content);
        }
        for (const state of nextStates) await this.trackSyncStates.put(state);
        const markers = (await this.savedMarkers.toArray())
          .map(parseSavedMarker)
          .filter((marker): marker is SavedMarker => marker !== null);
        const markerById = new Map(markers.map((marker) => [marker.id, marker]));
        const persistedMarkerStates = await this.markerSyncStates.toArray();
        const statesByMarkerId = new Map<string, MarkerSyncState>();
        if (sameAccount) {
          for (const candidate of persistedMarkerStates) {
            const state = markerSyncStateSchema.safeParse(candidate);
            if (state.success) statesByMarkerId.set(state.data.markerId, state.data);
          }
        }
        await this.markerSyncStates.clear();
        if (!sameAccount) {
          for (const marker of markers) {
            await this.markerSyncStates.put({
              markerId: marker.id,
              remoteRevision: null,
              pendingKind: 'upsert',
              localVersion: 1,
            });
          }
        } else {
          for (const marker of markers) {
            const state = statesByMarkerId.get(marker.id);
            if (state === undefined) {
              await this.markerSyncStates.put({
                markerId: marker.id,
                remoteRevision: null,
                pendingKind: 'upsert',
                localVersion: 1,
              });
            } else if (state.pendingKind === 'delete') {
              await this.markerSyncStates.put({
                ...state,
                pendingKind: 'upsert',
                localVersion: nextMarkerLocalVersion(state),
              });
            } else {
              await this.markerSyncStates.put(state);
            }
          }
          for (const state of statesByMarkerId.values()) {
            if (markerById.has(state.markerId)) continue;
            if (state.pendingKind === 'delete') {
              await this.markerSyncStates.put(state);
            } else if (
              state.pendingKind === 'upsert' &&
              state.remoteRevision !== null
            ) {
              await this.markerSyncStates.put({
                ...state,
                pendingKind: 'delete',
                localVersion: nextMarkerLocalVersion(state),
              });
            }
          }
        }
        signal?.throwIfAborted();
        if (!sameAccount) {
          const updatedAt = new Date().toISOString();
          await this.settings.put({
            key: 'sync.user-id',
            value: userId,
            updatedAt,
          });
          await this.settings.put({
            key: 'sync.usage',
            value: defaultTrackSyncUsage,
            updatedAt,
          });
        }
      },
    );
  }

  /** Validates and atomically applies one fully validated remote synchronization merge. */
  public async applyRemoteTrackMergeBatch(batch: RemoteTrackMergeBatch): Promise<void> {
    const usage = trackSyncUsageSchema.safeParse(batch.usage);
    if (!usage.success) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The track synchronization usage is invalid.',
      );
    }
    const states: TrackSyncState[] = [];
    for (const candidate of batch.states) {
      const state = parseTrackSyncState(candidate);
      if (state === null) {
        throw new LocalTrackStorageError(
          'record-invalid',
          'The track synchronization state is invalid.',
        );
      }
      states.push(state);
    }
    const expectedStates = new Map(
      (batch.expectedStates ?? []).map((state) => [state.trackId, state]),
    );
    const pairs: LocalTrackSyncPair[] = [];
    for (const pair of batch.put) {
      const summary = parseLocalTrackSummary(pair.summary);
      const content = parseLocalTrackContent(pair.content);
      const state = states.find((candidate) => candidate.trackId === pair.summary.id);
      if (
        summary?.contentHash === undefined ||
        content?.trackId !== summary.id ||
        state?.contentHash !== summary.contentHash
      ) {
        throw new LocalTrackStorageError(
          'record-invalid',
          'The local track record is invalid.',
        );
      }
      pairs.push({ summary, content });
    }
    const deletedTrackIds = new Set(batch.deleteTrackIds);
    if (pairs.some((pair) => deletedTrackIds.has(pair.summary.id))) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'A remote merge cannot delete and replace the same local track.',
      );
    }
    await this.transaction(
      'rw',
      this.settings,
      this.localTracks,
      this.localTrackContents,
      this.trackSyncStates,
      async () => {
        if (batch.expectedUserId !== undefined) {
          const owner = await this.settings.get('sync.user-id');
          if (owner?.value !== batch.expectedUserId) return;
        }
        const concurrentDeletions = new Map<string, TrackSyncState>();
        const concurrentUpdates = new Set<string>();
        batch.signal?.throwIfAborted();
        for (const state of states) {
          const [currentSummary, currentStateRecord] = await Promise.all([
            this.localTracks.get(state.trackId),
            this.trackSyncStates.get(state.trackId),
          ]);
          const currentState = parseTrackSyncState(currentStateRecord);
          const expectedState = expectedStates.get(state.trackId);
          if (
            currentSummary === undefined &&
            currentState?.pendingKind === 'delete' &&
            currentState.contentHash === state.contentHash
          ) {
            concurrentDeletions.set(state.trackId, currentState);
          } else if (
            currentSummary !== undefined &&
            currentState?.pendingKind !== null &&
            currentState?.pendingKind !== undefined &&
            expectedState !== undefined &&
            !equalTrackSyncStates(currentState, expectedState)
          ) {
            concurrentUpdates.add(state.trackId);
          }
        }
        for (const trackId of deletedTrackIds) {
          if (states.some((state) => state.trackId === trackId)) continue;
          const [currentSummary, currentStateRecord] = await Promise.all([
            this.localTracks.get(trackId),
            this.trackSyncStates.get(trackId),
          ]);
          const currentState = parseTrackSyncState(currentStateRecord);
          const expectedState = expectedStates.get(trackId);
          if (
            currentSummary !== undefined &&
            currentState?.pendingKind !== null &&
            currentState?.pendingKind !== undefined &&
            expectedState !== undefined &&
            !equalTrackSyncStates(currentState, expectedState)
          ) {
            concurrentUpdates.add(trackId);
          }
        }
        for (const trackId of deletedTrackIds) {
          if (concurrentUpdates.has(trackId)) deletedTrackIds.delete(trackId);
        }
        const latestOpened = await this.settings.get('local-tracks.latest-opened');
        if (
          typeof latestOpened?.value === 'string' &&
          deletedTrackIds.has(latestOpened.value) &&
          !pairs.some((pair) => pair.summary.id === latestOpened.value)
        ) {
          await this.settings.delete('local-tracks.latest-opened');
          batch.signal?.throwIfAborted();
        }
        batch.signal?.throwIfAborted();
        for (const trackId of deletedTrackIds) {
          await this.localTracks.delete(trackId);
          await this.localTrackContents.delete(trackId);
          await this.trackSyncStates.delete(trackId);
        }
        batch.signal?.throwIfAborted();
        for (const pair of pairs) {
          if (
            concurrentDeletions.has(pair.summary.id) ||
            concurrentUpdates.has(pair.summary.id)
          ) {
            continue;
          }
          await this.localTracks.put(pair.summary);
          await this.localTrackContents.put(pair.content);
        }
        batch.signal?.throwIfAborted();
        for (const state of states) {
          if (concurrentUpdates.has(state.trackId)) continue;
          const deletion = concurrentDeletions.get(state.trackId);
          if (deletion === undefined) {
            await this.trackSyncStates.put(state);
            continue;
          }
          const remoteRevision = Math.max(
            deletion.remoteRevision ?? 0,
            state.remoteRevision ?? 0,
          );
          await this.trackSyncStates.put({
            ...deletion,
            remoteRevision: remoteRevision === 0 ? null : remoteRevision,
          });
        }
        await this.settings.put({
          key: 'sync.usage',
          value: usage.data,
          updatedAt: new Date().toISOString(),
        });
      },
    );
  }

  /** Atomically applies a validated marker merge unless local intent changed. */
  public async applyRemoteMarkerMergeBatch(
    batch: RemoteMarkerMergeBatch,
  ): Promise<RemoteMarkerMergeResult> {
    if (batch.expectedUserId.length === 0 || batch.expectedUserId.length > 200) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The synchronization account identifier is invalid.',
      );
    }
    const markers = batch.put.map(validateSavedMarkerRecord);
    const states = batch.states.map((state) => {
      const parsed = markerSyncStateSchema.safeParse(state);
      if (!parsed.success) {
        throw new LocalTrackStorageError(
          'record-invalid',
          'The marker synchronization state is invalid.',
        );
      }
      return parsed.data;
    });
    const markerById = new Map(markers.map((marker) => [marker.id, marker]));
    const stateById = new Map(states.map((state) => [state.markerId, state]));
    const markerDeleteIds = new Set(batch.deleteMarkerIds);
    const stateDeleteIds = new Set(batch.deleteStateIds);
    const expectedById = new Map(
      batch.expected.map((expectation) => [expectation.markerId, expectation]),
    );
    const lists = [
      [markerById, markers.length],
      [markerDeleteIds, batch.deleteMarkerIds.length],
      [stateById, states.length],
      [stateDeleteIds, batch.deleteStateIds.length],
      [expectedById, batch.expected.length],
    ] as const;
    if (
      lists.some(([ids, length]) => ids.size !== length) ||
      ![...markerDeleteIds, ...stateDeleteIds].every(
        (id) => savedMarkerIdSchema.safeParse(id).success,
      ) ||
      [...markerById].some(([id]) => markerDeleteIds.has(id)) ||
      [...stateById].some(([id]) => stateDeleteIds.has(id))
    ) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The marker merge contains duplicate or conflicting identifiers.',
      );
    }
    const operationIds = new Set([
      ...markerById.keys(),
      ...markerDeleteIds,
      ...stateById.keys(),
      ...stateDeleteIds,
    ]);
    if (
      operationIds.size !== expectedById.size ||
      [...operationIds].some((id) => !expectedById.has(id))
    ) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The marker merge expectations do not match its operations.',
      );
    }
    for (const expectation of expectedById.values()) {
      const parsedState =
        expectation.state === null
          ? null
          : markerSyncStateSchema.safeParse(expectation.state);
      if (
        !savedMarkerIdSchema.safeParse(expectation.markerId).success ||
        (parsedState !== null &&
          (!parsedState.success || parsedState.data.markerId !== expectation.markerId))
      ) {
        throw new LocalTrackStorageError(
          'record-invalid',
          'The marker merge expectation is invalid.',
        );
      }
    }
    batch.signal?.throwIfAborted();
    return await this.transaction(
      'rw',
      this.settings,
      this.savedMarkers,
      this.markerSyncStates,
      async () => {
        const owner = await this.settings.get('sync.user-id');
        if (owner?.value !== batch.expectedUserId) return { changed: false };
        let changed = false;
        for (const markerId of operationIds) {
          const expectation = expectedById.get(markerId);
          if (expectation === undefined) continue;
          const current = markerSyncStateSchema.safeParse(
            await this.markerSyncStates.get(markerId),
          );
          if (
            !equalMarkerSyncStates(
              current.success ? current.data : null,
              expectation.state,
            )
          ) {
            continue;
          }
          batch.signal?.throwIfAborted();
          const marker = markerById.get(markerId);
          if (marker !== undefined) {
            const existing = parseSavedMarker(await this.savedMarkers.get(markerId));
            if (
              existing === null ||
              JSON.stringify(existing) !== JSON.stringify(marker)
            ) {
              await this.savedMarkers.put(marker);
              changed = true;
            }
          } else if (markerDeleteIds.has(markerId)) {
            if ((await this.savedMarkers.get(markerId)) !== undefined) {
              await this.savedMarkers.delete(markerId);
              changed = true;
            }
          }
          const state = stateById.get(markerId);
          if (state !== undefined) await this.markerSyncStates.put(state);
          else if (stateDeleteIds.has(markerId))
            await this.markerSyncStates.delete(markerId);
        }
        return { changed };
      },
    );
  }

  public async resolveRemoteDeletions(decision: {
    readonly expectedUserId: string;
    readonly trackCandidateIds: readonly string[];
    readonly markerCandidateIds: readonly string[];
    readonly tracks: {
      readonly deleteIds: readonly string[];
      readonly restoreIds: readonly string[];
    };
    readonly markers: {
      readonly deleteIds: readonly string[];
      readonly restoreIds: readonly string[];
    };
  }): Promise<void> {
    const validatePartition = (
      candidates: readonly string[],
      deleted: readonly string[],
      restored: readonly string[],
    ): boolean => {
      const candidateIds = new Set(candidates);
      const deletedIds = new Set(deleted);
      const restoredIds = new Set(restored);
      return (
        candidates.every((id) => savedMarkerIdSchema.safeParse(id).success) &&
        deleted.every((id) => savedMarkerIdSchema.safeParse(id).success) &&
        restored.every((id) => savedMarkerIdSchema.safeParse(id).success) &&
        candidateIds.size === candidates.length &&
        deletedIds.size === deleted.length &&
        restoredIds.size === restored.length &&
        ![...deletedIds].some((id) => restoredIds.has(id)) &&
        candidateIds.size === deletedIds.size + restoredIds.size &&
        [...candidateIds].every((id) => deletedIds.has(id) || restoredIds.has(id)) &&
        [...deletedIds, ...restoredIds].every((id) => candidateIds.has(id))
      );
    };
    if (
      decision.expectedUserId.length === 0 ||
      decision.expectedUserId.length > 200 ||
      !validatePartition(
        decision.trackCandidateIds,
        decision.tracks.deleteIds,
        decision.tracks.restoreIds,
      ) ||
      !validatePartition(
        decision.markerCandidateIds,
        decision.markers.deleteIds,
        decision.markers.restoreIds,
      )
    ) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The remote deletion decision is invalid.',
      );
    }
    await this.transaction(
      'rw',
      [
        this.settings,
        this.localTracks,
        this.localTrackContents,
        this.trackSyncStates,
        this.savedMarkers,
        this.markerSyncStates,
      ],
      async () => {
        const owner = await this.settings.get('sync.user-id');
        if (owner?.value !== decision.expectedUserId) {
          throw new LocalTrackStorageError(
            'record-invalid',
            'The synchronization account changed.',
          );
        }
        const trackRestores = new Map<
          string,
          { readonly summary: LocalTrackSummary; readonly state: TrackSyncState }
        >();
        const markerRestores = new Map<
          string,
          { readonly marker: SavedMarker; readonly state: MarkerSyncState }
        >();
        for (const trackId of decision.tracks.restoreIds) {
          const summary = parseLocalTrackSummary(await this.localTracks.get(trackId));
          const content = parseLocalTrackContent(
            await this.localTrackContents.get(trackId),
          );
          if (summary?.contentHash === undefined || content?.trackId !== trackId) {
            throw new LocalTrackStorageError(
              'content-missing',
              'The saved track content is unavailable.',
            );
          }
          const existing = parseTrackSyncState(await this.trackSyncStates.get(trackId));
          trackRestores.set(trackId, {
            summary,
            state: {
              trackId,
              contentHash: summary.contentHash,
              lineageHash:
                existing?.contentHash === summary.contentHash
                  ? existing.lineageHash
                  : summary.contentHash,
              geometryVersion:
                existing?.contentHash === summary.contentHash
                  ? existing.geometryVersion
                  : 2,
              remoteRevision: existing?.remoteRevision ?? null,
              pendingKind: 'upsert',
            },
          });
        }
        for (const markerId of decision.markers.restoreIds) {
          const marker = parseSavedMarker(await this.savedMarkers.get(markerId));
          if (marker === null) {
            throw new SavedMarkerStorageError(
              'not-found',
              'The saved marker was not found.',
            );
          }
          const existing = markerSyncStateSchema.safeParse(
            await this.markerSyncStates.get(markerId),
          );
          markerRestores.set(markerId, {
            marker,
            state: {
              markerId,
              remoteRevision: null,
              pendingKind: 'upsert',
              localVersion: nextMarkerLocalVersion(
                existing.success ? existing.data : null,
              ),
            },
          });
        }
        const latestOpened = await this.settings.get('local-tracks.latest-opened');
        if (
          typeof latestOpened?.value === 'string' &&
          decision.tracks.deleteIds.includes(latestOpened.value)
        ) {
          await this.settings.delete('local-tracks.latest-opened');
        }
        for (const trackId of decision.tracks.deleteIds) {
          await this.localTracks.delete(trackId);
          await this.localTrackContents.delete(trackId);
          await this.trackSyncStates.delete(trackId);
        }
        for (const markerId of decision.markers.deleteIds) {
          await this.savedMarkers.delete(markerId);
          await this.markerSyncStates.delete(markerId);
        }
        for (const { state } of trackRestores.values()) {
          await this.trackSyncStates.put(state);
        }
        for (const { state } of markerRestores.values()) {
          await this.markerSyncStates.put(state);
        }
      },
    );
  }

  public async loadTrackSyncEnabled(): Promise<boolean> {
    const record = await this.settings.get('sync.enabled');
    if (record === undefined) return false;
    const parsed = trackSyncEnabledSchema.safeParse(record.value);
    if (parsed.success) return parsed.data;
    await this.settings.delete('sync.enabled');
    this.logger.log({
      level: 'warn',
      name: 'storage.sync-preferences.repaired',
      data: { reason: 'schema-invalid' },
    });
    return false;
  }

  public async saveTrackSyncEnabled(enabled: boolean): Promise<void> {
    await this.settings.put({
      key: 'sync.enabled',
      value: trackSyncEnabledSchema.parse(enabled),
      updatedAt: new Date().toISOString(),
    });
  }

  public async loadTrackSyncUsage(): Promise<TrackSyncUsage> {
    const record = await this.settings.get('sync.usage');
    if (record === undefined) return defaultTrackSyncUsage;
    const parsed = trackSyncUsageSchema.safeParse(record.value);
    if (parsed.success) return parsed.data;
    await this.settings.delete('sync.usage');
    this.logger.log({
      level: 'warn',
      name: 'storage.sync-usage.repaired',
      data: { reason: 'schema-invalid' },
    });
    return defaultTrackSyncUsage;
  }

  public async saveTrackSyncUsage(usage: TrackSyncUsage): Promise<void> {
    await this.settings.put({
      key: 'sync.usage',
      value: trackSyncUsageSchema.parse(usage),
      updatedAt: new Date().toISOString(),
    });
  }

  public async loadUiPreferences(): Promise<UiPreferences> {
    const record = await this.settings.get('ui.preferences');
    if (record === undefined) {
      return defaultUiPreferences;
    }

    const parsed = uiPreferencesSchema.safeParse(record.value);
    if (!parsed.success) {
      await this.settings.delete('ui.preferences');
      this.logger.log({
        level: 'warn',
        name: 'storage.settings.repaired',
        data: { reason: 'schema-invalid' },
      });
      return defaultUiPreferences;
    }

    return parsed.data;
  }

  public async saveUiPreferences(value: UiPreferences): Promise<void> {
    const parsed = uiPreferencesSchema.parse(value);
    await this.settings.put({
      key: 'ui.preferences',
      value: parsed,
      updatedAt: new Date().toISOString(),
    });
  }

  public async saveElevationGradeLegendDismissed(
    elevationGradeLegendDismissed: boolean,
  ): Promise<void> {
    const preferences = await this.loadUiPreferences();
    await this.saveUiPreferences({
      ...preferences,
      elevationGradeLegendDismissed,
    });
  }

  public async loadMaximumCloudCoverPercent(): Promise<number> {
    const record = await this.settings.get('satellite.maximum-cloud-cover');
    if (record === undefined) return defaultMaximumCloudCoverPercent;

    const parsed = maximumCloudCoverPercentSchema.safeParse(record.value);
    if (parsed.success) return parsed.data;

    await this.settings.delete('satellite.maximum-cloud-cover');
    this.logger.log({
      level: 'warn',
      name: 'storage.satellite-preferences.repaired',
      data: { reason: 'schema-invalid' },
    });
    return defaultMaximumCloudCoverPercent;
  }

  public async saveMaximumCloudCoverPercent(value: number): Promise<void> {
    const parsed = maximumCloudCoverPercentSchema.parse(value);
    await this.settings.put({
      key: 'satellite.maximum-cloud-cover',
      value: parsed,
      updatedAt: new Date().toISOString(),
    });
  }

  public async loadMapLayerPreferences(): Promise<PersistedMapLayerPreferences> {
    const record = await this.settings.get('map.layers');
    if (record === undefined) return defaultMapLayerPreferences;

    const storedValue =
      typeof record.value === 'object' && record.value !== null
        ? (record.value as Record<string, unknown>)
        : null;
    const storedVisibility = storedValue?.visibility;
    const hadLegacyScene =
      storedValue !== null && Object.hasOwn(storedValue, 'appliedScene');
    const missingStaticBasemapPreference =
      typeof storedVisibility !== 'object' ||
      storedVisibility === null ||
      !Object.hasOwn(storedVisibility, 'google-satellite') ||
      !Object.hasOwn(storedVisibility, 'napr-orthophoto');
    const parsed = mapLayerPreferencesSchema.safeParse(
      withoutLegacyAppliedScene(record.value),
    );
    if (parsed.success) {
      if (hadLegacyScene || missingStaticBasemapPreference) {
        await this.saveMapLayerPreferences(parsed.data);
      }
      return parsed.data;
    }

    await this.settings.delete('map.layers');
    this.logger.log({
      level: 'warn',
      name: 'storage.map-layers.repaired',
      data: { reason: 'schema-invalid' },
    });
    return defaultMapLayerPreferences;
  }

  public async saveMapLayerPreferences(
    value: PersistedMapLayerPreferences,
  ): Promise<void> {
    const parsed = mapLayerPreferencesSchema.parse(value);
    await this.settings.put({
      key: 'map.layers',
      value: parsed,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Loads the last 2D camera while accepting the two previous local record versions. */
  public async load(): Promise<MapCamera | null> {
    const record = await this.settings.get(mapCameraKey);
    if (record === undefined) return null;

    const camera = readPersistedCamera(record.value);
    if (camera !== null) return camera;

    await this.settings.delete(mapCameraKey);
    this.logger.log({
      level: 'warn',
      name: 'storage.map-camera.repaired',
      data: { reason: 'schema-invalid' },
    });
    return null;
  }

  /** Stores only the settled 2D position; 3D orientation remains session-only. */
  public async save(camera: MapCamera): Promise<void> {
    const normalized = normalizeMapCamera(camera);
    if (normalized === null) {
      throw new Error('Map camera contains non-finite values.');
    }

    await this.settings.put({
      key: mapCameraKey,
      value: {
        schemaVersion: 3,
        camera: {
          longitude: normalized.longitude,
          latitude: normalized.latitude,
          zoom: normalized.zoom,
        },
      } satisfies PersistedMapView,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Performs a temporary write/read/delete cycle without retaining health-check data. */
  public async probe(): Promise<void> {
    const key = '__healthcheck__';
    await this.settings.put({ key, value: true, updatedAt: new Date().toISOString() });
    await this.settings.get(key);
    await this.settings.delete(key);
  }
}
