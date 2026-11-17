import { subsolarPoint } from '@/domain/terrain/solarPosition';
import { terrainShadowModel } from '@/domain/terrain/terrainShadow';
import {
  compressShadeMask,
  expandCompressedShadeMask,
  type ShadeMaskPrecision,
} from '@/infrastructure/terrainShadow/terrainShadowMaskCodec';
import {
  type TerrainShadowTileMetrics,
  type TerrainShadowTileRequest,
  type TerrainShadowTileResult,
  type TerrainShadowTileStage,
  terrainShadowMaskCacheLimit,
  terrainShadowReliefMinZoom,
  terrainShadowUnavailableErrorCode,
} from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import {
  createFlatShadeMask,
  createShadeColorizer,
  expandShadeMask,
  fullscreenVertexShaderSource,
  maximumReductionFactor,
  maximumReductionFragmentShaderSource,
  type ShadeColorizer,
  type ShadeMask,
  type ShadePalette,
  shadeMaskBytes,
  sunlightGridSize,
  sunlightGridStride,
  sunlightNightCode,
  terrainShadowShadeFragmentShaderSource,
  terrainShadowVisibilityFragmentShaderSource,
  terrainShadowVisibilitySize,
  terrainSkyViewFragmentShaderSource,
  terrainSkyViewSize,
  terrariumDecodeFragmentShaderSource,
} from '@/infrastructure/terrainShadow/terrainShadowShaders';
import {
  demTileUrl,
  isTerrainShadowNightTile,
  type TerrainShadowMosaicLevel,
  terrainShadowLevelZooms,
  terrainShadowMosaicLevel,
  terrainShadowMosaicSize,
  terrainShadowMosaicTiles,
  terrainShadowTileGeometry,
  terrainShadowTileSize,
} from '@/infrastructure/terrainShadow/terrainShadowTiles';

/**
 * Decoded R32F DEM tiles kept on the GPU (1 MiB each). One 1600 × 1000 px view of
 * mountains at pitch 60° reads about 100–110 DEM tiles across its three mosaic levels,
 * so the whole view stays cached and a new instant reuses it instead of refetching.
 */
const maximumCachedDemTiles = 128;
/** Preserve the previous approximate mask-memory ceiling independently of frame count. */
const maximumCachedMaskBytes = 816 * 1024 * 1024;
/**
 * New masks kept uncompressed (2 MiB each) until the renderer is idle: more than one
 * view's tiles, so DEFLATE never delays a view, while sustained work stays bounded.
 */
const maximumUncompressedMasks = 32;
/**
 * Cast-shadow visibility (per tile and minute) and sky view (per tile) textures kept on
 * the GPU, so new shade-pass lighting redraws only the shade pass of the tiles in view:
 * 48 × (266 KiB + 16 KiB) ≈ 13 MiB.
 */
const maximumCachedGeometryTextures = 48;
/** Source-color coefficients kept, so switching between a few palettes reuses them. */
const maximumCachedShadeColorizers = 4;
/** Horizontal bands per visibility pass, flushed separately to keep GPU submissions short. */
const shadowPassBands = 8;
const rgbaChannels = 4;
const bytesPerFloat = Float32Array.BYTES_PER_ELEMENT;
const tilePixels = terrainShadowTileSize * terrainShadowTileSize;
const tileBytes = tilePixels * bytesPerFloat;
const shadeTargetBytes = tilePixels * rgbaChannels * bytesPerFloat;
const visibilityBytes = terrainShadowVisibilitySize * terrainShadowVisibilitySize;
const skyViewBytes = terrainSkyViewSize * terrainSkyViewSize;
/** Plain night shade, for night tiles without night-sky light. */
const nightMask: ShadeMask = {
  direct: new Float32Array(tilePixels),
  sky: new Float32Array(tilePixels),
  sunlight: new Uint8Array(sunlightGridSize * sunlightGridSize).fill(sunlightNightCode),
};

/** Uniforms every tile pass reads; the rest are only active in some passes. */
const tileUniformNames = [
  'uMosaic0',
  'uLevelOrigin',
  'uLevelTexelsPerOutputPixel',
  'uTileMercatorY',
  'uBaseResolutionEquatorMeters',
] as const;
/**
 * Longitude only matters for the Sun's position, so drivers drop `uTileLongitude` from
 * the sky-view pass, which needs neither.
 */
const sunUniformNames = ['uTileLongitude', 'uSubsolar'] as const;
/** Passes that march across every mosaic level. */
const marchUniformNames = [
  ...tileUniformNames,
  'uMosaic1',
  'uMosaic2',
  'uLevelMaximum',
  'uLevelTexelsPerRadian',
] as const;
const visibilityUniformNames = [...marchUniformNames, ...sunUniformNames] as const;
const shadeUniformNames = [
  ...tileUniformNames,
  ...sunUniformNames,
  'uVisibility',
  'uSkyView',
  'uSkyLightShare',
  'uSkyOcclusionStrength',
  'uNightSkyLight',
  'uNightTopLight',
  'uNightTopLightFocus',
  'uDiffuseSkyFraction',
  'uSoftEdgeSigma',
] as const;
const reductionUniformNames = ['uSource', 'uSourceSize', 'uTargetOrigin'] as const;
/** Texture units of the shade pass's own inputs, after the four mosaic units. */
const visibilityTextureUnit = 4;
const skyViewTextureUnit = 5;

type UniformLocations<TName extends string> = Readonly<
  Record<TName, WebGLUniformLocation>
>;

/** The `EXT_disjoint_timer_query_webgl2` constants the stage timer reads. */
interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: GLenum;
  readonly GPU_DISJOINT_EXT: GLenum;
}

type GpuStage = Extract<
  TerrainShadowTileStage,
  'assembly' | 'skyView' | 'visibility' | 'shade' | 'readbackCopy'
>;
type StageTimings = Partial<Record<TerrainShadowTileStage, number>>;
/** Event-loop turns `GpuStageTimer.read` waits for results before dropping them. */
const maximumTimerQueryPolls = 20;

interface ShaderProgram<TName extends string> {
  readonly program: WebGLProgram;
  readonly uniforms: UniformLocations<TName>;
}

interface ReductionStage {
  readonly texture: WebGLTexture;
  readonly size: number;
}

interface GpuResources {
  readonly gl: WebGL2RenderingContext;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly decodeProgram: ShaderProgram<'uEncoded'>;
  readonly reductionProgram: ShaderProgram<(typeof reductionUniformNames)[number]>;
  readonly visibilityProgram: ShaderProgram<(typeof visibilityUniformNames)[number]>;
  readonly shadeProgram: ShaderProgram<(typeof shadeUniformNames)[number]>;
  /** Marches every mosaic level like the visibility pass, without the Sun. */
  readonly skyViewProgram: ShaderProgram<(typeof marchUniformNames)[number]>;
  /** RGBA8 staging texture for one encoded DEM upload. */
  readonly encodedTexture: WebGLTexture;
  readonly readFramebuffer: WebGLFramebuffer;
  readonly drawFramebuffer: WebGLFramebuffer;
  readonly mosaics: readonly [WebGLTexture, WebGLTexture, WebGLTexture];
  readonly reductionStages: readonly ReductionStage[];
  /** 3×1 R32F: texel i holds the maximum elevation of LOD level i. */
  readonly levelMaximum: WebGLTexture;
  /** RGBA32F shade target: weighted direct/sky energies and the sunlight code. */
  readonly shadeTexture: WebGLTexture;
  /** Reused FLOAT RGBA readback of `shadeTexture`. */
  readonly readback: Float32Array;
  /** GPU-side copy of `shadeTexture` that `readback` is filled from after the fence. */
  readonly readbackBuffer: WebGLBuffer;
  readonly staticBytes: number;
  /** Null where the browser does not expose GPU timer queries. */
  readonly timerQuery: TimerQueryExtension | null;
}

