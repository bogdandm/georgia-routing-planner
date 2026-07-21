import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  normalizeMapCamera,
  type MapCamera,
  type MapCameraRepository,
} from '@/application/ports/MapCameraRepository';
import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';

const mapCameraKey = 'map.camera';

interface PersistedMapView {
  readonly schemaVersion: 3;
  readonly camera: Pick<MapCamera, 'longitude' | 'latitude' | 'zoom'>;
}

function readPersistedCamera(value: unknown): MapCamera | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const storedCamera =
    candidate.schemaVersion === 3 &&
    typeof candidate.camera === 'object' &&
    candidate.camera !== null
      ? { ...(candidate.camera as Record<string, unknown>), bearing: 0, pitch: 0 }
      : candidate.camera;
  const camera = normalizeMapCamera(storedCamera);
  if (camera === null) return null;
  if (![1, 2, 3].includes(candidate.schemaVersion as number)) {
    return null;
  }
  return { ...camera, bearing: 0, pitch: 0 };
}

/**
 * Stores the versioned map-view record in the shared settings table and repairs invalid
 * records by removing them before returning the defaultable `null` result.
 */
export class DexieMapCameraRepository implements MapCameraRepository {
  public constructor(
    private readonly database: AppDatabase,
    private readonly clock: Clock,
    private readonly logger: DiagnosticLogger,
  ) {}

  public async load(): Promise<MapCamera | null> {
    const record = await this.database.settings.get(mapCameraKey);
    if (record === undefined) {
      return null;
    }

    const camera = readPersistedCamera(record.value);
    if (camera !== null) {
      return camera;
    }

    await this.database.settings.delete(mapCameraKey);
    this.logger.log({
      level: 'warn',
      name: 'storage.map-camera.repaired',
      data: { reason: 'schema-invalid' },
    });
    return null;
  }

  public async save(camera: MapCamera): Promise<void> {
    const normalized = normalizeMapCamera(camera);
    if (normalized === null) {
      throw new Error('Map camera contains non-finite values.');
    }

    await this.database.settings.put({
      key: mapCameraKey,
      value: {
        schemaVersion: 3,
        camera: {
          longitude: normalized.longitude,
          latitude: normalized.latitude,
          zoom: normalized.zoom,
        },
      } satisfies PersistedMapView,
      updatedAt: this.clock.now().toISOString(),
    });
  }
}
