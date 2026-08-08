import { describe, expect, it, vi } from 'vitest';
import type { KyInstance } from 'ky';

import type { IdGenerator } from '@/application/ports/IdGenerator';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import type { TerrariumPngCodec } from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
import {
  decodeDemElevation,
  locateDemPixel,
  RasterDemElevationProvider,
} from '@/infrastructure/elevation/RasterDemElevationProvider';
import type { DecodedTerrariumTile } from '@/infrastructure/elevation/TerrariumDemFilter';

describe('RasterDemElevationProvider helpers', () => {
  it('locates a deterministic pixel in a slippy-map tile', () => {
    expect(locateDemPixel({ longitude: 0, latitude: 0 }, 1, 256)).toEqual({
      z: 1,
      x: 1,
      y: 1,
      pixelX: 0,
      pixelY: 0,
    });
    expect(locateDemPixel({ longitude: 44.8, latitude: 90 }, 15, 256)).toBeNull();
  });

  it('decodes the supported Terrarium and Mapbox formulas', () => {
    expect(decodeDemElevation({ red: 128, green: 4, blue: 0 }, 'terrarium')).toBe(4);
    expect(decodeDemElevation({ red: 1, green: 134, blue: 160 }, 'mapbox')).toBe(0);
  });
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new Error('Deferred promise initialization failed.');
  }
  return { promise, resolve: resolvePromise };
}

function terrain() {
  return parseMapProviderConfiguration(
    defaultMapProviderConfigurationInput,
    'https://example.test/',
  ).terrain;
}

function decodedTile(tileSize: number): DecodedTerrariumTile {
  const data = new Uint8ClampedArray(tileSize * tileSize * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 1;
    data[offset + 1] = 173;
    data[offset + 2] = 176;
    data[offset + 3] = 255;
  }
  return { width: tileSize, height: tileSize, data };
}

const idGenerator: IdGenerator = { generate: () => 'test-operation' };

describe('RasterDemElevationProvider sampling progress', () => {
  it('reports each completed DEM tile with aligned result entries', async () => {
    const configuredTerrain = terrain();
    const firstTile = deferred<Blob>();
    const secondTile = deferred<Blob>();
    const tiles = [firstTile, secondTile];
    let requestedTiles = 0;
    const httpClient = {
      get: vi.fn(() => {
        const tile = tiles[requestedTiles];
        requestedTiles += 1;
        if (tile === undefined) throw new Error('Unexpected DEM tile request.');
        return { blob: () => tile.promise };
      }),
    } as unknown as KyInstance;
    const pngCodec: TerrariumPngCodec = {
      decode: () => Promise.resolve(decodedTile(configuredTerrain.tileSize)),
      encode: () => Promise.resolve(new Blob()),
    };
    const provider = new RasterDemElevationProvider(
      httpClient,
      { ...configuredTerrain, encoding: 'mapbox' },
      idGenerator,
      null,
      pngCodec,
    );
    const coordinates = [
      { longitude: 0, latitude: 0 },
      { longitude: 0.001, latitude: 0 },
      { longitude: 30, latitude: 0 },
    ] as const;
    const firstLocation = locateDemPixel(
      coordinates[0],
      configuredTerrain.maxZoom,
      configuredTerrain.tileSize,
    );
    const lastLocation = locateDemPixel(
      coordinates[2],
      configuredTerrain.maxZoom,
      configuredTerrain.tileSize,
    );
    expect(firstLocation?.x).not.toBe(lastLocation?.x);
    const progress: {
      readonly completedTiles: number;
      readonly totalTiles: number;
      readonly indices: readonly number[];
      readonly samples: readonly unknown[];
    }[] = [];

    const pending = provider.sampleMany(
      coordinates,
      new AbortController().signal,
      (event) => {
        progress.push(event);
      },
    );

    expect(progress).toEqual([
      { completedTiles: 0, totalTiles: 2, indices: [], samples: [] },
    ]);
    firstTile.resolve(new Blob(['first']));
    await vi.waitFor(() => {
      expect(progress).toHaveLength(2);
    });
    secondTile.resolve(new Blob(['second']));
    const samples = await pending;

    expect(progress).toEqual([
      { completedTiles: 0, totalTiles: 2, indices: [], samples: [] },
      {
        completedTiles: 1,
        totalTiles: 2,
        indices: [0, 1],
        samples: [
          { status: 'available', meters: 1_000 },
          { status: 'available', meters: 1_000 },
        ],
      },
      {
        completedTiles: 2,
        totalTiles: 2,
        indices: [2],
        samples: [{ status: 'available', meters: 1_000 }],
      },
    ]);
    expect(samples).toEqual([
      { status: 'available', meters: 1_000 },
      { status: 'available', meters: 1_000 },
      { status: 'available', meters: 1_000 },
    ]);
  });

  it('does not emit completion after sampling is aborted', async () => {
    const configuredTerrain = terrain();
    const tile = deferred<Blob>();
    const provider = new RasterDemElevationProvider(
      {
        get: () => ({ blob: () => tile.promise }),
      } as unknown as KyInstance,
      { ...configuredTerrain, encoding: 'mapbox' },
      idGenerator,
      null,
      {
        decode: () => Promise.resolve(decodedTile(configuredTerrain.tileSize)),
        encode: () => Promise.resolve(new Blob()),
      },
    );
    const controller = new AbortController();
    const progress: number[] = [];
    const pending = provider.sampleMany(
      [{ longitude: 0, latitude: 0 }],
      controller.signal,
      (event) => {
        progress.push(event.completedTiles);
      },
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort(new DOMException('Canceled', 'AbortError'));
    tile.resolve(new Blob(['tile']));

    await rejection;
    expect(progress).toEqual([0]);
  });
});