function readTimerQueryExtension(
  gl: WebGL2RenderingContext,
): TimerQueryExtension | null {
  const extension: unknown = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (typeof extension !== 'object' || extension === null) return null;
  const { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT } = extension as Record<string, unknown>;
  return typeof TIME_ELAPSED_EXT === 'number' && typeof GPU_DISJOINT_EXT === 'number'
    ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
    : null;
}

/** Timer queries around the passes of one GPU job, read after the GPU has run them. */
class GpuStageTimer {
  readonly #gl: WebGL2RenderingContext;
  readonly #extension: TimerQueryExtension | null;
  readonly #queries: { readonly stage: GpuStage; readonly query: WebGLQuery }[] = [];

  public constructor(gpu: GpuResources) {
    this.#gl = gpu.gl;
    this.#extension = gpu.timerQuery;
  }

  public measure(stage: GpuStage, draw: () => void): void {
    const extension = this.#extension;
    if (extension === null) {
      draw();
      return;
    }
    const gl = this.#gl;
    const query = gl.createQuery();
    gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    try {
      draw();
    } finally {
      gl.endQuery(extension.TIME_ELAPSED_EXT);
    }
    this.#queries.push({ stage, query });
  }

  /**
   * GPU milliseconds per measured stage. WebGL only makes query results available after
   * the issuing task returned to the event loop, so this yields; a disjoint GPU event
   * (clock change, context switch) or results still missing after the polls drop all.
   */
  public async read(): Promise<StageTimings> {
    const gl = this.#gl;
    const extension = this.#extension;
    const last = this.#queries.at(-1);
    if (extension === null || last === undefined) return {};
    const available = () =>
      gl.getQueryParameter(last.query, gl.QUERY_RESULT_AVAILABLE) === true;
    for (let poll = 0; poll < maximumTimerQueryPolls && !available(); poll += 1) {
      await yieldToEventLoop();
    }
    const valid = available() && gl.getParameter(extension.GPU_DISJOINT_EXT) !== true;
    const timings: StageTimings = {};
    for (const { stage, query } of this.#queries) {
      if (valid) {
        const nanoseconds: unknown = gl.getQueryParameter(query, gl.QUERY_RESULT);
        if (typeof nanoseconds === 'number') {
          timings[stage] = (timings[stage] ?? 0) + nanoseconds / 1e6;
        }
      }
      gl.deleteQuery(query);
    }
    return timings;
  }
}

interface ShadeMaskResult {
  readonly mask: ShadeMask;
  readonly metrics: TerrainShadowTileMetrics;
  /** GPU pass times of a freshly computed mask; they become readable a little later. */
  readonly gpuStages: Promise<StageTimings> | null;
}

/**
 * A cached shade mask: as computed until the renderer compresses it while idle, then as
 * `compressShadeMask` bytes.
 */
type CachedMask =
  | { readonly mask: ShadeMask; readonly precision: ShadeMaskPrecision }
  | { readonly compressed: Uint8Array };

/** One mask being computed, shared by every request that wants it meanwhile. */
interface MaskComputation {
  readonly promise: Promise<ShadeMaskResult>;
  readonly controller: AbortController;
  waiters: number;
  /** `full` once any waiter asks for it; read when the mask is stored. */
  precision: ShadeMaskPrecision;
  /** Whether a waiter already reported the computation's metrics. */
  reported: boolean;
}

/** Decoded DEM tile; `texture === null` is a 404 tile treated as sea level 0 m. */
interface DemTileEntry {
  readonly texture: WebGLTexture | null;
}

interface InflightDemFetch {
  readonly promise: Promise<void>;
  readonly controller: AbortController;
  waiters: number;
}

class TerrainShadowUnavailableError extends Error {
  public readonly code = terrainShadowUnavailableErrorCode;

  public constructor(message: string) {
    super(message);
    this.name = 'TerrainShadowUnavailableError';
  }
}

function abortError(): DOMException {
  return new DOMException('Terrain shadow tile request canceled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function contextLostError(): Error {
  return new Error('The terrain shadow WebGL context was lost.');
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(abortError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Lets queued RPC cancel messages arrive before the next GPU job starts. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null)
    throw new TerrainShadowUnavailableError('WebGL shader allocation failed.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new TerrainShadowUnavailableError(
      `Terrain shadow shader failed to compile: ${log}`,
    );
  }
  return shader;
}

function createProgram<TName extends string>(
  gl: WebGL2RenderingContext,
  fragmentSource: string,
  uniformNames: readonly TName[],
): ShaderProgram<TName> {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    fullscreenVertexShaderSource,
  );
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program) ?? '';
    throw new TerrainShadowUnavailableError(
      `Terrain shadow program failed to link: ${log}`,
    );
  }
  const uniforms: Partial<Record<TName, WebGLUniformLocation>> = {};
  for (const name of uniformNames) {
    const location = gl.getUniformLocation(program, name);
    if (location === null) {
      throw new TerrainShadowUnavailableError(
        `Terrain shadow uniform ${name} is missing.`,
      );
    }
    uniforms[name] = location;
  }
  return { program, uniforms: uniforms as UniformLocations<TName> };
}

