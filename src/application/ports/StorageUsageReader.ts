export interface StorageUsageSnapshot {
  readonly measuredAt: string;
  readonly totalStoredBytes: number | null;
  readonly originUsageBytes: number | null;
  readonly quotaBytes: number | null;
  readonly indexedDbBytes: number | null;
  readonly cacheStorageBytes: number | null;
  readonly localStorageBytes: number;
  readonly otherOriginStorageBytes: number | null;
  readonly heapUsedBytes: number | null;
  readonly heapAllocatedBytes: number | null;
  readonly heapLimitBytes: number | null;
}

/** Reads browser-reported storage and memory estimates without mutating user data. */
export interface StorageUsageReader {
  read(): Promise<StorageUsageSnapshot>;
}
