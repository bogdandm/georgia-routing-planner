import Dexie, { type EntityTable } from 'dexie';
import { z } from 'zod';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
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
      })
      .strict(),
    openStreetMapOpacity: z.number().min(0).max(1).default(1),
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
  },
  openStreetMapOpacity: 1,
  satelliteRenderingMode: defaultSatelliteRenderingMode,
  renderingTuning: defaultSatelliteRenderingTuning,
  terrainOverlays: defaultTerrainOverlayPreferences,
};

/** Owns the versioned IndexedDB schema and validates values crossing storage boundaries. */
export class AppDatabase
  extends Dexie
  implements MapLayerPreferencesRepository, MapCameraRepository
{
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
