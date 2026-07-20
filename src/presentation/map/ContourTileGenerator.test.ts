import { describe, expect, it } from 'vitest';

import { type ContourTileGenerator } from '@/presentation/map/ContourTileGenerator';

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
});
