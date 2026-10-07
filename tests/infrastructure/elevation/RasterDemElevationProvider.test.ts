import { describe, expect, it, vi } from 'vitest';
import type { KyInstance } from 'ky';

import type {
  ElevationCoordinate,
  ElevationSamplingProgress,
} from '@/application/ports/ElevationProvider';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type {
  DecodedDemTile,
  DemImageDecoder,
} from '@/infrastructure/elevation/BrowserDemImageDecoder';
import {
  decodeDemElevation,
  RasterDemElevationProvider,
} from '@/infrastructure/elevation/RasterDemElevationProvider';

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

// A zoom-1 world of 2 px tiles is 4 x 4 pixels, small enough to reason about corners.
const zoom = 1;
const tileSize = 2;
const worldPixels = 2 ** zoom * tileSize;

function terrain() {
  return {
    tileUrl: 'https://dem.test/{z}/{x}/{y}.webp',
    encoding: 'terrarium' as const,
    tileSize,
    maxZoom: zoom,
  };
}

/** Returns the coordinate whose bilinear position is the given world pixel-centre offset. */
function coordinateAtPixel(column: number, row: number): ElevationCoordinate {
  return {
    longitude: ((column + 0.5) / worldPixels) * 360 - 180,
    latitude:
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (row + 0.5)) / worldPixels))) * 180) /
      Math.PI,
  };
}

/** Builds a tile from row-major elevations; `null` marks a transparent pixel. */
function tile(elevations: readonly (number | null)[]): DecodedDemTile {
  const data = new Uint8ClampedArray(tileSize * tileSize * 4);
  elevations.forEach((meters, index) => {
    if (meters === null) return;
    const encoded = meters + 32_768;
    data[index * 4] = Math.floor(encoded / 256);
    data[index * 4 + 1] = encoded % 256;
    data[index * 4 + 2] = 0;
    data[index * 4 + 3] = 255;
  });
  return { width: tileSize, height: tileSize, data };
}

const idGenerator: IdGenerator = { generate: () => 'test-operation' };

/** Serves decoded tiles by URL; each response stays pending until released. */
function tileServer(tiles: Readonly<Record<string, DecodedDemTile>>) {
  const decodedByBlob = new Map<Blob, DecodedDemTile>();
  const pending = new Map<string, () => void>();
  const get = vi.fn((url: string) => {
    const decoded = tiles[url];
    if (decoded === undefined) throw new Error(`Unexpected DEM tile ${url}.`);
    const blob = new Blob([url]);
    decodedByBlob.set(blob, decoded);
    const response = deferred<Blob>();
    pending.set(url, () => {
      response.resolve(blob);
    });
    return { blob: () => response.promise };
  });
  const decoder: DemImageDecoder = {
    decode: (blob) => {
      const decoded = decodedByBlob.get(blob);
      if (decoded === undefined) throw new Error('Unknown DEM blob.');
      return Promise.resolve(decoded);
    },
  };
  const release = (url: string): void => {
    const resolve = pending.get(url);
    if (resolve === undefined) throw new Error(`DEM tile ${url} was not requested.`);
    resolve();
  };
  const releaseAll = (): void => {
    for (const resolve of pending.values()) resolve();
  };
  return {
    get,
    decoder,
    release,
    releaseAll,
    httpClient: { get } as unknown as KyInstance,
  };
}

const westTileUrl = 'https://dem.test/1/0/1.webp';
const eastTileUrl = 'https://dem.test/1/1/1.webp';

describe('decodeDemElevation', () => {
  it('decodes the supported Terrarium and Mapbox formulas', () => {
    expect(decodeDemElevation({ red: 128, green: 4, blue: 0 }, 'terrarium')).toBe(4);
    expect(decodeDemElevation({ red: 1, green: 134, blue: 160 }, 'mapbox')).toBe(0);
  });
});

