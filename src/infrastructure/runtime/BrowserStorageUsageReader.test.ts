import { describe, expect, it } from 'vitest';

import { BrowserStorageUsageReader } from '@/infrastructure/runtime/BrowserStorageUsageReader';

describe('BrowserStorageUsageReader', () => {
  it('separates reported origin storage, localStorage, and heap estimates', async () => {
    const reader = new BrowserStorageUsageReader({
      estimate: () =>
        Promise.resolve({
          usage: 12_000,
          quota: 100_000,
          usageDetails: { indexedDB: 7_000, caches: 3_000 },
        }),
      heapMemory: () => ({
        usedJSHeapSize: 20_000,
        totalJSHeapSize: 30_000,
        jsHeapSizeLimit: 200_000,
      }),
      localStorageEntries: () => [['ab', 'cde']],
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });

    await expect(reader.read()).resolves.toEqual({
      measuredAt: '2026-07-19T12:00:00.000Z',
      totalStoredBytes: 12_010,
      originUsageBytes: 12_000,
      quotaBytes: 100_000,
      indexedDbBytes: 7_000,
      cacheStorageBytes: 3_000,
      localStorageBytes: 10,
      otherOriginStorageBytes: 2_000,
      heapUsedBytes: 20_000,
      heapAllocatedBytes: 30_000,
      heapLimitBytes: 200_000,
    });
  });

  it('returns unavailable metrics when browser estimates fail', async () => {
    const reader = new BrowserStorageUsageReader({
      estimate: () => Promise.reject(new Error('unavailable')),
      heapMemory: null,
      localStorageEntries: () => [],
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });

    await expect(reader.read()).resolves.toMatchObject({
      totalStoredBytes: null,
      indexedDbBytes: null,
      cacheStorageBytes: null,
      localStorageBytes: 0,
      heapUsedBytes: null,
    });
  });
});
