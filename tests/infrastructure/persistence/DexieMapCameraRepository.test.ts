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
  it('stores a versioned camera and clamps it to supported MapLibre ranges', async () => {
    await repository.save({
      camera: {
        ...camera,
        longitude: 500,
        latitude: -100,
        zoom: 30,
        bearing: -500,
        pitch: 100,
      },
      terrainMode: 'terrain',
    });

    await expect(repository.load()).resolves.toEqual({
      camera: {
        longitude: 180,
        latitude: -85,
        zoom: 20,
        bearing: -180,
        pitch: 85,
      },
      terrainMode: 'terrain',
    });
    await expect(services.database.settings.get('map.camera')).resolves.toMatchObject({
      value: { schemaVersion: 2, terrainMode: 'terrain' },
    });
  });

  it('infers terrain mode when loading a legacy pitched camera', async () => {
    await services.database.settings.put({
      key: 'map.camera',
      value: { schemaVersion: 1, camera },
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(repository.load()).resolves.toEqual({
      camera,
      terrainMode: 'terrain',
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
    await expect(repository.save({ camera, terrainMode: 'terrain' })).rejects.toThrow(
      'write unavailable',
    );
  });
});
