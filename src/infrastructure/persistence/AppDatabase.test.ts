import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppDatabase } from '@/infrastructure/persistence/AppDatabase';
import { createTestServices } from '../../../test/helpers/createTestServices';

let database: AppDatabase;

beforeEach(async () => {
  const services = createTestServices();
  database = services.database;
  await database.delete();
  database = new AppDatabase(services.logger);
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe('AppDatabase', () => {
  it('uses safe defaults and persists validated UI preferences', async () => {
    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: false,
    });

    await database.saveUiPreferences({ developerMode: true });

    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: true,
    });
  });

  it('repairs invalid persisted preferences', async () => {
    await database.settings.put({
      key: 'ui.preferences',
      value: { developerMode: 'yes' },
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    await expect(database.loadUiPreferences()).resolves.toEqual({
      developerMode: false,
    });
    await expect(database.settings.get('ui.preferences')).resolves.toBeUndefined();
  });

  it('runs a non-destructive storage probe', async () => {
    await database.probe();

    await expect(database.settings.get('__healthcheck__')).resolves.toBeUndefined();
  });
});
