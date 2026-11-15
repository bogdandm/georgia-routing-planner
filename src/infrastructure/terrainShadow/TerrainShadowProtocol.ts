import { z } from 'zod';

const colorChannelSchema = z.number().int().min(0).max(255);

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
    color: z
      .tuple([colorChannelSchema, colorChannelSchema, colorChannelSchema])
      .readonly(),
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

/** Per-tile worker measurements; `gpuBytes` estimates every worker cache after the tile. */
export interface TerrainShadowTileMetrics {
  readonly computeMs: number;
  readonly demFetchMs: number;
  readonly cacheHit: boolean;
  readonly demTilesFetched: number;
  readonly gpuBytes: number;
  readonly cachedMasks: number;
  readonly cachedDemTiles: number;
}

/** Premultiplied 512 px shade mask; the bitmap is transferred, never copied. */
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

function isTerrainShadowTileMetrics(value: unknown): value is TerrainShadowTileMetrics {
  if (typeof value !== 'object' || value === null) return false;
  const metrics = value as Readonly<Record<string, unknown>>;
  return (
    isFiniteNonNegative(metrics.computeMs) &&
    isFiniteNonNegative(metrics.demFetchMs) &&
    typeof metrics.cacheHit === 'boolean' &&
    isFiniteNonNegative(metrics.demTilesFetched) &&
    isFiniteNonNegative(metrics.gpuBytes) &&
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
