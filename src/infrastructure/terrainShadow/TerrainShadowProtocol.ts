import { z } from 'zod';

const colorChannelSchema = z.number().int().min(0).max(255);
const colorSchema = z
  .tuple([colorChannelSchema, colorChannelSchema, colorChannelSchema])
  .readonly();

/**
 * Cached shade masks per worker, also bounded by an 816 MiB budget of compressed bytes
 * (`terrainShadowMaskCodec.ts`). Measured worst real masks (~565 KiB) fit about 1480,
 * typical (~400 KiB) about 2090, so this count stays above the playback budget.
 */
export const terrainShadowMaskCacheLimit = 1536;
/** Most tiles × frames one day playback may precompute; fits worst measured masks. */
export const terrainShadowPlaybackTileLimit = 1400;
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
    alpenglowColor: colorSchema,
    alpenglowOpacity: z.number().min(0).max(1),
    neutralBrightness: z.number().gt(0).lt(2),
    exposure: z.number().min(-2).max(2),
    shadowStrength: z.number().min(0).max(4),
    highlightRolloff: z.number().min(0.05).max(4),
    /** `ShadeLighting`: shade-pass uniforms; part of the cached mask's key. */
    lighting: z
      .object({
        // Weights the independently stored direct and sky irradiance channels.
        skyLightShare: z.number().min(0).max(1),
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
 * Worker stages a tile may pass, each timed in milliseconds:
 * - `queueWait`: waiting for the worker's single GPU queue;
 * - `interactionGate`: a map tile's wait at the head of that queue for the end of a
 *   camera move;
 * - `assembly` (DEM mosaics and their maximum reductions), `skyView`, `visibility`,
 *   `shade`, and `readbackCopy` (the shade target into a pixel-pack buffer): GPU time
 *   from `EXT_disjoint_timer_query_webgl2`, absent without the extension or after a
 *   disjoint GPU event;
 * - `gpuWait`: the fence wait for those passes;
 * - `readback`: reading that buffer into the CPU mask;
 * - `maskCodec`: compressing masks the cache can no longer keep uncompressed, or
 *   expanding a compressed one;
 * - `flatMask`: the CPU flat-ground draft or coarse tile;
 * - `expand`: coloring the mask into RGBA pixels; `bitmap`: `createImageBitmap`.
 */
export const terrainShadowTileStages = [
  'queueWait',
  'interactionGate',
  'assembly',
  'skyView',
  'visibility',
  'shade',
  'readbackCopy',
  'gpuWait',
  'readback',
  'maskCodec',
  'flatMask',
  'expand',
  'bitmap',
] as const;
export type TerrainShadowTileStage = (typeof terrainShadowTileStages)[number];
/** Stages a tile skipped (cache hits, no timer queries) are absent. */
export type TerrainShadowTileStageTimings = Readonly<
  Partial<Record<TerrainShadowTileStage, number>>
>;

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
  readonly stages: TerrainShadowTileStageTimings;
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

function isStageTimings(value: unknown): value is TerrainShadowTileStageTimings {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).every(
    ([stage, ms]) =>
      (terrainShadowTileStages as readonly string[]).includes(stage) &&
      isFiniteNonNegative(ms),
  );
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
    isFiniteNonNegative(metrics.cachedDemTiles) &&
    isStageTimings(metrics.stages)
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
