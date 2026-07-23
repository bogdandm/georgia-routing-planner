import Dexie, { type EntityTable } from 'dexie';
import { z } from 'zod';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
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
  LOCAL_TRACK_SCHEMA_VERSION,
  normalizeLocalTrackDescription,
  normalizeLocalTrackName,
  type LocalTrackContent,
  type LocalTrackSummary,
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

const uiPreferencesSchema = z
  .object({
    developerMode: z.boolean(),
    navigationCollapsed: z.boolean().default(false),
  })
  .strict();

interface UiPreferences {
  readonly developerMode: boolean;
  readonly navigationCollapsed: boolean;
}

const defaultUiPreferences: UiPreferences = {
  developerMode: false,
  navigationCollapsed: false,
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
        'satellite-imagery': z.boolean(),
        'scene-footprint': z.boolean(),
        'terrain-relief': z.boolean().default(true),
        'elevation-isolines': z.boolean().default(true),
        'natural-features': z.boolean().default(true),
        'restricted-areas': z.boolean().default(true),
        'hiking-paths': z.boolean(),
        roads: z.boolean(),
        'places-and-pois': z.boolean(),
        'imported-tracks': z.boolean().default(true),
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
    'satellite-imagery': true,
    'scene-footprint': true,
    'terrain-relief': true,
    'elevation-isolines': true,
    'natural-features': true,
    'restricted-areas': true,
    'hiking-paths': true,
    roads: true,
    'places-and-pois': true,
    'imported-tracks': true,
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
    elevationSource: z.literal('gpx').optional(),
    elevationAlgorithmVersion: z.literal(1).optional(),
  })
  .strict()
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

const localTrackSummarySchema = z
  .object({
    schemaVersion: z.literal(LOCAL_TRACK_SCHEMA_VERSION),
    id: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    normalizedName: z.string().min(1).max(200),
    savedAt: z.iso.datetime(),
    sourceFilename: z.string().min(1).max(500),
    sourceFormat: z.enum(['gpx', 'fit', 'kml']).default('gpx'),
    description: z.string().max(10_000).default(''),
    favorite: z.boolean().default(false),
    elevationFilterMeters: z.number().min(0).max(50).default(3),
    geometryKind: z.enum(['track', 'route']),
    pointCount: z.number().int().min(2).max(100_000),
    segmentCount: z.number().int().min(1).max(512),
    metrics: trackMetricsSchema,
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
      sourceFilename: value.sourceFilename,
      sourceFormat: value.sourceFormat,
      description: value.description,
      favorite: value.favorite,
      elevationFilterMeters: value.elevationFilterMeters,
      geometryKind: value.geometryKind,
      pointCount: value.pointCount,
      segmentCount: value.segmentCount,
      metrics: value.metrics,
      metadata: value.metadata,
      warnings: value.warnings,
    };
    if (value.generatedName !== undefined) result.generatedName = value.generatedName;
    if (value.middleAnchorKind !== undefined) {
      result.middleAnchorKind = value.middleAnchorKind;
    }
    if (value.startPoi !== undefined) result.startPoi = value.startPoi;
    if (value.middlePoi !== undefined) result.middlePoi = value.middlePoi;
    if (value.endPoi !== undefined) result.endPoi = value.endPoi;
    if (value.fallbackPoi !== undefined) result.fallbackPoi = value.fallbackPoi;
    return result;
  });

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

const currentLocalTrackContentSchema: z.ZodType<LocalTrackContent> = z
  .object({
    schemaVersion: z.literal(LOCAL_TRACK_SCHEMA_VERSION),
    trackId: z.string().min(1).max(200),
    trackPoints: storedTrackSegmentsSchema,
    reliefElevations: z.array(z.array(z.number()).min(2)).min(1).max(512).optional(),
    elevationSource: z.enum(['source', 'relief']).default('source'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reliefElevations === undefined) {
      if (value.elevationSource === 'relief') {
        context.addIssue({
          code: 'custom',
          message: 'Relief elevation values are required for the relief source.',
        });
      }
      return;
    }
    const aligned =
      value.reliefElevations.length === value.trackPoints.length &&
      value.reliefElevations.every(
        (segment, index) => segment.length === value.trackPoints[index]?.length,
      );
    if (!aligned) {
      context.addIssue({
        code: 'custom',
        message: 'Relief elevation values must align with source track points.',
      });
    }
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
    schemaVersion: value.schemaVersion,
    trackId: value.trackId,
    trackPoints:
      value.trackPoints ??
      value.segments.map((segment) => segment.map((coordinate) => ({ coordinate }))),
    elevationSource: 'source',
  }));

