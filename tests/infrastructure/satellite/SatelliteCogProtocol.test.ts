import { describe, expect, it } from 'vitest';

import { satelliteCogTileRequestSchema } from '@/infrastructure/satellite/SatelliteCogProtocol';

const request = {
  sceneKey: 'sentinel-2-l2a:scene-a',
  redHref: 'https://sentinel.example/red.tif',
  greenHref: 'https://sentinel.example/green.tif',
  blueHref: 'https://sentinel.example/blue.tif',
  projectionEpsg: 32_638,
  tuning: { reflectanceMax: 11_000, gamma: 2.25, saturation: 2.5 },
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
        redHref: 'http://private.example/red.tif',
      }),
    ).toThrow();
    expect(() =>
      satelliteCogTileRequestSchema.parse({ ...request, projectionEpsg: 4_326 }),
    ).toThrow();
  });
});