describe('RasterDemElevationProvider bilinear sampling', () => {
  it('interpolates between the four pixel centres inside one tile', async () => {
    const server = tileServer({ [eastTileUrl]: tile([100, 200, 300, 400]) });
    const provider = new RasterDemElevationProvider(
      server.httpClient,
      terrain(),
      idGenerator,
      server.decoder,
    );

    const pending = provider.sampleMany(
      [coordinateAtPixel(2.25, 2.5)],
      new AbortController().signal,
    );
    server.releaseAll();
    const [sample] = await pending;

    expect(server.get).toHaveBeenCalledOnce();
    expect(server.get).toHaveBeenCalledWith(eastTileUrl, expect.anything());
    expect(sample?.status).toBe('available');
    // Top row 100..200 and bottom row 300..400, a quarter across and halfway down.
    expect(sample?.status === 'available' ? sample.meters : null).toBeCloseTo(225, 6);
  });

  it('uses the neighbouring tile across tile edges and the antimeridian', async () => {
    const server = tileServer({
      [westTileUrl]: tile([100, 100, 100, 100]),
      [eastTileUrl]: tile([300, 300, 300, 300]),
    });
    const provider = new RasterDemElevationProvider(
      server.httpClient,
      terrain(),
      idGenerator,
      server.decoder,
    );

    const pending = provider.sampleMany(
      [
        coordinateAtPixel(1.5, 2.5),
        coordinateAtPixel(1.25, 2.5),
        coordinateAtPixel(-0.25, 2.5),
      ],
      new AbortController().signal,
    );
    server.releaseAll();
    const samples = await pending;

    expect(server.get).toHaveBeenCalledTimes(2);
    const meters = samples.map((sample) =>
      sample.status === 'available' ? sample.meters : null,
    );
    expect(meters[0]).toBeCloseTo(200, 6);
    expect(meters[1]).toBeCloseTo(150, 6);
    // The westernmost column interpolates with the easternmost column of the world.
    expect(meters[2]).toBeCloseTo(150, 6);
  });

  it('renormalises over valid corners and reports samples without any as unavailable', async () => {
    const server = tileServer({
      [westTileUrl]: tile([null, null, null, null]),
      [eastTileUrl]: tile([100, 200, 300, null]),
    });
    const provider = new RasterDemElevationProvider(
      server.httpClient,
      terrain(),
      idGenerator,
      server.decoder,
    );

    const pending = provider.sampleMany(
      [coordinateAtPixel(2.5, 2.5), coordinateAtPixel(0.5, 2.5)],
      new AbortController().signal,
    );
    server.releaseAll();
    const [partial, missing] = await pending;

    expect(partial?.status === 'available' ? partial.meters : null).toBeCloseTo(200, 6);
    expect(missing).toEqual({ status: 'unavailable' });
  });
});

describe('RasterDemElevationProvider sampling progress', () => {
  it('reports each sample once all of its tiles have loaded', async () => {
    const server = tileServer({
      [westTileUrl]: tile([100, 100, 100, 100]),
      [eastTileUrl]: tile([300, 300, 300, 300]),
    });
    const provider = new RasterDemElevationProvider(
      server.httpClient,
      terrain(),
      idGenerator,
      server.decoder,
    );
    const progress: ElevationSamplingProgress[] = [];

    const pending = provider.sampleMany(
      [
        coordinateAtPixel(0.5, 2.5),
        coordinateAtPixel(1.5, 2.5),
        coordinateAtPixel(2.5, 2.5),
        { longitude: 44, latitude: 89 },
      ],
      new AbortController().signal,
      (event) => {
        progress.push(event);
      },
    );

    expect(progress).toEqual([
      { completedSamples: 0, totalSamples: 3, indices: [], samples: [] },
    ]);
    server.release(westTileUrl);
    await vi.waitFor(() => {
      expect(progress).toHaveLength(2);
    });
    expect(progress[1]).toMatchObject({
      completedSamples: 1,
      totalSamples: 3,
      indices: [0],
    });
    server.release(eastTileUrl);
    const samples = await pending;

    expect(progress.map((event) => event.completedSamples)).toEqual([0, 1, 3]);
    expect(progress[2]).toMatchObject({ totalSamples: 3, indices: [1, 2] });
    expect(progress[2]?.samples).toEqual([samples[1], samples[2]]);
    expect(samples[3]).toEqual({ status: 'unavailable' });
  });

  it('does not emit completion after sampling is aborted', async () => {
    const server = tileServer({ [eastTileUrl]: tile([100, 100, 100, 100]) });
    const provider = new RasterDemElevationProvider(
      server.httpClient,
      terrain(),
      idGenerator,
      server.decoder,
    );
    const controller = new AbortController();
    const progress: number[] = [];
    const pending = provider.sampleMany(
      [coordinateAtPixel(2.5, 2.5)],
      controller.signal,
      (event) => {
        progress.push(event.completedSamples);
      },
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort(new DOMException('Canceled', 'AbortError'));
    server.releaseAll();

    await rejection;
    expect(progress).toEqual([0]);
  });
});
