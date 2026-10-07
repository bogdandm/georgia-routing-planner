import { z } from 'zod';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';

/** Versioned, compute-only configuration accepted at the terrain worker boundary. */
export const terrainComputeConfigurationSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    tileUrl: z.string().min(1),
    encoding: z.enum(['mapbox', 'terrarium']),
    maximumSourceZoom: z.number().int().nonnegative(),
    contourCacheSize: z.number().int().positive(),
    requestTimeoutMs: z.number().int().nonnegative(),
  })
  .readonly();

export type TerrainComputeConfiguration = z.infer<
  typeof terrainComputeConfigurationSchema
>;

/** Strips provider and presentation metadata before configuration crosses the worker. */
export function toTerrainComputeConfiguration(
  terrain: MapProviderConfiguration['terrain'],
  requestTimeoutMs: number,
): TerrainComputeConfiguration {
  return terrainComputeConfigurationSchema.parse({
    schemaVersion: 2,
    tileUrl: terrain.tileUrl,
    encoding: terrain.encoding,
    maximumSourceZoom: terrain.maxZoom,
    contourCacheSize: terrain.overlays.contourCacheSize,
    requestTimeoutMs,
  });
}
