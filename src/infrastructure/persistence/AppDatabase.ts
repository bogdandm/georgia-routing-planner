import Dexie, { type EntityTable } from 'dexie';
import { z } from 'zod';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';

interface SettingRecord {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: string;
}

interface PersistedDiagnosticRecord {
  readonly id?: number;
  readonly timestamp: string;
  readonly name: string;
  readonly level: string;
}

const uiPreferencesSchema = z
  .object({
    developerMode: z.boolean(),
  })
  .strict();

export interface UiPreferences {
  readonly developerMode: boolean;
}

const defaultUiPreferences: UiPreferences = { developerMode: false };

/** Owns the versioned IndexedDB schema and validates values crossing storage boundaries. */
export class AppDatabase extends Dexie {
  public readonly settings!: EntityTable<SettingRecord, 'key'>;
  public readonly diagnostics!: EntityTable<PersistedDiagnosticRecord, 'id'>;

  public constructor(private readonly logger: DiagnosticLogger) {
    super('GeorgiaRoutingPlanner');
    this.version(1).stores({
      settings: 'key,updatedAt',
      diagnostics: '++id,timestamp,name,level',
    });
  }

  public async loadUiPreferences(): Promise<UiPreferences> {
    const record = await this.settings.get('ui.preferences');
    if (record === undefined) {
      return defaultUiPreferences;
    }

    const parsed = uiPreferencesSchema.safeParse(record.value);
    if (!parsed.success) {
      await this.settings.delete('ui.preferences');
      this.logger.log({
        level: 'warn',
        name: 'storage.settings.repaired',
        data: { reason: 'schema-invalid' },
      });
      return defaultUiPreferences;
    }

    return parsed.data;
  }

  public async saveUiPreferences(value: UiPreferences): Promise<void> {
    const parsed = uiPreferencesSchema.parse(value);
    await this.settings.put({
      key: 'ui.preferences',
      value: parsed,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Performs a temporary write/read/delete cycle without retaining health-check data. */
  public async probe(): Promise<void> {
    const key = '__healthcheck__';
    await this.settings.put({ key, value: true, updatedAt: new Date().toISOString() });
    await this.settings.get(key);
    await this.settings.delete(key);
  }
}
