import { describe, expect, it, vi } from 'vitest';

import type {
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type { TerrariumPngCodec } from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
import { toTerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';
import { FilteredTerrariumTileProvider } from '@/infrastructure/elevation/FilteredTerrariumTileProvider';
import {
  encodeTerrariumElevation,
  type DecodedTerrariumTile,
} from '@/infrastructure/elevation/TerrariumDemFilter';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error('Deferred promise initialization failed.');
  }
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function decodedTile(): DecodedTerrariumTile {
  const [red, green, blue] = encodeTerrariumElevation(1_000);
  return {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      red,
      green,
      blue,
      255,
      red,
      green,
      blue,
      255,
      red,
      green,
      blue,
      255,
      red,
      green,
      blue,
      255,
    ]),
  };
}

const codec: TerrariumPngCodec = {
  decode: () => Promise.resolve(decodedTile()),
  encode: () => Promise.resolve(new Blob(['filtered'])),
};

const logger: DiagnosticLogger = {
  log: vi.fn(),
  getEvents: () => [],
};

function terrain() {
  return parseMapProviderConfiguration(
    defaultMapProviderConfigurationInput,
    'https://example.test/',
  ).terrain;
}

function configuration(requestTimeoutMs = 10_000) {
  return toTerrainComputeConfiguration(terrain(), requestTimeoutMs);
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

describe('FilteredTerrariumTileProvider', () => {
  it('bypasses decoding and neighborhood requests while filtering is disabled', async () => {
    const decode = vi.fn(() => Promise.resolve(decodedTile()));
    const encode = vi.fn(() => Promise.resolve(new Blob(['filtered'])));
    const testCodec: TerrariumPngCodec = { decode, encode };
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return Promise.resolve(new Response(new Blob([url]), { status: 200 }));
    });
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      testCodec,
      fetchImplementation,
    );
    provider.setEnabled(false);

    const raw = await provider.getTile(5, 8, 9, new AbortController());

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(decode).not.toHaveBeenCalled();
    const requestedTile = fetchImplementation.mock.calls[0]?.[0];
    expect(
      typeof requestedTile === 'string'
        ? requestedTile
        : requestedTile instanceof URL
          ? requestedTile.href
          : requestedTile?.url,
    ).toContain('/5/8/9.png');
    expect(raw.data).toBeInstanceOf(Blob);

    provider.setEnabled(true);
    await provider.getTile(5, 8, 9, new AbortController());

    expect(fetchImplementation).toHaveBeenCalledTimes(10);
    expect(decode).toHaveBeenCalledTimes(9);
  });

  it('propagates cancellation through pending tile requests', async () => {
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Canceled', 'AbortError'));
            },
            { once: true },
          );
        }),
    );
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      codec,
      fetchImplementation,
    );
    const controller = new AbortController();

    const pending = provider.getTile(4, 8, 8, controller);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('enforces the configured request timeout', async () => {
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const timeoutLogger: DiagnosticLogger = {
      log,
      getEvents: () => [],
    };
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Timed out', 'AbortError'));
            },
            { once: true },
          );
        }),
    );
    const provider = new FilteredTerrariumTileProvider(
      configuration(0),
      timeoutLogger,
      codec,
      fetchImplementation,
    );

    await expect(
      provider.getTile(4, 8, 8, new AbortController()),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(log).toHaveBeenCalledOnce();
    const event = log.mock.calls[0]?.[0];
    expect(event?.name).toBe('map.dem.tiles-processed');
    expect(event?.data?.count).toBe(1);
    expect(event?.data?.status).toBe('timed-out');
  });

  it('coalesces overlapping source-tile requests across adjacent neighborhoods', async () => {
    const fetchImplementation = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(new Response(new Blob(['tile']), { status: 200 })),
    );
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      codec,
      fetchImplementation,
    );

    await Promise.all([
      provider.getTile(5, 8, 9, new AbortController()),
      provider.getTile(5, 9, 9, new AbortController()),
    ]);

    expect(fetchImplementation).toHaveBeenCalledTimes(12);
  });

  it('keeps shared source work alive when only one consumer is canceled', async () => {
    let releaseFetches: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    const fetchImplementation = vi.fn(async () => {
      await fetchGate;
      return new Response(new Blob(['tile']), { status: 200 });
    });
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      codec,
      fetchImplementation,
    );
    const canceled = new AbortController();
    const retained = new AbortController();

    const first = provider.getTile(5, 8, 9, canceled);
    const second = provider.getTile(5, 8, 9, retained);
    canceled.abort();
    releaseFetches?.();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const retainedResult = await second;
    expect(retainedResult.data).toBeInstanceOf(Blob);
    expect(fetchImplementation).toHaveBeenCalledTimes(9);
  });

  it('batches mixed completion states without logging each tile transition', async () => {
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const aggregateLogger: DiagnosticLogger = { log, getEvents: () => [] };
    const fetchImplementation = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(new Response(new Blob(['tile']), { status: 200 })),
    );
    let now = 0;
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      aggregateLogger,
      codec,
      fetchImplementation,
      () => now,
    );

    await provider.getTile(5, 8, 9, new AbortController());
    const canceled = new AbortController();
    canceled.abort();
    await expect(provider.getTile(5, 20, 9, canceled)).rejects.toMatchObject({
      name: 'AbortError',
    });
    now = 1;
    await provider.getTile(5, 24, 9, new AbortController());

    expect(log).toHaveBeenCalledOnce();
  });

  it('keeps the processed-tile cache within its configured LRU bound', async () => {
    const configuredConfiguration = {
      ...configuration(),
      filter: { ...configuration().filter, cacheSize: 8 },
    };
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const value =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return Promise.resolve(new Response(new Blob([value]), { status: 200 }));
    });
    const provider = new FilteredTerrariumTileProvider(
      configuredConfiguration,
      logger,
      codec,
      fetchImplementation,
    );

    for (let x = 2; x <= 10; x += 1) {
      await provider.getTile(5, x, 10, new AbortController());
    }
    const callsAfterNineTiles = fetchImplementation.mock.calls.length;
    await provider.getTile(5, 2, 10, new AbortController());

    expect(fetchImplementation.mock.calls.length).toBe(callsAfterNineTiles + 9);
  });

  it('coalesces complete same-key processing and reuses the exact cached response', async () => {
    const log = vi.fn<(input: DiagnosticInput) => void>();
    const processingLogger: DiagnosticLogger = { log, getEvents: () => [] };
    const fetchImplementation = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(new Response(new Blob([requestUrl(input)]), { status: 200 })),
    );
    const decode = vi.fn(() => {
      const decoded = decodedTile();
      if (decode.mock.calls.length === 5) decoded.data[3] = 0;
      return Promise.resolve(decoded);
    });
    const encode = vi.fn(() => Promise.resolve(new Blob(['repaired'])));
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      processingLogger,
      { decode, encode },
      fetchImplementation,
    );

    const [first, second] = await Promise.all([
      provider.getTile(5, 8, 9, new AbortController()),
      provider.getTile(5, 8, 9, new AbortController()),
    ]);

    expect(first).toBe(second);
    expect(fetchImplementation).toHaveBeenCalledTimes(9);
    expect(decode).toHaveBeenCalledTimes(9);
    expect(encode).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();

    const cached = await provider.getTile(5, 8, 9, new AbortController());
    expect(cached).toBe(first);
    expect(fetchImplementation).toHaveBeenCalledTimes(9);
    expect(decode).toHaveBeenCalledTimes(9);
    expect(encode).toHaveBeenCalledOnce();
  });

  it('rejects one canceled consumer while retaining the shared producer', async () => {
    const gate = deferred<undefined>();
    const producerSignals: AbortSignal[] = [];
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal !== null && init?.signal !== undefined) {
          producerSignals.push(init.signal);
        }
        await gate.promise;
        return new Response(new Blob(['tile']), { status: 200 });
      },
    );
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      codec,
      fetchImplementation,
    );
    const canceled = new AbortController();
    const retained = new AbortController();
    const reason = new DOMException('Only this consumer canceled.', 'AbortError');

    const first = provider.getTile(5, 8, 9, canceled);
    const second = provider.getTile(5, 8, 9, retained);
    canceled.abort(reason);

    await expect(first).rejects.toBe(reason);
    expect(producerSignals).toHaveLength(9);
    expect(producerSignals.every((signal) => !signal.aborted)).toBe(true);
    gate.resolve(undefined);
    const retainedResult = await second;
    expect(retainedResult.data).toBeInstanceOf(Blob);
  });

  it('aborts producer work after every same-key consumer cancels', async () => {
    const producerSignals: AbortSignal[] = [];
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        const pending = deferred<Response>();
        const signal = init?.signal;
        if (signal !== null && signal !== undefined) {
          producerSignals.push(signal);
          signal.addEventListener(
            'abort',
            () => {
              pending.reject(signal.reason);
            },
            { once: true },
          );
        }
        return pending.promise;
      },
    );
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      codec,
      fetchImplementation,
    );
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = provider.getTile(5, 8, 9, firstController);
    const second = provider.getTile(5, 8, 9, secondController);

    firstController.abort();
    expect(producerSignals.every((signal) => !signal.aborted)).toBe(true);
    secondController.abort();

    const results = await Promise.allSettled([first, second]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(producerSignals).toHaveLength(9);
    expect(producerSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it('aborts old revisions and never inserts their results into the current cache', async () => {
    let modeChanged = false;
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (modeChanged) {
          return Promise.resolve(new Response(new Blob(['current']), { status: 200 }));
        }
        const pending = deferred<Response>();
        const signal = init?.signal;
        signal?.addEventListener(
          'abort',
          () => {
            pending.reject(signal.reason);
          },
          { once: true },
        );
        return pending.promise;
      },
    );
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      codec,
      fetchImplementation,
    );
    const stale = provider.getTile(5, 8, 9, new AbortController());

    provider.setEnabled(false);
    modeChanged = true;

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    const current = await provider.getTile(5, 8, 9, new AbortController());
    const cached = await provider.getTile(5, 8, 9, new AbortController());
    expect(cached).toBe(current);
    expect(fetchImplementation).toHaveBeenCalledTimes(10);
  });

  it('degrades optional fetch, HTTP, and decode failures to retryable null halo', async () => {
    const failedOnce = new Set<string>();
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/5/7/8.png') && !failedOnce.has(url)) {
        failedOnce.add(url);
        return Promise.reject(new TypeError('Network unavailable.'));
      }
      if (url.includes('/5/8/8.png')) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      return Promise.resolve(new Response(new Blob([url]), { status: 200 }));
    });
    const decode = vi.fn(() =>
      decode.mock.calls.length === 1
        ? Promise.reject(new Error('Invalid PNG.'))
        : Promise.resolve(decodedTile()),
    );
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      { decode, encode: (tile, signal) => codec.encode(tile, signal) },
      fetchImplementation,
    );

    const first = await provider.getTile(5, 8, 9, new AbortController());
    const second = await provider.getTile(5, 7, 8, new AbortController());
    expect(first.data).toBeInstanceOf(Blob);
    expect(second.data).toBeInstanceOf(Blob);

    const retriedUrl = [...failedOnce][0];
    expect(retriedUrl).toBeDefined();
    expect(
      fetchImplementation.mock.calls.filter(
        ([input]) => requestUrl(input) === retriedUrl,
      ),
    ).toHaveLength(2);
  });

  it.each(['http', 'decode'] as const)(
    'still rejects a %s failure for the center tile',
    async (failure) => {
      const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (failure === 'http' && url.includes('/5/8/9.png')) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return Promise.resolve(new Response(new Blob([url]), { status: 200 }));
      });
      const decode = vi.fn(() =>
        failure === 'decode' && decode.mock.calls.length === 5
          ? Promise.reject(new Error('Center PNG invalid.'))
          : Promise.resolve(decodedTile()),
      );
      const provider = new FilteredTerrariumTileProvider(
        configuration(),
        logger,
        { decode, encode: (tile, signal) => codec.encode(tile, signal) },
        fetchImplementation,
      );

      await expect(provider.getTile(5, 8, 9, new AbortController())).rejects.toThrow(
        failure === 'http' ? /HTTP 500/u : /Center PNG invalid/u,
      );
    },
  );

  it('cancels pending requests and clears ownership on disposal', async () => {
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Canceled', 'AbortError'));
            },
            { once: true },
          );
        }),
    );
    const provider = new FilteredTerrariumTileProvider(
      configuration(),
      logger,
      codec,
      fetchImplementation,
    );
    const pending = provider.getTile(5, 8, 9, new AbortController());

    provider.dispose();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(provider.getTile(5, 8, 9, new AbortController())).rejects.toThrow(
      /disposed/u,
    );
  });
});
