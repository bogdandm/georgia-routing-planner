import { z } from 'zod';

const colorChannelSchema = z.number().int().min(0).max(255);
const colorSchema = z
  .tuple([colorChannelSchema, colorChannelSchema, colorChannelSchema])
  .readonly();

/** Cached shade masks per worker: 3072 × 272 KiB (brightness plus sunlight grid) = 816 MiB. */
export const terrainShadowMaskCacheLimit = 3072;
/** Most tiles × frames one day playback may precompute; stays below the mask cache. */
export const terrainShadowPlaybackTileLimit = 2560;
/**
 * Lowest tile zoom with terrain-cast shadows. Lower tiles cover too much ground for the
 * DEM march and shade flat ground for the Sun's elevation only.
 */
export const terrainShadowReliefMinZoom = 7;

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
    goldenShadowColor: colorSchema,
    lowSunShadowColor: colorSchema,
    lowSunShadowLift: z.number().min(0).max(1),
    lowSunGlowOpacity: z.number().min(0).max(1),
    alpenglowColor: colorSchema,
    alpenglowOpacity: z.number().min(0).max(1),
    neutralBrightness: z.number().gt(0).lt(2),
    exposure: z.number().min(-2).max(2),
    shadowStrength: z.number().min(0).max(4),
    highlightRolloff: z.number().min(0.05).max(4),
    sunlightTintStrength: z.number().min(0).max(1),
    /** `ShadeLighting`: shade-pass uniforms; part of the cached mask's key. */
    lighting: z
      .object({
        // The lookup table divides by the share and by 2 minus it.
        skyLightShare: z.number().gt(0).lt(1),
        skyOcclusionStrength: z.number().min(0).max(10),
        nightSkyLight: z.number().min(0).max(1),
        nightTopLight: z.number().min(0).max(10),
        // Exponent of a sky occlusion that may be 0, so it must stay above 0.
        nightTopLightFocus: z.number().gt(0).max(20),
        diffuseSkyFraction: z.number().min(0).max(1),
        softEdgeSigmaPixels: z.number().min(0).max(10),
      })
      .strict(),
  })
  .strict()
  .refine(
    (request) => request.x < 2 ** request.z && request.y < 2 ** request.z,
    'The tile address is outside the zoom level.',
  )
  .refine(
    // Flat-ground tiles below the relief zoom read no DEM, so any provider zoom range works.
    (request) =>
      request.demMinZoom <= request.demMaxZoom &&
      (request.z < terrainShadowReliefMinZoom || request.z >= request.demMinZoom),
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

/** 512 px shade bitmap expanded from a cached shade mask; transferred, never copied. */
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
