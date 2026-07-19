import type { AddProtocolAction } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import {
  type ContourTileGenerator,
  withOwnedProtocolBuffers,
} from '@/presentation/map/ContourTileGenerator';

class FakeContourTileGenerator implements ContourTileGenerator {
  public createTileUrl(intervalMeters: 20 | 25 | 40 | 50 | 100): string {
    return `contour://tiles/{z}/{x}/{y}?minor=${String(intervalMeters)}&major=200`;
  }
}

describe('ContourTileGenerator contract', () => {
  it('encodes the minor interval while retaining the 200 m index cadence', () => {
    const generator = new FakeContourTileGenerator();

    expect(generator.createTileUrl(50)).toBe(
      'contour://tiles/{z}/{x}/{y}?minor=50&major=200',
    );
  });

  it('returns a fresh buffer when a cached contour tile is requested repeatedly', async () => {
    const cachedBuffer = new Uint8Array([1, 2, 3]).buffer;
    const underlyingProtocol = vi
      .fn<AddProtocolAction>()
      .mockResolvedValue({ data: cachedBuffer });
    const registeredProtocol = withOwnedProtocolBuffers(underlyingProtocol);

    const request = { url: 'contour://fixture/11/1/1' };
    const first = await registeredProtocol(
      request,
      new AbortController(),
    );
    const second = await registeredProtocol(
      request,
      new AbortController(),
    );

    expect(first.data).not.toBe(second.data);
    expect(first.data).toBeInstanceOf(ArrayBuffer);
    expect(second.data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(first.data as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint8Array(second.data as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(underlyingProtocol).toHaveBeenCalledTimes(2);
  });
});
