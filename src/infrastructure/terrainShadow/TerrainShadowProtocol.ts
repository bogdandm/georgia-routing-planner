import { z } from 'zod';

const colorChannelSchema = z.number().int().min(0).max(255);
const colorSchema = z
  .tuple([colorChannelSchema, colorChannelSchema, colorChannelSchema])
  .readonly();

/** Cached one-byte shade masks per worker: 3072 × 256 KiB = 768 MiB. */
export const terrainShadowMaskCacheLimit = 3072;
/** Most tiles × frames one day playback may precompute; stays below the mask cache. */
export const terrainShadowPlaybackTileLimit = 2560;

export const terrainShadowTileRequestSchema = z
  .object({
    z: z.number().int().min(0).max(12),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    instantMs: z.number(),
    tileSize: z.literal(512),
    demTileUrl: z
      .string()
      .startsWith('https://')
      .refine(
        (value) => ['{z}', '{x}', '{y}'].every((token) => value.includes(token)),
        'The DEM tile URL must contain {z}, {x}, and {y}.',
      ),
    demMinZoom: z.number().int().min(0).max(22),
    demMaxZoom: z.number().int().min(0).max(22),
    shadowColor: colorSchema,
    highlightColor: colorSchema,
    highlightOpacity: z.number().min(0).max(1),
  })
  .strict()
  .refine(
    (request) => request.x < 2 ** request.z && request.y < 2 ** request.z,
    'The tile address is outside the zoom level.',
  )
  .refine(
    (request) =>
      request.demMinZoom <= request.demMaxZoom && request.z >= request.demMinZoom,
    'The tile zoom is outside the DEM zoom range.',
  );

export type TerrainShadowTileRequest = z.infer<typeof terrainShadowTileRequestSchema>;

/**
 * Per-tile worker measurements; `memoryBytes` estimates worker memory after the tile:
 * GPU textures plus cached shade masks.
 */
export interface TerrainShadowTileMetrics {
  readonly computeMs: number;
  readonly demFetchMs: number;
  readonly cacheHit: boolean;
  readonly demTilesFetched: number;
  readonly memoryBytes: number;
  readonly cachedMasks: number;
  readonly cachedDemTiles: number;
}

/** 512 px shade bitmap expanded from a cached one-byte mask; transferred, never copied. */
export interface TerrainShadowTileResult {
  readonly bitmap: ImageBitmap;
  readonly metrics: TerrainShadowTileMetrics;
}

/**
 * Remote error code for a browser without WebGL2 float render targets or a GPU that
 * cannot build the shadow shaders. The main thread treats it as permanent unavailability.
 */
export const terrainShadowUnavailableErrorCode = 'terrain-shadow-unavailable';

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isTerrainShadowTileMetrics(
  value: unknown,
): value is TerrainShadowTileMetrics {
  if (typeof value !== 'object' || value === null) return false;
  const metrics = value as Readonly<Record<string, unknown>>;
  return (
    isFiniteNonNegative(metrics.computeMs) &&
    isFiniteNonNegative(metrics.demFetchMs) &&
    typeof metrics.cacheHit === 'boolean' &&
    isFiniteNonNegative(metrics.demTilesFetched) &&
    isFiniteNonNegative(metrics.memoryBytes) &&
    isFiniteNonNegative(metrics.cachedMasks) &&
    isFiniteNonNegative(metrics.cachedDemTiles)
  );
}

export function isTerrainShadowTileResult(
  value: unknown,
): value is TerrainShadowTileResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bitmap' in value &&
    'metrics' in value &&
    typeof ImageBitmap !== 'undefined' &&
    value.bitmap instanceof ImageBitmap &&
    isTerrainShadowTileMetrics(value.metrics)
  );
}
