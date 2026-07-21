import { describe, expect, it } from 'vitest';

import { satelliteCogTileRequestSchema } from '@/infrastructure/satellite/SatelliteCogProtocol';

const request = {
  sceneKey: 'sentinel-2-l2a:scene-a',
  visualHref: 'https://sentinel.example/visual.tif',
  projectionEpsg: 32_638,
  z: 12,
  x: 2_538,
  y: 1_509,
  tileSize: 256,
} as const;

describe('satelliteCogTileRequestSchema', () => {
  it('accepts a bounded HTTPS UTM tile request', () => {
    expect(satelliteCogTileRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects insecure assets and unsupported projections', () => {
    expect(() =>
      satelliteCogTileRequestSchema.parse({
        ...request,
        visualHref: 'http://private.example/visual.tif',
      }),
    ).toThrow();
    expect(() =>
      satelliteCogTileRequestSchema.parse({ ...request, projectionEpsg: 4_326 }),
    ).toThrow();
  });
});
