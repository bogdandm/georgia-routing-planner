import type { AddProtocolAction } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import {
  type ContourTileGenerator,
  withOwnedProtocolBuffers,
} from '@/presentation/map/ContourTileGenerator';

class FakeContourTileGenerator implements ContourTileGenerator {
  public createDemTileUrl(): string {
    return 'filtered-dem://tiles/{z}/{x}/{y}';
  }

  public createTileUrl(intervalMeters: 20 | 25 | 40 | 50 | 100): string {
    return `contour://tiles/{z}/{x}/{y}?minor=${String(intervalMeters)}&major=200`;
  }

  public setFilterEnabled(enabled: boolean): void {
    void enabled;
  }

  public setInteractionActive(active: boolean): void {
    void active;
  }

  public getStatus(): 'inline' {
    return 'inline';
  }

  public getQueueState() {
    return {
      executionMode: 'inline' as const,
      activeCount: 0,
      queuedContourCount: 0,
      queueCapacity: 0,
    };
  }

  public subscribeStatus(): () => void {
    return () => undefined;
  }

  public subscribeQueueState(): () => void {
    return () => undefined;
  }

  public subscribeMetrics(): () => void {
    return () => undefined;
  }

  public dispose(): void {
    void this;
  }
}

describe('ContourTileGenerator contract', () => {
  it('encodes the minor interval while retaining the 200 m index cadence', () => {
    const generator = new FakeContourTileGenerator();

    expect(generator.createTileUrl(50)).toBe(
      'contour://tiles/{z}/{x}/{y}?minor=50&major=200',
    );
  });

  it('exposes the shared filtered DEM URL used by MapLibre and contours', () => {
    expect(new FakeContourTileGenerator().createDemTileUrl()).toBe(
      'filtered-dem://tiles/{z}/{x}/{y}',
    );
  });

  it('returns a fresh buffer when a cached contour tile is requested repeatedly', async () => {
    const cachedBuffer = new Uint8Array([1, 2, 3]).buffer;
    const underlyingProtocol = vi
      .fn<AddProtocolAction>()
      .mockResolvedValue({ data: cachedBuffer });
    const registeredProtocol = withOwnedProtocolBuffers(underlyingProtocol);

    const request = { url: 'contour://fixture/11/1/1' };
    const first = await registeredProtocol(request, new AbortController());
    const second = await registeredProtocol(request, new AbortController());

    expect(first.data).not.toBe(second.data);
    expect(first.data).toBeInstanceOf(ArrayBuffer);
    expect(second.data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(first.data as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint8Array(second.data as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(underlyingProtocol).toHaveBeenCalledTimes(2);
  });
});
