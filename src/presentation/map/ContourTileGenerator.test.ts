import { describe, expect, it } from 'vitest';

import type { ContourTileGenerator } from '@/presentation/map/ContourTileGenerator';

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
});
