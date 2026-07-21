import { z } from 'zod';

import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';

const terrainComputeFilterSchema = z
  .strictObject({
    minimumElevationMeters: z.number(),
    maximumElevationMeters: z.number(),
    sentinelElevationsMeters: z.array(z.number()).readonly(),
    spikeThresholdMeters: z.number().positive(),
    negativeSpikeThresholdMeters: z.number().positive(),
    maximumNeighborMadMeters: z.number().positive(),
    minimumConsensusNeighbors: z.number().int().min(3).max(8),
    maximumSpikeSupportNeighbors: z.number().int().min(0).max(3),
    cacheSize: z.number().int().positive(),
  })
  .readonly();

/** Versioned, compute-only configuration accepted at the terrain worker boundary. */
export const terrainComputeConfigurationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    tileUrl: z.string().min(1),
    encoding: z.enum(['mapbox', 'terrarium']),
    maximumSourceZoom: z.number().int().nonnegative(),
    filter: terrainComputeFilterSchema,
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
    schemaVersion: 1,
    tileUrl: terrain.tileUrl,
    encoding: terrain.encoding,
    maximumSourceZoom: terrain.maxZoom,
    filter: {
      minimumElevationMeters: terrain.filter.minimumElevationMeters,
      maximumElevationMeters: terrain.filter.maximumElevationMeters,
      sentinelElevationsMeters: [...terrain.filter.sentinelElevationsMeters],
      spikeThresholdMeters: terrain.filter.spikeThresholdMeters,
      negativeSpikeThresholdMeters: terrain.filter.negativeSpikeThresholdMeters,
      maximumNeighborMadMeters: terrain.filter.maximumNeighborMadMeters,
      minimumConsensusNeighbors: terrain.filter.minimumConsensusNeighbors,
      maximumSpikeSupportNeighbors: terrain.filter.maximumSpikeSupportNeighbors,
      cacheSize: terrain.filter.cacheSize,
    },
    contourCacheSize: terrain.overlays.contourCacheSize,
    requestTimeoutMs,
  });
}