function createTexture(
  gl: WebGL2RenderingContext,
  internalFormat: GLenum,
  width: number,
  height: number,
): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function createGpuResources(onContextLost: () => void): GpuResources {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new TerrainShadowUnavailableError(
      'OffscreenCanvas is unavailable in this worker.',
    );
  }
  // Every pass renders into textures; the default framebuffer is never drawn.
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (gl === null) throw new TerrainShadowUnavailableError('WebGL2 is unavailable.');
  if (gl.getExtension('EXT_color_buffer_float') === null) {
    throw new TerrainShadowUnavailableError(
      'WebGL2 float render targets are unavailable.',
    );
  }
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    onContextLost();
  });

  const decodeProgram = createProgram(gl, terrariumDecodeFragmentShaderSource, [
    'uEncoded',
  ] as const);
  const reductionProgram = createProgram(
    gl,
    maximumReductionFragmentShaderSource,
    reductionUniformNames,
  );
  const visibilityProgram = createProgram(
    gl,
    terrainShadowVisibilityFragmentShaderSource,
    visibilityUniformNames,
  );
  const shadeProgram = createProgram(
    gl,
    terrainShadowShadeFragmentShaderSource,
    shadeUniformNames,
  );
  const skyViewProgram = createProgram(
    gl,
    terrainSkyViewFragmentShaderSource,
    marchUniformNames,
  );
  const mosaicSize = terrainShadowMosaicSize;
  const mosaics = [
    createTexture(gl, gl.R32F, mosaicSize, mosaicSize),
    createTexture(gl, gl.R32F, mosaicSize, mosaicSize),
    createTexture(gl, gl.R32F, mosaicSize, mosaicSize),
  ] as const;
  // Intermediate maxima (1536 → 192 → 24 → 3); the last pass writes `levelMaximum`.
  const reductionStages: ReductionStage[] = [];
  let reducedSize = Math.ceil(mosaicSize / maximumReductionFactor);
  while (reducedSize > 1) {
    reductionStages.push({
      texture: createTexture(gl, gl.R32F, reducedSize, reducedSize),
      size: reducedSize,
    });
    reducedSize = Math.ceil(reducedSize / maximumReductionFactor);
  }
  const levelMaximum = createTexture(gl, gl.R32F, mosaics.length, 1);
  const encodedTexture = createTexture(
    gl,
    gl.RGBA8,
    terrainShadowTileSize,
    terrainShadowTileSize,
  );
  const shadeTexture = createTexture(
    gl,
    gl.RGBA32F,
    terrainShadowTileSize,
    terrainShadowTileSize,
  );
  const readback = new Float32Array(tilePixels * rgbaChannels);
  const readbackBuffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readbackBuffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, readback.byteLength, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const staticBytes =
    // Encoded staging texture, float shade target, its GPU copy, and its CPU readback.
    tileBytes +
    shadeTargetBytes +
    2 * readback.byteLength +
    mosaics.length * mosaicSize * mosaicSize * bytesPerFloat +
    reductionStages.reduce(
      (sum, stage) => sum + stage.size * stage.size * bytesPerFloat,
      0,
    ) +
    mosaics.length * bytesPerFloat;

  return {
    gl,
    vertexArray: gl.createVertexArray(),
    decodeProgram,
    reductionProgram,
    visibilityProgram,
    shadeProgram,
    skyViewProgram,
    encodedTexture,
    readFramebuffer: gl.createFramebuffer(),
    drawFramebuffer: gl.createFramebuffer(),
    mosaics,
    reductionStages,
    levelMaximum,
    shadeTexture,
    readback,
    readbackBuffer,
    staticBytes,
    timerQuery: readTimerQueryExtension(gl),
  };
}

/** R8 visible solar-disk fraction for the tile plus the blur margin. */
function createVisibilityTexture(gl: WebGL2RenderingContext): WebGLTexture {
  return createTexture(
    gl,
    gl.R8,
    terrainShadowVisibilitySize,
    terrainShadowVisibilitySize,
  );
}

/** R8 open-sky share on the `terrainSkyViewSize` grid, read with linear filtering. */
function createSkyViewTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = createTexture(gl, gl.R8, terrainSkyViewSize, terrainSkyViewSize);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

function attachDrawTarget(gpu: GpuResources, texture: WebGLTexture): void {
  const { gl } = gpu;
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, gpu.drawFramebuffer);
  gl.framebufferTexture2D(
    gl.DRAW_FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
}

function drawFullscreen(gpu: GpuResources): void {
  gpu.gl.bindVertexArray(gpu.vertexArray);
  gpu.gl.drawArrays(gpu.gl.TRIANGLES, 0, 3);
}

/**
 * Resolves once the GPU has executed every command issued so far. Polls a fence between
 * event-loop tasks instead of a pixel readback, so the worker never blocks on the GPU.
 */
async function waitForGpu(gl: WebGL2RenderingContext): Promise<void> {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (sync === null) return;
  gl.flush();
  try {
    while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  } finally {
    gl.deleteSync(sync);
  }
}

/** Uploads one Terrarium bitmap and decodes it on the GPU into an R32F meter texture. */
function decodeDemTile(gpu: GpuResources, bitmap: ImageBitmap): WebGLTexture {
  const { gl } = gpu;
  const texture = createTexture(
    gl,
    gl.R32F,
    terrainShadowTileSize,
    terrainShadowTileSize,
  );
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gpu.encodedTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  attachDrawTarget(gpu, texture);
  gl.disable(gl.SCISSOR_TEST);
  gl.viewport(0, 0, terrainShadowTileSize, terrainShadowTileSize);
  gl.useProgram(gpu.decodeProgram.program);
  gl.uniform1i(gpu.decodeProgram.uniforms.uEncoded, 0);
  drawFullscreen(gpu);
  return texture;
}

