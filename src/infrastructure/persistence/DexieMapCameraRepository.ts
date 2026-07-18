import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  normalizeMapCamera,
  type MapCamera,
  type MapCameraRepository,
} from '@/application/ports/MapCameraRepository';
import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';

const mapCameraKey = 'map.camera';

interface PersistedMapCamera {
  readonly schemaVersion: 1;
  readonly camera: unknown;
}

function readPersistedCamera(value: unknown): MapCamera | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Partial<PersistedMapCamera>;
  if (candidate.schemaVersion !== 1) {
    return null;
  }

  return normalizeMapCamera(candidate.camera);
}

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
      value: { schemaVersion: 1, camera: normalized } satisfies PersistedMapCamera,
      updatedAt: this.clock.now().toISOString(),
    });
  }
}
