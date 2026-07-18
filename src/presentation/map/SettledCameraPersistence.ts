import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type {
  MapCamera,
  MapCameraRepository,
} from '@/application/ports/MapCameraRepository';

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

  public destroy(): void {
    void this.flush();
  }
}
