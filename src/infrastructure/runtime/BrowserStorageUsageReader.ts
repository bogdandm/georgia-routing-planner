import type {
  StorageUsageReader,
  StorageUsageSnapshot,
} from '@/application/ports/StorageUsageReader';

interface StorageEstimateDetails {
  readonly caches?: number;
  readonly indexedDB?: number;
}

interface ExtendedStorageEstimate extends StorageEstimate {
  readonly usageDetails?: StorageEstimateDetails;
}

interface HeapMemoryInfo {
  readonly jsHeapSizeLimit: number;
  readonly totalJSHeapSize: number;
  readonly usedJSHeapSize: number;
}

interface BrowserStorageUsageEnvironment {
  readonly estimate: (() => Promise<ExtendedStorageEstimate>) | null;
  readonly heapMemory: (() => HeapMemoryInfo | null) | null;
  readonly localStorageEntries: () => readonly (readonly [string, string])[];
  readonly now: () => Date;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readLocalStorageEntries(): readonly (readonly [string, string])[] {
  try {
    return Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? '';
      return [key, localStorage.getItem(key) ?? ''] as const;
    });
  } catch {
    return [];
  }
}

function readHeapMemory(): HeapMemoryInfo | null {
  const memory = (performance as unknown as { readonly memory?: unknown }).memory;
  if (typeof memory !== 'object' || memory === null) return null;
  const candidate = memory as Partial<HeapMemoryInfo>;
  const used = finiteNonNegative(candidate.usedJSHeapSize);
  const allocated = finiteNonNegative(candidate.totalJSHeapSize);
  const limit = finiteNonNegative(candidate.jsHeapSizeLimit);
  return used === null || allocated === null || limit === null
    ? null
    : { usedJSHeapSize: used, totalJSHeapSize: allocated, jsHeapSizeLimit: limit };
}

function defaultEnvironment(): BrowserStorageUsageEnvironment {
  return {
    estimate: () => navigator.storage.estimate(),
    heapMemory: readHeapMemory,
    localStorageEntries: readLocalStorageEntries,
    now: () => new Date(),
  };
}

function utf16Bytes(value: string): number {
  return value.length * 2;
}

/** Reads best-effort Chrome origin-storage and JS-heap metrics. */
export class BrowserStorageUsageReader implements StorageUsageReader {
  public constructor(
    private readonly environment: BrowserStorageUsageEnvironment = defaultEnvironment(),
  ) {}

  public async read(): Promise<StorageUsageSnapshot> {
    let estimate: ExtendedStorageEstimate = {};
    try {
      estimate = (await this.environment.estimate?.()) ?? {};
    } catch {
      // Storage metrics are optional diagnostics and must not make Settings fail.
    }

    const originUsageBytes = finiteNonNegative(estimate.usage);
    const quotaBytes = finiteNonNegative(estimate.quota);
    const indexedDbBytes = finiteNonNegative(estimate.usageDetails?.indexedDB);
    const cacheStorageBytes = finiteNonNegative(estimate.usageDetails?.caches);
    const localStorageBytes = this.environment
      .localStorageEntries()
      .reduce((total, [key, value]) => total + utf16Bytes(key) + utf16Bytes(value), 0);
    const knownOriginBytes =
      indexedDbBytes === null || cacheStorageBytes === null
        ? null
        : indexedDbBytes + cacheStorageBytes;
    const otherOriginStorageBytes =
      originUsageBytes === null || knownOriginBytes === null
        ? null
        : Math.max(0, originUsageBytes - knownOriginBytes);
    const heap = this.environment.heapMemory?.() ?? null;

    return {
      measuredAt: this.environment.now().toISOString(),
      totalStoredBytes:
        originUsageBytes === null ? null : originUsageBytes + localStorageBytes,
      originUsageBytes,
      quotaBytes,
      indexedDbBytes,
      cacheStorageBytes,
      localStorageBytes,
      otherOriginStorageBytes,
      heapUsedBytes: finiteNonNegative(heap?.usedJSHeapSize),
      heapAllocatedBytes: finiteNonNegative(heap?.totalJSHeapSize),
      heapLimitBytes: finiteNonNegative(heap?.jsHeapSizeLimit),
    };
  }
}
