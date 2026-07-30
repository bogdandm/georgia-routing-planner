import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserTerrariumPngCodec } from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
import type { DecodedTerrariumTile } from '@/infrastructure/elevation/TerrariumDemFilter';

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

class FakeBitmap {
  public readonly close = vi.fn();

  public constructor(
    public readonly width: number,
    public readonly height: number,
  ) {}
}

class FakeImageData {
  public static readonly instances: FakeImageData[] = [];

  public constructor(
    public readonly data: Uint8ClampedArray,
    public readonly width: number,
    public readonly height: number,
  ) {
    FakeImageData.instances.push(this);
  }
}

class FakeCanvasContext {
  public readonly drawImage = vi.fn();
  public readonly putImageData = vi.fn();

  public constructor(public imageData: FakeImageData) {}

  public createImageData(width: number, height: number): FakeImageData {
    return new FakeImageData(new Uint8ClampedArray(width * height * 4), width, height);
  }

  public getImageData(): FakeImageData {
    return this.imageData;
  }
}

class FakeOffscreenCanvas {
  public static readonly instances: FakeOffscreenCanvas[] = [];
  public static context: FakeCanvasContext | null;
  public static convertResult: Promise<Blob>;

  public readonly convertToBlob = vi.fn(() => FakeOffscreenCanvas.convertResult);

  public constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    FakeOffscreenCanvas.instances.push(this);
  }

  public getContext(): FakeCanvasContext | null {
    return FakeOffscreenCanvas.context;
  }
}

const sourceBlob = new Blob(['source'], { type: 'image/png' });
const outputBlob = new Blob(['output'], { type: 'image/png' });
let bitmap: FakeBitmap;
let decodedData: Uint8ClampedArray;
let context: FakeCanvasContext;
const createBitmap = vi.fn<() => Promise<FakeBitmap>>();

beforeEach(() => {
  decodedData = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
  bitmap = new FakeBitmap(2, 1);
  context = new FakeCanvasContext(new FakeImageData(decodedData, 2, 1));
  createBitmap.mockReset();
  createBitmap.mockResolvedValue(bitmap);
  FakeImageData.instances.length = 0;
  FakeOffscreenCanvas.instances.length = 0;
  FakeOffscreenCanvas.context = context;
  FakeOffscreenCanvas.convertResult = Promise.resolve(outputBlob);
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrowserTerrariumPngCodec', () => {
  it('returns the exact decoded ImageData buffer and closes the bitmap', async () => {
    const result = await new BrowserTerrariumPngCodec().decode(
      sourceBlob,
      new AbortController().signal,
    );

    expect(result).toEqual({ width: 2, height: 1, data: decodedData });
    expect(result.data).toBe(decodedData);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('copies encoded bytes into DOM-owned ImageData required by checked DOM types', async () => {
    const tile: DecodedTerrariumTile = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]),
    };

    const result = await new BrowserTerrariumPngCodec().encode(
      tile,
      new AbortController().signal,
    );

    expect(result).toBe(outputBlob);
    expect(FakeImageData.instances).toHaveLength(1);
    const image = FakeImageData.instances[0];
    expect(image?.data).not.toBe(tile.data);
    expect(image?.data).toEqual(tile.data);
    expect(image).toMatchObject({ width: 2, height: 1 });
    expect(context.putImageData).toHaveBeenCalledWith(image, 0, 0);
    expect(FakeOffscreenCanvas.instances[0]?.convertToBlob).toHaveBeenCalledWith({
      type: 'image/png',
    });
  });

  it('closes the decoded bitmap when canvas acquisition fails', async () => {
    FakeOffscreenCanvas.context = null;

    await expect(
      new BrowserTerrariumPngCodec().decode(sourceBlob, new AbortController().signal),
    ).rejects.toThrow('Terrarium PNG canvas is unavailable.');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('rejects encoding when canvas acquisition fails', async () => {
    FakeOffscreenCanvas.context = null;
    const tile: DecodedTerrariumTile = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 255]),
    };

    await expect(
      new BrowserTerrariumPngCodec().encode(tile, new AbortController().signal),
    ).rejects.toThrow('Terrarium PNG canvas is unavailable.');
  });

  it('short-circuits decode and encode before browser work when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const codec = new BrowserTerrariumPngCodec();
    const tile: DecodedTerrariumTile = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    };

    await expect(codec.decode(sourceBlob, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(codec.encode(tile, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(createBitmap).not.toHaveBeenCalled();
    expect(FakeOffscreenCanvas.instances).toHaveLength(0);
  });

  it('closes the bitmap when decode is aborted after bitmap creation', async () => {
    const pendingBitmap = deferred<FakeBitmap>();
    createBitmap.mockReturnValueOnce(pendingBitmap.promise);
    const controller = new AbortController();
    const result = new BrowserTerrariumPngCodec().decode(sourceBlob, controller.signal);

    controller.abort();
    pendingBitmap.resolve(bitmap);

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(FakeOffscreenCanvas.instances).toHaveLength(0);
  });

  it('rejects when encode is aborted after PNG conversion', async () => {
    const pendingBlob = deferred<Blob>();
    FakeOffscreenCanvas.convertResult = pendingBlob.promise;
    const controller = new AbortController();
    const tile: DecodedTerrariumTile = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 255]),
    };
    const result = new BrowserTerrariumPngCodec().encode(tile, controller.signal);

    controller.abort();
    pendingBlob.resolve(outputBlob);

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(context.putImageData).toHaveBeenCalledOnce();
  });
});
