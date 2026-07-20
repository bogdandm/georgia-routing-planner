import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  normalizeMapCamera,
  type MapCameraRepository,
  type MapViewState,
} from '@/application/ports/MapCameraRepository';
import type { AppDatabase } from '@/infrastructure/persistence/AppDatabase';

const mapCameraKey = 'map.camera';

interface PersistedMapView {
  readonly schemaVersion: 2;
  readonly camera: unknown;
  readonly terrainMode: unknown;
}

function readPersistedView(value: unknown): MapViewState | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const camera = normalizeMapCamera(candidate.camera);
  if (camera === null) return null;
  if (candidate.schemaVersion === 1) {
    return { camera, terrainMode: camera.pitch > 0 ? 'terrain' : 'flat' };
  }
  if (
    candidate.schemaVersion !== 2 ||
    (candidate.terrainMode !== 'flat' && candidate.terrainMode !== 'terrain')
  ) {
    return null;
  }
  return { camera, terrainMode: candidate.terrainMode };
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

  public async load(): Promise<MapViewState | null> {
    const record = await this.database.settings.get(mapCameraKey);
    if (record === undefined) {
      return null;
    }

    const view = readPersistedView(record.value);
    if (view !== null) {
      return view;
    }

    await this.database.settings.delete(mapCameraKey);
    this.logger.log({
      level: 'warn',
      name: 'storage.map-camera.repaired',
      data: { reason: 'schema-invalid' },
    });
    return null;
  }

  public async save(view: MapViewState): Promise<void> {
    const normalized = normalizeMapCamera(view.camera);
    if (normalized === null) {
      throw new Error('Map camera contains non-finite values.');
    }

    await this.database.settings.put({
      key: mapCameraKey,
      value: {
        schemaVersion: 2,
        camera: normalized,
        terrainMode: view.terrainMode,
      } satisfies PersistedMapView,
      updatedAt: this.clock.now().toISOString(),
    });
  }
}
