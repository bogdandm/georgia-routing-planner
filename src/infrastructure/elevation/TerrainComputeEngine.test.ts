import { describe, expect, it, vi } from 'vitest';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type { TerrariumPngCodec } from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
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
    const engine = new TerrainComputeEngine(terrain(), 10_000, logger, {
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
    const engine = new TerrainComputeEngine(terrain(), 10_000, logger, {
      codec,
      fetchImplementation,
    });
    const pending = engine.fetchTile(5, 8, 9, new AbortController());

    engine.dispose();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => engine.fetchTile(5, 8, 9, new AbortController())).toThrow(/disposed/u);
  });
});
