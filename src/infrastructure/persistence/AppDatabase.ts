import Dexie, { type EntityTable } from 'dexie';
import { z } from 'zod';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type {
  MapLayerPreferencesRepository,
  PersistedMapLayerPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';
import { defaultSatelliteRenderingTuning } from '@/application/ports/MapLayerPreferencesRepository';
import { defaultTerrainOverlayPreferences } from '@/application/ports/MapLayerPreferencesRepository';

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

export interface UiPreferences {
  readonly developerMode: boolean;
  readonly navigationCollapsed: boolean;
}

const defaultUiPreferences: UiPreferences = {
  developerMode: false,
  navigationCollapsed: false,
};

const positionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const ringSchema = z.array(positionSchema).min(4).max(20_000);
const polygonCoordinatesSchema = z.array(ringSchema).min(1).max(256);
const footprintSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: polygonCoordinatesSchema }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(polygonCoordinatesSchema).min(1).max(256),
  }),
]);
const visualAssetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sentinel-rgb-cogs'),
    itemHref: z.url().refine((value) => value.startsWith('https://')),
    redHref: z.url().refine((value) => value.startsWith('https://')),
    greenHref: z.url().refine((value) => value.startsWith('https://')),
    blueHref: z.url().refine((value) => value.startsWith('https://')),
    projectionEpsg: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('unsupported-jp2'),
    href: z.url().refine((value) => value.startsWith('https://')),
    mediaType: z.string().min(1).max(160),
    projectionEpsg: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('unavailable') }),
]);
const satelliteSceneSchema = z
  .object({
    id: z.string().min(1).max(300),
    collection: z.string().min(1).max(120),
    platform: z.string().min(1).max(120),
    productLevel: z.enum(['L1C', 'L2A']),
    acquiredAt: z.iso.datetime({ offset: true }),
    cloudCoverPercent: z.number().min(0).max(100),
    footprint: footprintSchema,
    tileId: z.string().max(120).nullable(),
    orbit: z.string().max(120).nullable(),
    productId: z.string().max(500).nullable(),
    thumbnailHref: z
      .url()
      .refine((value) => value.startsWith('https://'))
      .nullable(),
    visualAsset: visualAssetSchema,
    attribution: z.string().min(1).max(500),
  })
  .strict();
const mapLayerPreferencesSchema = z
  .object({
    visibility: z
      .object({
        'satellite-imagery': z.boolean(),
        'scene-footprint': z.boolean(),
        'terrain-relief': z.boolean().default(true),
        'elevation-isolines': z.boolean().default(true),
        'hiking-paths': z.boolean(),
        roads: z.boolean(),
        'places-and-pois': z.boolean(),
      })
      .strict(),
    appliedScene: satelliteSceneSchema.nullable(),
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
        shadeAboveSatellite: z.boolean(),
      })
      .default(defaultTerrainOverlayPreferences),
  })
  .strict();

const defaultMapLayerPreferences: PersistedMapLayerPreferences = {
  visibility: {
    'satellite-imagery': true,
    'scene-footprint': true,
    'terrain-relief': true,
    'elevation-isolines': true,
    'hiking-paths': true,
    roads: true,
    'places-and-pois': true,
  },
  appliedScene: null,
  renderingTuning: defaultSatelliteRenderingTuning,
  terrainOverlays: defaultTerrainOverlayPreferences,
};

/** Owns the versioned IndexedDB schema and validates values crossing storage boundaries. */
export class AppDatabase extends Dexie implements MapLayerPreferencesRepository {
  public readonly settings!: EntityTable<SettingRecord, 'key'>;
  public readonly diagnostics!: EntityTable<PersistedDiagnosticRecord, 'id'>;

  public constructor(private readonly logger: DiagnosticLogger) {
    super('GeorgiaRoutingPlanner');
    this.version(1).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
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

  public async loadMapLayerPreferences(): Promise<PersistedMapLayerPreferences> {
    const record = await this.settings.get('map.layers');
    if (record === undefined) return defaultMapLayerPreferences;

    const parsed = mapLayerPreferencesSchema.safeParse(record.value);
    if (parsed.success) return parsed.data;

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

  /** Performs a temporary write/read/delete cycle without retaining health-check data. */
  public async probe(): Promise<void> {
    const key = '__healthcheck__';
    await this.settings.put({ key, value: true, updatedAt: new Date().toISOString() });
    await this.settings.get(key);
    await this.settings.delete(key);
  }
}
