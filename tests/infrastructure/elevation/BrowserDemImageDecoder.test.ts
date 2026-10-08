import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserDemImageDecoder } from '@/infrastructure/elevation/BrowserDemImageDecoder';

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

class FakeBitmap {
  public readonly close = vi.fn();

  public constructor(
    public readonly width: number,
    public readonly height: number,
  ) {}
}

class FakeCanvasContext {
  public readonly drawImage = vi.fn();

  public constructor(
    private readonly imageData: { readonly data: Uint8ClampedArray },
  ) {}

  public getImageData(): { readonly data: Uint8ClampedArray } {
    return this.imageData;
  }
}

class FakeOffscreenCanvas {
  public static readonly instances: FakeOffscreenCanvas[] = [];
  public static context: FakeCanvasContext | null;

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

const sourceBlob = new Blob(['source'], { type: 'image/webp' });
let bitmap: FakeBitmap;
let decodedData: Uint8ClampedArray;
let context: FakeCanvasContext;
const createBitmap = vi.fn<() => Promise<FakeBitmap>>();

beforeEach(() => {
  decodedData = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
  bitmap = new FakeBitmap(2, 1);
  context = new FakeCanvasContext({ data: decodedData });
  createBitmap.mockReset();
  createBitmap.mockResolvedValue(bitmap);
  FakeOffscreenCanvas.instances.length = 0;
  FakeOffscreenCanvas.context = context;
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrowserDemImageDecoder', () => {
  it('returns the exact decoded ImageData buffer and closes the bitmap', async () => {
    const result = await new BrowserDemImageDecoder().decode(
      sourceBlob,
      new AbortController().signal,
    );

    expect(result).toEqual({ width: 2, height: 1, data: decodedData });
    expect(result.data).toBe(decodedData);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('closes the decoded bitmap when canvas acquisition fails', async () => {
    FakeOffscreenCanvas.context = null;

    await expect(
      new BrowserDemImageDecoder().decode(sourceBlob, new AbortController().signal),
    ).rejects.toThrow('DEM image canvas is unavailable.');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('short-circuits before browser work when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new BrowserDemImageDecoder().decode(sourceBlob, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(createBitmap).not.toHaveBeenCalled();
    expect(FakeOffscreenCanvas.instances).toHaveLength(0);
  });

  it('closes the bitmap when decode is aborted after bitmap creation', async () => {
    const pendingBitmap = deferred<FakeBitmap>();
    createBitmap.mockReturnValueOnce(pendingBitmap.promise);
    const controller = new AbortController();
    const result = new BrowserDemImageDecoder().decode(sourceBlob, controller.signal);

    controller.abort();
    pendingBitmap.resolve(bitmap);

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(FakeOffscreenCanvas.instances).toHaveLength(0);
  });
});
