import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { toTerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';
import { TerrainComputeEngine } from '@/infrastructure/elevation/TerrainComputeEngine';

function configuration() {
  const terrain = parseMapProviderConfiguration(
    defaultMapProviderConfigurationInput,
    'https://example.test/',
  ).terrain;
  return toTerrainComputeConfiguration(terrain, 10_000);
}

function pendingFetch() {
  return vi.fn(
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
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TerrainComputeEngine', () => {
  it('fetches the raw provider DEM neighbourhood for a contour tile', async () => {
    const fetchImplementation = pendingFetch();
    vi.stubGlobal('fetch', fetchImplementation);
    const engine = new TerrainComputeEngine(configuration());
    const controller = new AbortController();

    const pending = engine.fetchContourTile(
      12,
      2_600,
      1_500,
      { levels: [50, 200] },
      controller,
    );

    await vi.waitFor(() => {
      expect(fetchImplementation).toHaveBeenCalledTimes(9);
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://tiles.mapterhorn.com/12/2600/1500.webp',
      expect.anything(),
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it('rejects requests after deterministic disposal', () => {
    const engine = new TerrainComputeEngine(configuration());

    engine.dispose();

    expect(() =>
      engine.fetchContourTile(
        12,
        2_600,
        1_500,
        { levels: [50] },
        new AbortController(),
      ),
    ).toThrow(/disposed/u);
  });
});
