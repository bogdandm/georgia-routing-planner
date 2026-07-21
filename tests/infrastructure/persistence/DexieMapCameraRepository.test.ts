import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DexieMapCameraRepository } from '@/infrastructure/persistence/DexieMapCameraRepository';
import { createTestServices } from '@test/helpers/createTestServices';

const camera = {
  longitude: 44.8,
  latitude: 41.7,
  zoom: 9,
  bearing: 12,
  pitch: 35,
};

let services: ReturnType<typeof createTestServices>;
let repository: DexieMapCameraRepository;

beforeEach(async () => {
  services = createTestServices();
  await services.database.delete();
  await services.database.open();
  repository = new DexieMapCameraRepository(
    services.database,
    services.clock,
    services.logger,
  );
});

afterEach(async () => {
  services.database.close();
  await services.database.delete();
});

describe('DexieMapCameraRepository', () => {
  it('stores only a versioned 2D position and clamps it to supported ranges', async () => {
    await repository.save({
      ...camera,
      longitude: 500,
      latitude: -100,
      zoom: 30,
      bearing: -500,
      pitch: 100,
    });

    await expect(repository.load()).resolves.toEqual({
      longitude: 180,
      latitude: -85,
      zoom: 20,
      bearing: 0,
      pitch: 0,
    });
    await expect(services.database.settings.get('map.camera')).resolves.toEqual(
      expect.objectContaining({
        value: {
          schemaVersion: 3,
          camera: { longitude: 180, latitude: -85, zoom: 20 },
        },
      }),
    );
  });

  it.each([
    { schemaVersion: 1, camera },
    { schemaVersion: 2, camera, terrainMode: 'terrain' },
  ])('loads legacy schema $schemaVersion as a flat camera', async (value) => {
    await services.database.settings.put({
      key: 'map.camera',
      value,
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(repository.load()).resolves.toEqual({
      longitude: camera.longitude,
      latitude: camera.latitude,
      zoom: camera.zoom,
      bearing: 0,
      pitch: 0,
    });
  });

  it('repairs only a corrupt camera record and emits one bounded warning', async () => {
    await services.database.settings.put({
      key: 'map.camera',
      value: { schemaVersion: 1, camera: { ...camera, zoom: Number.NaN } },
      updatedAt: '2026-07-18T00:00:00.000Z',
    });
    await services.database.settings.put({
      key: 'unrelated.setting',
      value: true,
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(repository.load()).resolves.toBeNull();
    await expect(services.database.settings.get('map.camera')).resolves.toBeUndefined();
    await expect(
      services.database.settings.get('unrelated.setting'),
    ).resolves.toBeDefined();
    expect(
      services.logger
        .getEvents()
        .filter((event) => event.name === 'storage.map-camera.repaired'),
    ).toHaveLength(1);
  });

  it('surfaces storage read and write failures to the caller', async () => {
    vi.spyOn(services.database.settings, 'get').mockRejectedValueOnce(
      new Error('read unavailable'),
    );
    await expect(repository.load()).rejects.toThrow('read unavailable');

    vi.spyOn(services.database.settings, 'put').mockRejectedValueOnce(
      new Error('write unavailable'),
    );
    await expect(repository.save(camera)).rejects.toThrow('write unavailable');
  });
});
