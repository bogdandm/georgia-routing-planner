import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MapCamera,
  MapCameraRepository,
} from '@/application/ports/MapCameraRepository';
import { SettledCameraPersistence } from '@/presentation/map/SettledCameraPersistence';
import { createTestServices } from '../../../test/helpers/createTestServices';

const camera: MapCamera = {
  longitude: 44.8,
  latitude: 41.7,
  zoom: 9,
  bearing: 12,
  pitch: 35,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('SettledCameraPersistence', () => {
  it('coalesces settled camera events and flushes the final value', async () => {
    vi.useFakeTimers();
    const save = vi.fn((_camera: MapCamera) => Promise.resolve());
    const repository: MapCameraRepository = {
      load: () => Promise.resolve(null),
      save,
    };
    const services = createTestServices();
    const persistence = new SettledCameraPersistence(
      repository,
      services.logger,
      vi.fn(),
      400,
    );

    persistence.schedule(camera);
    persistence.schedule({ ...camera, zoom: 11 });
    await vi.advanceTimersByTimeAsync(400);
    await persistence.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ ...camera, zoom: 11 });
  });

  it('keeps camera interaction usable and reports a failed write', async () => {
    const repository: MapCameraRepository = {
      load: () => Promise.resolve(null),
      save: () => Promise.reject(new Error('quota exceeded')),
    };
    const services = createTestServices();
    const onFailure = vi.fn();
    const persistence = new SettledCameraPersistence(
      repository,
      services.logger,
      onFailure,
    );

    persistence.schedule(camera);
    await persistence.flush();

    expect(onFailure).toHaveBeenCalledOnce();
    expect(
      services.logger
        .getEvents()
        .map((event) => event.name)
        .includes('storage.map-camera.save-failed'),
    ).toBe(true);
  });
});