const localTrackContentSchema: z.ZodType<LocalTrackContent> = z.union([
  currentLocalTrackContentSchema,
  legacyLocalTrackContentSchema,
]);

function parseLocalTrackSummary(value: unknown): LocalTrackSummary | null {
  const result = localTrackSummarySchema.safeParse(value);
  return result.success ? result.data : null;
}

function parseLocalTrackContent(value: unknown): LocalTrackContent | null {
  const result = localTrackContentSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Owns the versioned IndexedDB schema and validates values crossing storage boundaries. */
export class AppDatabase
  extends Dexie
  implements MapLayerPreferencesRepository, MapCameraRepository, LocalTrackRepository
{
  public readonly settings!: EntityTable<SettingRecord, 'key'>;
  public readonly diagnostics!: EntityTable<PersistedDiagnosticRecord, 'id'>;
  public readonly localTracks!: EntityTable<LocalTrackSummary, 'id'>;
  public readonly localTrackContents!: EntityTable<LocalTrackContent, 'trackId'>;

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
    this.version(3)
      .stores({
        settings: 'key,updatedAt',
        diagnostics: '++id,timestamp,name,level',
        localTracks: 'id,normalizedName,savedAt',
        localTrackContents: 'trackId',
      })
      .upgrade(async (transaction) => {
        const table = transaction.table('localTrackContents');
        const records: unknown[] = await table.toArray();
        for (const record of records) {
          const parsed = parseLocalTrackContent(record);
          if (parsed !== null) await table.put(parsed);
        }
      });
  }

  public async saveLocalTrack(
    summary: LocalTrackSummary,
    content: LocalTrackContent,
  ): Promise<void> {
    const validSummary = parseLocalTrackSummary(summary);
    const validContent = parseLocalTrackContent(content);
    const idsMatch = validSummary?.id === validContent?.trackId;
    if (validSummary === null || validContent === null || !idsMatch) {
      throw new LocalTrackStorageError(
        'record-invalid',
        'The local track record is invalid.',
      );
    }
    await this.transaction(
      'rw',
      this.localTracks,
      this.localTrackContents,
      async () => {
        await this.localTracks.put(validSummary);
        await this.localTrackContents.put(validContent);
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
    const existing = await this.localTracks.get(trackId);
    const parsed = parseLocalTrackSummary(existing);
    if (parsed === null) {
      throw new LocalTrackStorageError('not-found', 'The saved track was not found.');
    }
    const normalized = normalizeLocalTrackName(name);
    const updated = { ...parsed, ...normalized };
    await this.localTracks.put(updated);
    return updated;
  }

  public async updateLocalTrackMetadata(
    trackId: string,
    changes: {
      readonly description?: string;
      readonly favorite?: boolean;
      readonly elevationFilterMeters?: number;
    },
  ): Promise<LocalTrackSummary> {
    const existing = await this.localTracks.get(trackId);
    const parsed = parseLocalTrackSummary(existing);
    if (parsed === null) {
      throw new LocalTrackStorageError('not-found', 'The saved track was not found.');
    }
    const updated: LocalTrackSummary = {
      ...parsed,
      description:
        changes.description === undefined
          ? parsed.description
          : normalizeLocalTrackDescription(changes.description),
      favorite: changes.favorite ?? parsed.favorite,
      elevationFilterMeters:
        changes.elevationFilterMeters ?? parsed.elevationFilterMeters,
    };
    await this.localTracks.put(updated);
    return updated;
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
      async () => {
        await this.localTrackContents.delete(trackId);
        await this.localTracks.delete(trackId);
        const latest = await this.settings.get('local-tracks.latest-opened');
        if (latest?.value === trackId) {
          await this.settings.delete('local-tracks.latest-opened');
        }
      },
    );
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

    const hadLegacyScene =
      typeof record.value === 'object' &&
      record.value !== null &&
      Object.hasOwn(record.value, 'appliedScene');
    const parsed = mapLayerPreferencesSchema.safeParse(
      withoutLegacyAppliedScene(record.value),
    );
    if (parsed.success) {
      if (hadLegacyScene) {
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
