import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MapCamera,
  MapCameraRepository,
  MapViewState,
} from '@/application/ports/MapCameraRepository';
import { SettledCameraPersistence } from '@/presentation/map/SettledCameraPersistence';
import { createTestServices } from '@test/helpers/createTestServices';

const camera: MapCamera = {
  longitude: 44.8,
  latitude: 41.7,
  zoom: 9,
  bearing: 12,
  pitch: 35,
};
const view: MapViewState = { camera, terrainMode: 'terrain' };

afterEach(() => {
  vi.useRealTimers();
});

describe('SettledCameraPersistence', () => {
  it('coalesces settled camera events and flushes the final value', async () => {
    vi.useFakeTimers();
    const save = vi.fn((_view: MapViewState) => Promise.resolve());
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

    persistence.schedule(view);
    persistence.schedule({ ...view, camera: { ...camera, zoom: 11 } });
    await vi.advanceTimersByTimeAsync(400);
    await persistence.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ ...view, camera: { ...camera, zoom: 11 } });
  });

  it('stores provisional flat views as 3D until pending startup terrain settles', async () => {
    const save = vi.fn((_view: MapViewState) => Promise.resolve());
    const persistence = new SettledCameraPersistence(
      { load: () => Promise.resolve(null), save },
      createTestServices().logger,
      vi.fn(),
    );
    const flatView: MapViewState = { camera, terrainMode: 'flat' };

    persistence.setStartupTerrainPending(true);
    persistence.schedule(flatView);
    await persistence.flush();
    persistence.setStartupTerrainPending(false);
    persistence.schedule(flatView);
    await persistence.flush();

    expect(save.mock.calls.map(([saved]) => saved.terrainMode)).toEqual([
      'terrain',
      'flat',
    ]);
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

    persistence.schedule(view);
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