/** Copies the 3×3 decoded tiles into one level mosaic; missing rows become 0 m. */
function assembleMosaic(
  gpu: GpuResources,
  target: WebGLTexture,
  tiles: readonly (WebGLTexture | null)[],
): void {
  const { gl } = gpu;
  const size = terrainShadowTileSize;
  attachDrawTarget(gpu, target);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gpu.readFramebuffer);
  gl.enable(gl.SCISSOR_TEST);
  tiles.forEach((texture, slot) => {
    const x = (slot % terrainShadowMosaicTiles) * size;
    const y = Math.floor(slot / terrainShadowMosaicTiles) * size;
    gl.scissor(x, y, size, size);
    if (texture === null) {
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      return;
    }
    gl.framebufferTexture2D(
      gl.READ_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    gl.blitFramebuffer(
      0,
      0,
      size,
      size,
      x,
      y,
      x + size,
      y + size,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  });
  gl.disable(gl.SCISSOR_TEST);
}

/** Folds one mosaic down to its maximum elevation in texel `level` of `levelMaximum`. */
function reduceMaximum(gpu: GpuResources, mosaic: WebGLTexture, level: number): void {
  const { gl, reductionProgram } = gpu;
  gl.useProgram(reductionProgram.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(reductionProgram.uniforms.uSource, 0);
  let source = mosaic;
  let sourceSize = terrainShadowMosaicSize;
  const passes = [
    ...gpu.reductionStages.map((stage) => ({ ...stage, originX: 0 })),
    { texture: gpu.levelMaximum, size: 1, originX: level },
  ];
  for (const pass of passes) {
    attachDrawTarget(gpu, pass.texture);
    gl.viewport(pass.originX, 0, pass.size, pass.size);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform2i(reductionProgram.uniforms.uSourceSize, sourceSize, sourceSize);
    gl.uniform2i(reductionProgram.uniforms.uTargetOrigin, pass.originX, 0);
    drawFullscreen(gpu);
    source = pass.texture;
    sourceSize = pass.size;
  }
}

/** Sets the tile and finest-level uniforms every tile pass reads. */
function setTileUniforms(
  gl: WebGL2RenderingContext,
  uniforms: UniformLocations<(typeof tileUniformNames)[number]>,
  request: TerrainShadowTileRequest,
  levels: readonly TerrainShadowMosaicLevel[],
): void {
  const geometry = terrainShadowTileGeometry(request);
  const finestZoom = levels[0]?.zoom ?? request.z;
  gl.uniform1i(uniforms.uMosaic0, 0);
  gl.uniform2fv(
    uniforms.uLevelOrigin,
    levels.flatMap((level) => [...level.outputOriginTexels]),
  );
  gl.uniform1fv(
    uniforms.uLevelTexelsPerOutputPixel,
    levels.map((level) => level.texelsPerOutputPixel),
  );
  gl.uniform2f(
    uniforms.uTileMercatorY,
    geometry.northMercatorY,
    geometry.mercatorYSpan,
  );
  gl.uniform1f(
    uniforms.uBaseResolutionEquatorMeters,
    (2 * Math.PI * terrainShadowModel.earthRadiusMeters) /
      (2 ** finestZoom * terrainShadowTileSize),
  );
}

/** Sets the tile's longitude and the subsolar point of the request's instant. */
function setSunUniforms(
  gl: WebGL2RenderingContext,
  uniforms: UniformLocations<(typeof sunUniformNames)[number]>,
  request: TerrainShadowTileRequest,
): void {
  const geometry = terrainShadowTileGeometry(request);
  const sun = subsolarPoint(new Date(request.instantMs));
  gl.uniform2f(
    uniforms.uTileLongitude,
    geometry.westLongitudeRadians,
    geometry.longitudeSpanRadians,
  );
  gl.uniform2f(uniforms.uSubsolar, sun.declinationRadians, sun.longitudeRadians);
}

/**
 * Binds the mosaic levels and their maxima to texture units 0–3 and selects `program`
 * with every uniform of a pass that marches across the levels.
 */
function bindMarchProgram(
  gpu: GpuResources,
  program: ShaderProgram<(typeof marchUniformNames)[number]>,
  request: TerrainShadowTileRequest,
  levels: readonly TerrainShadowMosaicLevel[],
): void {
  const { gl } = gpu;
  const textures = [gpu.mosaics[0], gpu.mosaics[1], gpu.mosaics[2], gpu.levelMaximum];
  textures.forEach((texture, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  });
  gl.useProgram(program.program);
  const { uniforms } = program;
  setTileUniforms(gl, uniforms, request, levels);
  gl.uniform1i(uniforms.uMosaic1, 1);
  gl.uniform1i(uniforms.uMosaic2, 2);
  gl.uniform1i(uniforms.uLevelMaximum, 3);
  gl.uniform1fv(
    uniforms.uLevelTexelsPerRadian,
    levels.map((level) => level.texelsPerRadian),
  );
}

/** Computes the tile's open-sky share into `target` from the assembled mosaics. */
function drawSkyView(
  gpu: GpuResources,
  target: WebGLTexture,
  request: TerrainShadowTileRequest,
  levels: readonly TerrainShadowMosaicLevel[],
): void {
  attachDrawTarget(gpu, target);
  gpu.gl.viewport(0, 0, terrainSkyViewSize, terrainSkyViewSize);
  bindMarchProgram(gpu, gpu.skyViewProgram, request, levels);
  drawFullscreen(gpu);
  gpu.gl.flush();
}

/** Marches the horizon toward the request's Sun into `target`. */
function drawVisibility(
  gpu: GpuResources,
  target: WebGLTexture,
  request: TerrainShadowTileRequest,
  levels: readonly TerrainShadowMosaicLevel[],
): void {
  const { gl, visibilityProgram } = gpu;
  attachDrawTarget(gpu, target);
  gl.viewport(0, 0, terrainShadowVisibilitySize, terrainShadowVisibilitySize);
  bindMarchProgram(gpu, visibilityProgram, request, levels);
  setSunUniforms(gl, visibilityProgram.uniforms, request);
  const bandHeight = Math.ceil(terrainShadowVisibilitySize / shadowPassBands);
  gl.enable(gl.SCISSOR_TEST);
  for (let band = 0; band < shadowPassBands; band += 1) {
    gl.scissor(0, band * bandHeight, terrainShadowVisibilitySize, bandHeight);
    drawFullscreen(gpu);
    gl.flush();
  }
  gl.disable(gl.SCISSOR_TEST);
}

/** Lights the slopes into `shadeTexture` from the tile's visibility and sky view. */
function drawShade(
  gpu: GpuResources,
  visibility: WebGLTexture,
  skyView: WebGLTexture,
  request: TerrainShadowTileRequest,
  levels: readonly TerrainShadowMosaicLevel[],
): void {
  const { gl, shadeProgram } = gpu;
  const { uniforms } = shadeProgram;
  const { lighting } = request;
  attachDrawTarget(gpu, gpu.shadeTexture);
  gl.viewport(0, 0, terrainShadowTileSize, terrainShadowTileSize);
  // Unit 0 must hold the finest mosaic even when cached geometry skipped every march pass,
  // which would otherwise have bound it.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gpu.mosaics[0]);
  gl.activeTexture(gl.TEXTURE0 + visibilityTextureUnit);
  gl.bindTexture(gl.TEXTURE_2D, visibility);
  gl.activeTexture(gl.TEXTURE0 + skyViewTextureUnit);
  gl.bindTexture(gl.TEXTURE_2D, skyView);
  gl.useProgram(shadeProgram.program);
  setTileUniforms(gl, uniforms, request, levels);
  setSunUniforms(gl, uniforms, request);
  gl.uniform1i(uniforms.uVisibility, visibilityTextureUnit);
  gl.uniform1i(uniforms.uSkyView, skyViewTextureUnit);
  gl.uniform1f(uniforms.uSkyLightShare, lighting.skyLightShare);
  gl.uniform1f(uniforms.uSkyOcclusionStrength, lighting.skyOcclusionStrength);
  gl.uniform1f(uniforms.uNightSkyLight, lighting.nightSkyLight);
  gl.uniform1f(uniforms.uNightTopLight, lighting.nightTopLight);
  gl.uniform1f(uniforms.uNightTopLightFocus, lighting.nightTopLightFocus);
  gl.uniform1f(uniforms.uDiffuseSkyFraction, lighting.diffuseSkyFraction);
  gl.uniform1f(uniforms.uSoftEdgeSigma, lighting.softEdgeSigmaPixels);
  drawFullscreen(gpu);
}

/**
 * Copies the shade target into `readbackBuffer` on the GPU, so the fence that follows
 * also covers the copy and `readShadeMask` never stalls on it.
 */
function queueShadeReadback(gpu: GpuResources): void {
  const { gl } = gpu;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gpu.readFramebuffer);
  gl.framebufferTexture2D(
    gl.READ_FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    gpu.shadeTexture,
    0,
  );
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, gpu.readbackBuffer);
  gl.readPixels(
    0,
    0,
    terrainShadowTileSize,
    terrainShadowTileSize,
    gl.RGBA,
    gl.FLOAT,
    0,
  );
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
}

/**
 * Reads separate source energies and sunlight codes once the GPU has finished
 * `queueShadeReadback`; row 0 is the northern edge.
 */
function readShadeMask(gpu: GpuResources): ShadeMask {
  const { gl, readback } = gpu;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, gpu.readbackBuffer);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, readback);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const direct = new Float32Array(tilePixels);
  const sky = new Float32Array(tilePixels);
  const sunlight = new Uint8Array(sunlightGridSize * sunlightGridSize);
  for (let index = 0; index < tilePixels; index += 1) {
    direct[index] = readback[index * rgbaChannels] ?? 0;
    sky[index] = readback[index * rgbaChannels + 1] ?? 0;
  }
  const sampleOffset = sunlightGridStride / 2;
  for (let gridRow = 0; gridRow < sunlightGridSize; gridRow += 1) {
    const row = gridRow * sunlightGridStride + sampleOffset;
    for (let gridColumn = 0; gridColumn < sunlightGridSize; gridColumn += 1) {
      const column = gridColumn * sunlightGridStride + sampleOffset;
      sunlight[gridRow * sunlightGridSize + gridColumn] =
        readback[(row * terrainShadowTileSize + column) * rgbaChannels + 2] ?? 0;
    }
  }
  return { direct, sky, sunlight };
}

