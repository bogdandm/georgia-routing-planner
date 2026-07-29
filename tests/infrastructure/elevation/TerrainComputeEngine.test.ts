import { describe, expect, it, vi } from 'vitest';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type { TerrariumPngCodec } from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
import { toTerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';
import { TerrainComputeEngine } from '@/infrastructure/elevation/TerrainComputeEngine';
import {
  encodeTerrariumElevation,
  type DecodedTerrariumTile,
} from '@/infrastructure/elevation/TerrariumDemFilter';

const logger: DiagnosticLogger = { log: vi.fn(), getEvents: () => [] };

function terrain() {
  return parseMapProviderConfiguration(
    defaultMapProviderConfigurationInput,
    'https://example.test/',
  ).terrain;
}

function configuration() {
  return toTerrainComputeConfiguration(terrain(), 10_000);
}

function decodedTile(): DecodedTerrariumTile {
  const [red, green, blue] = encodeTerrariumElevation(1_000);
  const pixel = [red, green, blue, 255];
  return {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([...pixel, ...pixel, ...pixel, ...pixel]),
  };
}

describe('TerrainComputeEngine', () => {
  it('shares filtered source work and invalidates results when the filter changes', async () => {
    const codec: TerrariumPngCodec = {
      decode: vi.fn(() => Promise.resolve(decodedTile())),
      encode: vi.fn(() => Promise.resolve(new Blob(['filtered']))),
    };
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(new Response(new Blob(['tile']), { status: 200 })),
    );
    const engine = new TerrainComputeEngine(configuration(), logger, {
      codec,
      fetchImplementation,
    });

    await Promise.all([
      engine.fetchTile(5, 8, 9, new AbortController()),
      engine.fetchTile(5, 9, 9, new AbortController()),
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(12);

    engine.setFilterEnabled(false);
    await engine.fetchTile(5, 8, 9, new AbortController());
    expect(fetchImplementation).toHaveBeenCalledTimes(13);
  });

  it('shares repaired pixels between DEM and contour outputs', async () => {
    const fetchedUrls = new Set<string>();
    const decode = vi.fn(async (blob: Blob): Promise<DecodedTerrariumTile> => {
      const url = await blob.text();
      const coordinates = /\/5\/(\d+)\/(\d+)\.png$/u.exec(url);
      const xValue = coordinates?.[1];
      const yValue = coordinates?.[2];
      if (xValue === undefined || yValue === undefined) {
        throw new Error(`Unexpected DEM URL: ${url}`);
      }
      const x = Number(xValue);
      const y = Number(yValue);
      const data = new Uint8ClampedArray(4 * 4 * 4);
      for (let pixelY = 0; pixelY < 4; pixelY += 1) {
        for (let pixelX = 0; pixelX < 4; pixelX += 1) {
          const elevation =
            x === 8 && y === 9 && pixelX === 1 && pixelY === 1
              ? 10_000
              : x * 100 + pixelX * 20 + pixelY * 5;
          const [red, green, blue] = encodeTerrariumElevation(elevation);
          const offset = (pixelY * 4 + pixelX) * 4;
          data[offset] = red;
          data[offset + 1] = green;
          data[offset + 2] = blue;
          data[offset + 3] = 255;
        }
      }
      return { width: 4, height: 4, data };
    });
    const encode = vi.fn(() => Promise.resolve(new Blob(['not-a-png'])));
    const codec: TerrariumPngCodec = { decode, encode };
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      fetchedUrls.add(url);
      return Promise.resolve(new Response(url, { status: 200 }));
    });
    const engine = new TerrainComputeEngine(configuration(), logger, {
      codec,
      fetchImplementation,
    });
    const contourOptions = { levels: [100, 500], subsampleBelow: 4 };

    const [raster, contour] = await Promise.all([
      engine.fetchTile(5, 8, 9, new AbortController()),
      engine.fetchContourTile(5, 8, 9, contourOptions, new AbortController()),
    ]);

    expect(raster.data).toBeInstanceOf(Blob);
    expect(contour.arrayBuffer.byteLength).toBeGreaterThan(0);
    expect(encode).toHaveBeenCalledOnce();
    expect(fetchedUrls.size).toBe(25);
    expect(decode).toHaveBeenCalledTimes(fetchedUrls.size);

    const decodedBeforeDisabling = decode.mock.calls.length;
    engine.setFilterEnabled(false);
    const rawContour = await engine.fetchContourTile(
      5,
      20,
      9,
      contourOptions,
      new AbortController(),
    );

    expect(rawContour.arrayBuffer.byteLength).toBeGreaterThan(0);
    expect(decode).toHaveBeenCalledTimes(decodedBeforeDisabling + 9);
  });

  it('cancels pending work and rejects future requests after deterministic disposal', async () => {
    const codec: TerrariumPngCodec = {
      decode: () => Promise.resolve(decodedTile()),
      encode: () => Promise.resolve(new Blob(['filtered'])),
    };
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
    const engine = new TerrainComputeEngine(configuration(), logger, {
      codec,
      fetchImplementation,
    });
    const pending = engine.fetchTile(5, 8, 9, new AbortController());

    engine.dispose();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => engine.fetchTile(5, 8, 9, new AbortController())).toThrow(/disposed/u);
  });
});
