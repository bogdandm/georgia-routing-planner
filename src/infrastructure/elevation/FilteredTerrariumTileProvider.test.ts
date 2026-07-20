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
import { FilteredTerrariumTileProvider } from '@/infrastructure/elevation/FilteredTerrariumTileProvider';
import {
  encodeTerrariumElevation,
  type DecodedTerrariumTile,
} from '@/infrastructure/elevation/TerrariumDemFilter';

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
      terrain(),
      10_000,
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
      terrain(),
      10_000,
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
      terrain(),
      0,
      timeoutLogger,
      codec,
      fetchImplementation,
    );

    await expect(
      provider.getTile(4, 8, 8, new AbortController()),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(log).toHaveBeenCalledOnce();
    const event = log.mock.calls[0]?.[0];
    expect(event?.name).toBe('map.dem.tile-timeout');
    expect(event?.data?.status).toBe('timed-out');
  });

  it('keeps the processed-tile cache within its configured LRU bound', async () => {
    const configuredTerrain = {
      ...terrain(),
      filter: { ...terrain().filter, cacheSize: 8 },
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
      configuredTerrain,
      10_000,
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
});