/**
 * Cache key of a tile's shade mask: DEM, tile, minute (or `night`, whose shade does not
 * depend on the instant), and shade-pass lighting. Palette fields are not part of it, so
 * new colors recolor the cached masks with different source-color coefficients.
 */
export function terrainShadowMaskKey(
  request: TerrainShadowTileRequest,
  night: boolean,
): string {
  const { lighting } = request;
  const instant = night ? 'night' : String(Math.floor(request.instantMs / 60_000));
  return [
    request.demTileUrl,
    `${String(request.z)}/${String(request.x)}/${String(request.y)}@${instant}`,
    lighting.skyLightShare,
    lighting.skyOcclusionStrength,
    lighting.nightSkyLight,
    lighting.nightTopLight,
    lighting.nightTopLightFocus,
    lighting.diffuseSkyFraction,
    lighting.softEdgeSigmaPixels,
  ].join('|');
}

/** Cache key of source-color coefficients and tone mapping: palette and daylight balance. */
function shadeColorizerKey(request: TerrainShadowTileRequest): string {
  const palette: ShadePalette = request;
  return JSON.stringify([
    palette.shadowColor,
    palette.highlightColor,
    palette.highlightOpacity,
    palette.goldenShadowColor,
    palette.lowSunShadowColor,
    palette.alpenglowColor,
    palette.alpenglowOpacity,
    palette.neutralBrightness,
    palette.exposure,
    palette.shadowStrength,
    palette.highlightRolloff,
    request.lighting.skyLightShare,
  ]);
}

/**
 * Worker-owned WebGL2 terrain-shadow renderer. One OffscreenCanvas context is created on
 * the first request and recreated after a context loss; decoded DEM tiles, per-tile sky
 * view and cast-shadow visibility textures, shade masks, and colorizers live in
 * bounded LRU caches. Geometry (DEM, sky view, visibility) never depends on lighting or
 * colors, so new shade-pass lighting reruns only the shade pass, and a new palette only
 * recolors cached masks. GPU work runs one tile at a time; DEM fetches run concurrently
 * and are shared between requests for the same tile.
 */
