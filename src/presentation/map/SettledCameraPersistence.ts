import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type {
  MapCamera,
  MapCameraRepository,
} from '@/application/ports/MapCameraRepository';

/**
 * Coalesces settled camera updates and serializes writes so an older slow save cannot
 * overwrite a newer camera. Only the most recent pending camera is retained.
 */
export class SettledCameraPersistence {
  #pendingCamera: MapCamera | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #saving: Promise<void> = Promise.resolve();

  public constructor(
    private readonly repository: MapCameraRepository,
    private readonly logger: DiagnosticLogger,
    private readonly onFailure: () => void,
    private readonly debounceMs = 400,
  ) {}

  /** Schedules the latest settled camera without extending an active debounce window. */
  public schedule(camera: MapCamera): void {
    this.#pendingCamera = camera;
    if (this.#timer !== null) {
      return;
    }

    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Flushes the current camera after prior saves and converts storage errors to diagnostics. */
  public async flush(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    const camera = this.#pendingCamera;
    this.#pendingCamera = null;
    if (camera === null) {
      await this.#saving;
      return;
    }

    this.#saving = this.#saving.then(async () => {
      try {
        await this.repository.save(camera);
      } catch {
        this.logger.log({ level: 'warn', name: 'storage.map-camera.save-failed' });
        this.onFailure();
      }
    });
    await this.#saving;
  }

  /** Starts a final best-effort flush; React teardown is intentionally not blocked on storage. */
  public destroy(): void {
    void this.flush();
  }
}
