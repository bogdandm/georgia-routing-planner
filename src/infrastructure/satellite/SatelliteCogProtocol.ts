import { z } from 'zod';

export const satelliteCogTileRequestSchema = z
  .object({
    sceneKey: z.string().min(1).max(512),
    visualHref: z.url().startsWith('https://'),
    projectionEpsg: z.number().int().min(32_601).max(32_660),
    z: z.number().int().min(0).max(14),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    tileSize: z.literal(256),
  })
  .strict();

export type SatelliteCogTileRequest = z.infer<typeof satelliteCogTileRequestSchema>;

export interface SatelliteCogTileResult {
  readonly data: ArrayBuffer;
}

export function isSatelliteCogTileResult(
  value: unknown,
): value is SatelliteCogTileResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    value.data instanceof ArrayBuffer
  );
}