export class TerrainShadowRenderer {
  #gpu: GpuResources | null = null;
  /** Incremented on context loss so stale uploads and jobs never touch a new context. */
  #generation = 0;
  readonly #demTiles = new Map<string, DemTileEntry>();
  readonly #demPins = new Map<string, number>();
  readonly #inflightDem = new Map<string, InflightDemFetch>();
  /** Masks being computed, by mask key. */
  readonly #maskComputations = new Map<string, MaskComputation>();
  readonly #masks = new Map<string, CachedMask>();
  #cachedMaskBytes = 0;
  /** Keys of uncompressed `#masks` entries, oldest first. */
  readonly #uncompressedMasks = new Set<string>();
  #compressionScheduled = false;
  /** `render` and `prefetch` calls still computing or coloring a mask. */
  #activeTiles = 0;
  /** Sky view per mosaic key: it depends on the DEM around the tile only. */
  readonly #skyViews = new Map<string, WebGLTexture>();
  /** Visibility per mosaic key and minute (or `night`): the DEM and the Sun only. */
  readonly #visibilities = new Map<string, WebGLTexture>();
  readonly #shadeColorizers = new Map<string, ShadeColorizer>();
  /**
   * Per mosaic level, the DEM URLs it holds and whether `levelMaximum` has its maximum,
   * so consecutive instants of a tile, and neighbors sharing coarse ancestors, reuse them.
   */
  readonly #assembledLevels: ({
    readonly key: string;
    readonly reduced: boolean;
  } | null)[] = [null, null, null];
  #gpuQueue: Promise<void> = Promise.resolve();
  /** True during a camera move; see `setInteractionActive`. */
  #interactionActive = false;
  readonly #interactionWaiters = new Set<() => void>();
  #disposed = false;

  /** Colors the cached shade mask of `request` into a transferable bitmap. */
  public async render(
    request: TerrainShadowTileRequest,
    signal: AbortSignal,
  ): Promise<TerrainShadowTileResult> {
    this.#activeTiles += 1;
    try {
      return await this.colorize(
        request,
        await this.ensureMask(request, signal, 'full', true),
      );
    } finally {
      this.endActiveTile();
    }
  }

  /**
   * While a camera move is active, `render` waits right before the GPU queue, so shadow
   * passes never compete with the map's frames. DEM downloads, cached masks, drafts, and
   * playback prefetches go on, so only GPU work remains once the move ends.
   */
  public setInteractionActive(active: boolean): void {
    this.#interactionActive = active;
    if (active) return;
    const waiters = [...this.#interactionWaiters];
    this.#interactionWaiters.clear();
    for (const release of waiters) release();
  }

  /**
   * The finished tile when it needs no GPU pass (a coarse tile, plain night, or a cached
   * mask), otherwise a flat-ground draft (`createFlatShadeMask`) that MapLibre can show
   * at once while the real tile waits for the DEM and the GPU queue.
   */
  public async renderDraft(
    request: TerrainShadowTileRequest,
    signal: AbortSignal,
  ): Promise<TerrainShadowTileResult & { readonly draft: boolean }> {
    throwIfAborted(signal);
    if (this.#disposed) throw new Error('The terrain shadow renderer was disposed.');
    const ready = this.readyMask(request);
    if (ready !== null)
      return { ...(await this.colorize(request, ready)), draft: false };
    return {
      ...(await this.colorize(request, this.flatMask(request))),
      draft: true,
    };
  }

  /**
   * Computes and caches the shade mask of `request` without producing a bitmap. Day
   * playback frames are stored at `playback` precision; a cached mask of either
   * precision is reused as is, so playback frames are later shown without recomputing.
   */
  public async prefetch(
    request: TerrainShadowTileRequest,
    signal: AbortSignal,
  ): Promise<TerrainShadowTileMetrics> {
    throwIfAborted(signal);
    if (this.#disposed) throw new Error('The terrain shadow renderer was disposed.');
    const night = isTerrainShadowNightTile(request, request.instantMs);
    if (this.cachedMask(terrainShadowMaskKey(request, night)) !== undefined) {
      // Prefetch only needs presence/metrics, not two expanded tile-sized float arrays.
      return this.metrics({
        computeMs: 0,
        demFetchMs: 0,
        cacheHit: true,
        demTilesFetched: 0,
        stages: {},
      });
    }
    this.#activeTiles += 1;
    try {
      const { metrics, gpuStages } = await this.ensureMask(
        request,
        signal,
        'playback',
        false,
      );
      return { ...metrics, stages: { ...metrics.stages, ...(await gpuStages) } };
    } finally {
      this.endActiveTile();
    }
  }

  private async colorize(
    request: TerrainShadowTileRequest,
    { mask, metrics, gpuStages }: ShadeMaskResult,
  ): Promise<TerrainShadowTileResult> {
    const startedAt = performance.now();
    const colorizer = this.shadeColorizer(request);
    const pixels = expandShadeMask(mask, colorizer);
    const bitmapStartedAt = performance.now();
    const bitmap = await createImageBitmap(
      new ImageData(pixels, terrainShadowTileSize, terrainShadowTileSize),
    );
    const finishedAt = performance.now();
    return {
      bitmap,
      metrics: this.metrics({
        ...metrics,
        computeMs: metrics.computeMs + finishedAt - startedAt,
        stages: {
          ...metrics.stages,
          // Read only now, so the tile never waits for the GPU timer results alone.
          ...(await gpuStages),
          expand: bitmapStartedAt - startedAt,
          bitmap: finishedAt - bitmapStartedAt,
        },
      }),
    };
  }

  private shadeColorizer(request: TerrainShadowTileRequest): ShadeColorizer {
    const key = shadeColorizerKey(request);
    const colorizer =
      this.#shadeColorizers.get(key) ??
      createShadeColorizer(request, request.lighting.skyLightShare);
    this.#shadeColorizers.delete(key);
    this.#shadeColorizers.set(key, colorizer);
    for (const oldestKey of this.#shadeColorizers.keys()) {
      if (this.#shadeColorizers.size <= maximumCachedShadeColorizers) break;
      this.#shadeColorizers.delete(oldestKey);
    }
    return colorizer;
  }

  /**
   * The texture `cache` holds for `key`, now most recently used. On a miss it claims the
   * least recently used texture once the cache is full, otherwise a new one, and `fresh`
   * says the caller must draw it.
   */
  private claimGeometryTexture(
    gl: WebGL2RenderingContext,
    cache: Map<string, WebGLTexture>,
    key: string,
    create: (gl: WebGL2RenderingContext) => WebGLTexture,
  ): { readonly texture: WebGLTexture; readonly fresh: boolean } {
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return { texture: cached, fresh: false };
    }
    let texture: WebGLTexture | undefined;
    if (cache.size >= maximumCachedGeometryTextures) {
      const [oldestKey, oldest] = cache.entries().next().value ?? [];
      if (oldestKey !== undefined) cache.delete(oldestKey);
      texture = oldest;
    }
    texture ??= create(gl);
    cache.set(key, texture);
    return { texture, fresh: true };
  }

  /** Flat sea-level ground on the CPU: no GPU context, DEM, or cache memory. */
  private flatMask(request: TerrainShadowTileRequest): ShadeMaskResult {
    const startedAt = performance.now();
    const mask = createFlatShadeMask(request, request.instantMs, request.lighting);
    const computeMs = performance.now() - startedAt;
    return {
      mask,
      metrics: this.metrics({
        computeMs,
        demFetchMs: 0,
        cacheHit: false,
        demTilesFetched: 0,
        stages: { flatMask: computeMs },
      }),
      gpuStages: null,
    };
  }

  /**
   * The final mask of `request` when it needs no DEM or GPU pass: a coarse tile's flat
   * ground, the shared plain night mask, or a cached mask; otherwise null.
   */
  private readyMask(request: TerrainShadowTileRequest): ShadeMaskResult | null {
    if (request.z < terrainShadowReliefMinZoom) return this.flatMask(request);
    const night = isTerrainShadowNightTile(request, request.instantMs);
    const hitMetrics = (computeMs: number) =>
      this.metrics({
        computeMs,
        demFetchMs: 0,
        cacheHit: true,
        demTilesFetched: 0,
        stages: computeMs === 0 ? {} : { maskCodec: computeMs },
      });
    if (
      night &&
      request.lighting.nightSkyLight === 0 &&
      request.lighting.nightTopLight === 0
    ) {
      return { mask: nightMask, metrics: hitMetrics(0), gpuStages: null };
    }
    // Night shade lit only by the faint night sky does not depend on the instant, so every
    // night frame of a tile shares one cached mask.
    const maskKey = terrainShadowMaskKey(request, night);
    const cached = this.cachedMask(maskKey);
    if (cached === undefined) return null;
    if ('mask' in cached)
      return { mask: cached.mask, metrics: hitMetrics(0), gpuStages: null };
    const startedAt = performance.now();
    const mask = expandCompressedShadeMask(cached.compressed);
    return {
      mask,
      metrics: hitMetrics(performance.now() - startedAt),
      gpuStages: null,
    };
  }

  /**
   * The mask of `request`: ready, or computed once however many requests want it at the
   * same time. A shared computation keeps running while any request still waits; its
   * first request decides whether it waits for the end of a camera move (`gated`), and
   * any `full` request stores it at full precision. Only the first request to receive it
   * reports the computation; the others count as cache hits.
   */
  private async ensureMask(
    request: TerrainShadowTileRequest,
    signal: AbortSignal,
    precision: ShadeMaskPrecision,
    gated: boolean,
  ): Promise<ShadeMaskResult> {
    throwIfAborted(signal);
    if (this.#disposed) throw new Error('The terrain shadow renderer was disposed.');
    const ready = this.readyMask(request);
    if (ready !== null) return ready;
    const night = isTerrainShadowNightTile(request, request.instantMs);
    const maskKey = terrainShadowMaskKey(request, night);
    let computation = this.#maskComputations.get(maskKey);
    if (computation === undefined) {
      const controller = new AbortController();
      const promise = this.computeMask(
        request,
        night,
        maskKey,
        controller.signal,
        () => created.precision,
        gated,
      ).finally(() => {
        if (this.#maskComputations.get(maskKey) === created) {
          this.#maskComputations.delete(maskKey);
        }
      });
      // A computation canceled after its last waiter left must not surface as unhandled.
      promise.catch(() => undefined);
      const created: MaskComputation = {
        promise,
        controller,
        waiters: 0,
        precision,
        reported: false,
      };
      this.#maskComputations.set(maskKey, created);
      computation = created;
    }
    if (precision === 'full') computation.precision = 'full';
    computation.waiters += 1;
    try {
      const result = await untilAborted(computation.promise, signal);
      if (!computation.reported) {
        computation.reported = true;
        return result;
      }
      return {
        mask: result.mask,
        metrics: this.metrics({
          computeMs: 0,
          demFetchMs: 0,
          cacheHit: true,
          demTilesFetched: 0,
          stages: {},
        }),
        gpuStages: null,
      };
    } finally {
      computation.waiters -= 1;
      if (computation.waiters === 0 && signal.aborted) {
        // Nobody waits any more: cancel it, and let later requests start afresh.
        if (this.#maskComputations.get(maskKey) === computation) {
          this.#maskComputations.delete(maskKey);
        }
        computation.controller.abort();
      }
    }
  }

  /** DEM downloads, the optional camera-move wait, and the GPU job of one mask. */
  private async computeMask(
    request: TerrainShadowTileRequest,
    night: boolean,
    maskKey: string,
    signal: AbortSignal,
    precision: () => ShadeMaskPrecision,
    gated: boolean,
  ): Promise<ShadeMaskResult> {
    const gpu = this.ensureGpu();
    const generation = this.#generation;
    const levels = terrainShadowLevelZooms(
      request.z,
      request.demMinZoom,
      request.demMaxZoom,
    ).map((zoom) => terrainShadowMosaicLevel(request, zoom));
    const levelUrls = levels.map((level) =>
      level.tiles.map((tile) =>
        tile === null ? null : demTileUrl(request.demTileUrl, tile),
      ),
    );
    const levelKeys = levelUrls.map((tileUrls) => tileUrls.join('|'));
    const mosaicKey = levelKeys.join('|');
    const visibilityKey = `${mosaicKey}@${night ? 'night' : String(Math.floor(request.instantMs / 60_000))}`;
    const urls = [...new Set(levelUrls.flat().filter((url) => url !== null))];

    for (const url of urls) this.#demPins.set(url, (this.#demPins.get(url) ?? 0) + 1);
    try {
      const fetchStartedAt = performance.now();
      const fetched = await Promise.all(
        urls.map((url) => this.acquireDemTile(url, signal)),
      );
      const demFetchMs = performance.now() - fetchStartedAt;

      const queuedAt = performance.now();
      const job = await this.runSerially(async () => {
        throwIfAborted(signal);
        // Checked at the head of the queue, so jobs queued before a camera move began
        // wait too; the queue stays blocked meanwhile.
        const gateStartedAt = performance.now();
        if (gated) await this.waitForInteractionEnd(signal);
        if (generation !== this.#generation || this.#gpu !== gpu)
          throw contextLostError();
        const startedAt = performance.now();
        const timer = new GpuStageTimer(gpu);
        // With both geometry textures cached, the shade pass reads only the finest mosaic
        // and no level maximum, so coarser levels and every reduction are skipped.
        const marching =
          !this.#skyViews.has(mosaicKey) || !this.#visibilities.has(visibilityKey);
        const stale = levelKeys
          .slice(0, marching ? levels.length : 1)
          .flatMap((key, level) => {
            const assembled = this.#assembledLevels[level];
            return assembled?.key === key && (assembled.reduced || !marching)
              ? []
              : [level];
          });
        if (stale.length > 0) {
          timer.measure('assembly', () => {
            for (const level of stale) {
              const mosaic = gpu.mosaics[level];
              const tileUrls = levelUrls[level];
              const key = levelKeys[level];
              if (mosaic === undefined || tileUrls === undefined || key === undefined)
                continue;
              const previous = this.#assembledLevels[level];
              // Cleared first, so a failed assembly never leaves a stale key behind.
              this.#assembledLevels[level] = null;
              if (previous?.key !== key) {
                assembleMosaic(
                  gpu,
                  mosaic,
                  tileUrls.map((url) => this.demTexture(url)),
                );
              }
              if (marching) reduceMaximum(gpu, mosaic, level);
              this.#assembledLevels[level] = { key, reduced: marching };
            }
          });
        }
        // Level 0 is the 3×3 block around this tile at its own zoom, so the mosaic key
        // also identifies the tile: its sky view holds for every instant and lighting,
        // its visibility for every lighting of one minute (or of the whole night).
        const skyView = this.claimGeometryTexture(
          gpu.gl,
          this.#skyViews,
          mosaicKey,
          createSkyViewTexture,
        );
        if (skyView.fresh) {
          timer.measure('skyView', () => {
            drawSkyView(gpu, skyView.texture, request, levels);
          });
        }
        const visibility = this.claimGeometryTexture(
          gpu.gl,
          this.#visibilities,
          visibilityKey,
          createVisibilityTexture,
        );
        if (visibility.fresh) {
          timer.measure('visibility', () => {
            drawVisibility(gpu, visibility.texture, request, levels);
          });
        }
        timer.measure('shade', () => {
          drawShade(gpu, visibility.texture, skyView.texture, request, levels);
        });
        timer.measure('readbackCopy', () => {
          queueShadeReadback(gpu);
        });
        // Holding the queue until the GPU finishes keeps at most one tile of shadow work
        // competing with map frames, and makes `computeMs` the real GPU time.
        const gpuWaitStartedAt = performance.now();
        await waitForGpu(gpu.gl);
        if (gpu.gl.isContextLost()) throw contextLostError();
        const readbackStartedAt = performance.now();
        const mask = readShadeMask(gpu);
        const finishedAt = performance.now();
        return {
          mask,
          startedAt,
          gpuStages: timer.read(),
          stages: {
            ...(gated ? { interactionGate: startedAt - gateStartedAt } : {}),
            queueWait: gateStartedAt - queuedAt,
            gpuWait: readbackStartedAt - gpuWaitStartedAt,
            readback: finishedAt - readbackStartedAt,
          },
        };
      });
      // Canceled during the caller's yield: a later computation of the key may need
      // another precision, and the first stored mask of a key wins.
      throwIfAborted(signal);
      const storeStartedAt = performance.now();
      this.storeMask(maskKey, job.mask, precision());
      const finishedAt = performance.now();
      return {
        mask: job.mask,
        metrics: this.metrics({
          computeMs: finishedAt - job.startedAt,
          demFetchMs,
          cacheHit: false,
          demTilesFetched: fetched.filter(Boolean).length,
          stages: { ...job.stages, maskCodec: finishedAt - storeStartedAt },
        }),
        gpuStages: job.gpuStages,
      };
    } finally {
      for (const url of urls) {
        const pins = (this.#demPins.get(url) ?? 1) - 1;
        if (pins > 0) this.#demPins.set(url, pins);
        else this.#demPins.delete(url);
      }
      this.evictDemTiles();
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const gpu = this.#gpu;
    this.dropCaches();
    gpu?.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private ensureGpu(): GpuResources {
    if (this.#gpu !== null) return this.#gpu;
    const generation = this.#generation;
    const gpu = createGpuResources(() => {
      if (generation === this.#generation) this.dropCaches();
    });
    this.#gpu = gpu;
    return gpu;
  }

  /** Drops every cache and the context; the next request creates a fresh context. */
  private dropCaches(): void {
    this.#generation += 1;
    this.#gpu = null;
    for (const inflight of this.#inflightDem.values()) inflight.controller.abort();
    this.#inflightDem.clear();
    this.#demTiles.clear();
    this.#masks.clear();
    // Computations of the lost context fail on their own; later requests start afresh.
    this.#maskComputations.clear();
    this.#uncompressedMasks.clear();
    this.#cachedMaskBytes = 0;
    this.#shadeColorizers.clear();
    // The textures died with the context.
    this.#skyViews.clear();
    this.#visibilities.clear();
    this.#assembledLevels.fill(null);
  }

  /** Resolves `true` when this request started the network fetch for `url`. */
  private async acquireDemTile(url: string, signal: AbortSignal): Promise<boolean> {
    const cached = this.#demTiles.get(url);
    if (cached !== undefined) {
      this.#demTiles.delete(url);
      this.#demTiles.set(url, cached);
      return false;
    }
    let inflight = this.#inflightDem.get(url);
    const started = inflight === undefined;
    if (inflight === undefined) {
      const controller = new AbortController();
      const created: InflightDemFetch = {
        promise: this.fetchDemTile(url, controller.signal, this.#generation).finally(
          () => {
            if (this.#inflightDem.get(url) === created) this.#inflightDem.delete(url);
          },
        ),
        controller,
        waiters: 0,
      };
      inflight = created;
      this.#inflightDem.set(url, created);
      // A download canceled after its last waiter left must not surface as unhandled.
      created.promise.catch(() => undefined);
    }
    inflight.waiters += 1;
    try {
      await untilAborted(inflight.promise, signal);
    } finally {
      inflight.waiters -= 1;
      if (inflight.waiters === 0 && signal.aborted) {
        // Nobody waits any more: cancel the download and let later requests start afresh.
        if (this.#inflightDem.get(url) === inflight) this.#inflightDem.delete(url);
        inflight.controller.abort();
      }
    }
    return started;
  }

  private async fetchDemTile(
    url: string,
    signal: AbortSignal,
    generation: number,
  ): Promise<void> {
    // Same URL and default request mode as MapLibre's raster-dem source: HTTP cache hits.
    const response = await fetch(url, { signal });
    if (response.status === 404) {
      this.storeDemTile(url, { texture: null });
      return;
    }
    if (!response.ok) {
      throw new Error(`DEM tile request failed with HTTP ${String(response.status)}.`);
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    try {
      throwIfAborted(signal);
      const gpu = this.#gpu;
      if (gpu === null || generation !== this.#generation) throw contextLostError();
      if (
        bitmap.width !== terrainShadowTileSize ||
        bitmap.height !== terrainShadowTileSize
      ) {
        throw new Error(
          `DEM tiles must be ${String(terrainShadowTileSize)} px, got ${String(bitmap.width)}×${String(bitmap.height)}.`,
        );
      }
      this.storeDemTile(url, { texture: decodeDemTile(gpu, bitmap) });
    } finally {
      bitmap.close();
    }
  }

  private storeDemTile(url: string, entry: DemTileEntry): void {
    this.#demTiles.delete(url);
    this.#demTiles.set(url, entry);
    this.evictDemTiles();
  }

  /** Evicts least-recently-used unpinned tiles; pinned tiles may briefly exceed the bound. */
  private evictDemTiles(): void {
    for (const [url, entry] of this.#demTiles) {
      if (this.#demTiles.size <= maximumCachedDemTiles) return;
      if (this.#demPins.has(url)) continue;
      this.#demTiles.delete(url);
      if (entry.texture !== null) this.#gpu?.gl.deleteTexture(entry.texture);
    }
  }

  private demTexture(url: string | null): WebGLTexture | null {
    if (url === null) return null;
    const entry = this.#demTiles.get(url);
    if (entry === undefined) throw contextLostError();
    return entry.texture;
  }

  /** Refreshes an existing mask without decoding or recompressing it. */
  private cachedMask(key: string): CachedMask | undefined {
    const cached = this.#masks.get(key);
    if (cached !== undefined) {
      this.#masks.delete(key);
      this.#masks.set(key, cached);
    }
    return cached;
  }

  /**
   * Caches a new mask uncompressed, for `compressMask` to turn into binary16 source
   * energies later, and evicts LRU entries by count and actual bytes. The first stored
   * mask of a key wins: a render and a playback prefetch can miss the same key
   * concurrently, and a later `playback` mask must not downgrade a `full` one.
   */
  private storeMask(key: string, mask: ShadeMask, precision: ShadeMaskPrecision): void {
    if (this.cachedMask(key) !== undefined) return;
    this.#masks.set(key, { mask, precision });
    this.#uncompressedMasks.add(key);
    this.#cachedMaskBytes += shadeMaskBytes;
    // Under sustained load, such as a day playback prefetch, the idle moment never
    // comes, so the oldest uncompressed masks are compressed right away instead.
    for (const oldestKey of this.#uncompressedMasks) {
      if (this.#uncompressedMasks.size <= maximumUncompressedMasks) break;
      this.compressMask(oldestKey);
    }
    for (const [oldestKey, oldest] of this.#masks) {
      if (
        this.#masks.size <= terrainShadowMaskCacheLimit &&
        this.#cachedMaskBytes <= maximumCachedMaskBytes
      )
        break;
      this.#masks.delete(oldestKey);
      this.#uncompressedMasks.delete(oldestKey);
      this.#cachedMaskBytes -=
        'compressed' in oldest ? oldest.compressed.byteLength : shadeMaskBytes;
    }
  }

  /** Replaces an uncompressed mask by its DEFLATE form in place, keeping its LRU slot. */
  private compressMask(key: string): void {
    this.#uncompressedMasks.delete(key);
    const cached = this.#masks.get(key);
    if (cached === undefined || !('mask' in cached)) return;
    const compressed = compressShadeMask(cached.mask, cached.precision);
    this.#masks.set(key, { compressed });
    this.#cachedMaskBytes += compressed.byteLength - shadeMaskBytes;
  }

  private waitForInteractionEnd(signal: AbortSignal): Promise<void> {
    if (!this.#interactionActive) return Promise.resolve();
    throwIfAborted(signal);
    return new Promise<void>((resolve, reject) => {
      const release = () => {
        signal.removeEventListener('abort', handleAbort);
        resolve();
      };
      const handleAbort = () => {
        this.#interactionWaiters.delete(release);
        reject(abortError());
      };
      this.#interactionWaiters.add(release);
      signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  private endActiveTile(): void {
    this.#activeTiles -= 1;
    if (this.#activeTiles === 0) this.scheduleMaskCompression();
  }

  /**
   * Compresses the uncompressed masks one per event-loop turn while no tile is being
   * computed or colored, so DEFLATE never delays a tile the map waits for.
   */
  private scheduleMaskCompression(): void {
    if (this.#compressionScheduled || this.#uncompressedMasks.size === 0) return;
    this.#compressionScheduled = true;
    setTimeout(() => {
      this.#compressionScheduled = false;
      // A tile started meanwhile: `endActiveTile` schedules the rest once it ends.
      if (this.#activeTiles > 0) return;
      const [oldestKey] = this.#uncompressedMasks;
      if (oldestKey !== undefined) this.compressMask(oldestKey);
      this.scheduleMaskCompression();
    }, 0);
  }

  /**
   * Runs GPU jobs one at a time. Between jobs the queue yields to the event loop, so
   * queued RPC cancel messages arrive first. A job's caller resumes one event-loop turn
   * later still, after the next job has issued its GPU passes: compressing and coloring
   * one tile on the CPU then overlaps the GPU work of the next.
   */
  private async runSerially<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#gpuQueue.then(job);
    // Registered before the caller's `await` below, so the next job's yield comes first.
    this.#gpuQueue = run.then(yieldToEventLoop, yieldToEventLoop);
    const result = await run;
    await yieldToEventLoop();
    return result;
  }

  private metrics(
    tile: Pick<
      TerrainShadowTileMetrics,
      'computeMs' | 'demFetchMs' | 'cacheHit' | 'demTilesFetched' | 'stages'
    >,
  ): TerrainShadowTileMetrics {
    let decodedTiles = 0;
    for (const entry of this.#demTiles.values()) {
      if (entry.texture !== null) decodedTiles += 1;
    }
    let colorizerBytes = 0;
    for (const colorizer of this.#shadeColorizers.values()) {
      colorizerBytes += colorizer.sources.byteLength;
    }
    return {
      ...tile,
      memoryBytes:
        (this.#gpu?.staticBytes ?? 0) +
        decodedTiles * tileBytes +
        this.#visibilities.size * visibilityBytes +
        this.#skyViews.size * skyViewBytes +
        this.#cachedMaskBytes +
        colorizerBytes,
      cachedMasks: this.#masks.size,
      cachedDemTiles: this.#demTiles.size,
    };
  }
}
