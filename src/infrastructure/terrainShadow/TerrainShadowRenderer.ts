import { subsolarPoint } from '@/domain/terrain/solarPosition';
import { terrainShadowModel } from '@/domain/terrain/terrainShadow';
import {
  type TerrainShadowTileMetrics,
  type TerrainShadowTileRequest,
  type TerrainShadowTileResult,
  terrainShadowMaskCacheLimit,
  terrainShadowReliefMinZoom,
  terrainShadowUnavailableErrorCode,
} from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import {
  createFlatShadeMask,
  createShadeLookupTable,
  expandShadeMask,
  fullscreenVertexShaderSource,
  maximumReductionFactor,
  maximumReductionFragmentShaderSource,
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

const maximumCachedDemTiles = 64;
/** Horizontal bands per visibility pass, flushed separately to keep GPU submissions short. */
const shadowPassBands = 8;
const bytesPerTexel = 4;
const tileBytes = terrainShadowTileSize * terrainShadowTileSize * bytesPerTexel;
const tilePixels = terrainShadowTileSize * terrainShadowTileSize;
/** Temporary: full night shade for tiles drawn with the night-sky experiment off. */
const nightMask = new Uint8Array(shadeMaskBytes).fill(sunlightNightCode, tilePixels);

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
  'uNightSky',
] as const;
const reductionUniformNames = ['uSource', 'uSourceSize', 'uTargetOrigin'] as const;
/** Texture units of the shade pass's own inputs, after the four mosaic units. */
const visibilityTextureUnit = 4;
const skyViewTextureUnit = 5;

type UniformLocations<TName extends string> = Readonly<
  Record<TName, WebGLUniformLocation>
>;

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
  /** R8 visible solar-disk fraction for the tile plus the blur margin. */
  readonly visibilityTexture: WebGLTexture;
  /**
   * R8 open-sky share on the `terrainSkyViewSize` grid, linearly filtered; valid for the
   * assembled mosaics, so every instant of the tile reuses it.
   */
  readonly skyViewTexture: WebGLTexture;
  /** RGBA8 shade pass target: red carries the brightness byte, green the sunlight code. */
  readonly shadeTexture: WebGLTexture;
  /** Reused RGBA readback of `shadeTexture`. */
  readonly readback: Uint8Array;
  readonly staticBytes: number;
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
  const visibilityTexture = createTexture(
    gl,
    gl.R8,
    terrainShadowVisibilitySize,
    terrainShadowVisibilitySize,
  );
  const skyViewTexture = createTexture(
    gl,
    gl.R8,
    terrainSkyViewSize,
    terrainSkyViewSize,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const shadeTexture = createTexture(
    gl,
    gl.RGBA8,
    terrainShadowTileSize,
    terrainShadowTileSize,
  );
  const readback = new Uint8Array(tileBytes);
  const staticBytes =
    // Encoded staging texture, shade target, and its CPU readback.
    3 * tileBytes +
    terrainShadowVisibilitySize * terrainShadowVisibilitySize +
    terrainSkyViewSize * terrainSkyViewSize +
    mosaics.length * mosaicSize * mosaicSize * bytesPerTexel +
    reductionStages.reduce(
      (sum, stage) => sum + stage.size * stage.size * bytesPerTexel,
      0,
    ) +
    mosaics.length * bytesPerTexel;

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
    visibilityTexture,
    skyViewTexture,
    shadeTexture,
    readback,
    staticBytes,
  };
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

/** Computes the tile's open-sky share into `skyViewTexture` from the assembled mosaics. */
function drawSkyView(
  gpu: GpuResources,
  request: TerrainShadowTileRequest,
  levels: readonly TerrainShadowMosaicLevel[],
): void {
  attachDrawTarget(gpu, gpu.skyViewTexture);
  gpu.gl.viewport(0, 0, terrainSkyViewSize, terrainSkyViewSize);
  bindMarchProgram(gpu, gpu.skyViewProgram, request, levels);
  drawFullscreen(gpu);
  gpu.gl.flush();
}

/**
 * Marches the horizon into `visibilityTexture`, then lights the slopes into
 * `shadeTexture`, reading the tile's `skyViewTexture`.
 */
function drawShadePasses(
  gpu: GpuResources,
  request: TerrainShadowTileRequest,
  levels: readonly TerrainShadowMosaicLevel[],
): void {
  const { gl, visibilityProgram, shadeProgram } = gpu;
  attachDrawTarget(gpu, gpu.visibilityTexture);
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

  attachDrawTarget(gpu, gpu.shadeTexture);
  gl.viewport(0, 0, terrainShadowTileSize, terrainShadowTileSize);
  gl.activeTexture(gl.TEXTURE0 + visibilityTextureUnit);
  gl.bindTexture(gl.TEXTURE_2D, gpu.visibilityTexture);
  gl.activeTexture(gl.TEXTURE0 + skyViewTextureUnit);
  gl.bindTexture(gl.TEXTURE_2D, gpu.skyViewTexture);
  gl.useProgram(shadeProgram.program);
  setTileUniforms(gl, shadeProgram.uniforms, request, levels);
  setSunUniforms(gl, shadeProgram.uniforms, request);
  gl.uniform1i(shadeProgram.uniforms.uVisibility, visibilityTextureUnit);
  gl.uniform1i(shadeProgram.uniforms.uSkyView, skyViewTextureUnit);
  gl.uniform1f(shadeProgram.uniforms.uNightSky, request.nightSky ? 1 : 0);
  drawFullscreen(gpu);
}

/** Reads `shadeTexture` into the `shadeMaskBytes` layout; row 0 is the northern edge. */
function readShadeMask(gpu: GpuResources): Uint8Array {
  const { gl, readback } = gpu;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gpu.readFramebuffer);
  gl.framebufferTexture2D(
    gl.READ_FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    gpu.shadeTexture,
    0,
  );
  gl.readPixels(
    0,
    0,
    terrainShadowTileSize,
    terrainShadowTileSize,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    readback,
  );
  const mask = new Uint8Array(shadeMaskBytes);
  for (let index = 0; index < tilePixels; index += 1) {
    mask[index] = readback[index * bytesPerTexel] ?? 0;
  }
  const sampleOffset = sunlightGridStride / 2;
  for (let gridRow = 0; gridRow < sunlightGridSize; gridRow += 1) {
    const row = gridRow * sunlightGridStride + sampleOffset;
    for (let gridColumn = 0; gridColumn < sunlightGridSize; gridColumn += 1) {
      const column = gridColumn * sunlightGridStride + sampleOffset;
      mask[tilePixels + gridRow * sunlightGridSize + gridColumn] =
        readback[(row * terrainShadowTileSize + column) * bytesPerTexel + 1] ?? 0;
    }
  }
  return mask;
}

/**
 * Worker-owned WebGL2 terrain-shadow renderer. One OffscreenCanvas context is created on
 * the first request and recreated after a context loss; decoded DEM tiles and shade masks
 * live in bounded LRU caches. GPU work runs one tile at a time; DEM fetches
 * run concurrently and are shared between requests for the same tile.
 */
export class TerrainShadowRenderer {
  #gpu: GpuResources | null = null;
  /** Incremented on context loss so stale uploads and jobs never touch a new context. */
  #generation = 0;
  readonly #demTiles = new Map<string, DemTileEntry>();
  readonly #demPins = new Map<string, number>();
  readonly #inflightDem = new Map<string, InflightDemFetch>();
  readonly #masks = new Map<string, Uint8Array>();
  /** DEM URLs the mosaics currently hold, so consecutive instants of a tile reuse them. */
  #assembledMosaicKey: string | null = null;
  #gpuQueue: Promise<void> = Promise.resolve();
  #disposed = false;
  /** The lookup table of the last palette; every request carries the same palette. */
  #shadeTable: { readonly key: string; readonly table: Uint32Array } | null = null;

  /** Colors the cached shade mask of `request` into a transferable bitmap. */
  public async render(
    request: TerrainShadowTileRequest,
    signal: AbortSignal,
  ): Promise<TerrainShadowTileResult> {
    const { mask, metrics } = await this.ensureMask(request, signal);
    const startedAt = performance.now();
    const table = this.shadeTable(request);
    const bitmap = await createImageBitmap(
      new ImageData(
        expandShadeMask(mask, table),
        terrainShadowTileSize,
        terrainShadowTileSize,
      ),
    );
    return {
      bitmap,
      metrics: {
        ...metrics,
        computeMs: metrics.computeMs + performance.now() - startedAt,
      },
    };
  }

  /** Computes and caches the shade mask of `request` without producing a bitmap. */
  public async prefetch(
    request: TerrainShadowTileRequest,
    signal: AbortSignal,
  ): Promise<TerrainShadowTileMetrics> {
    return (await this.ensureMask(request, signal)).metrics;
  }

  private shadeTable(palette: ShadePalette): Uint32Array {
    const key = JSON.stringify([
      palette.shadowColor,
      palette.highlightColor,
      palette.highlightOpacity,
      palette.goldenShadowColor,
      palette.lowSunShadowColor,
      palette.lowSunShadowLift,
      palette.lowSunGlowOpacity,
      palette.alpenglowColor,
      palette.alpenglowOpacity,
    ]);
    if (this.#shadeTable?.key !== key) {
      this.#shadeTable = { key, table: createShadeLookupTable(palette) };
    }
    return this.#shadeTable.table;
  }

  private async ensureMask(
    request: TerrainShadowTileRequest,
    signal: AbortSignal,
  ): Promise<{
    readonly mask: Uint8Array;
    readonly metrics: TerrainShadowTileMetrics;
  }> {
    throwIfAborted(signal);
    if (this.#disposed) throw new Error('The terrain shadow renderer was disposed.');
    // Coarse tiles shade flat ground on the CPU: no GPU context, DEM, or cache memory.
    if (request.z < terrainShadowReliefMinZoom) {
      const startedAt = performance.now();
      const mask = createFlatShadeMask(request, request.instantMs, request.nightSky);
      return {
        mask,
        metrics: this.metrics({
          computeMs: performance.now() - startedAt,
          demFetchMs: 0,
          cacheHit: false,
          demTilesFetched: 0,
        }),
      };
    }
    const gpu = this.ensureGpu();
    const generation = this.#generation;
    const night = isTerrainShadowNightTile(request, request.instantMs);
    if (night && !request.nightSky) {
      return {
        mask: nightMask,
        metrics: this.metrics({
          computeMs: 0,
          demFetchMs: 0,
          cacheHit: true,
          demTilesFetched: 0,
        }),
      };
    }
    // Night shade lit only by the faint night sky does not depend on the instant, so every
    // night frame of a tile shares one cached mask.
    const maskInstant = night
      ? 'night'
      : String(Math.floor(request.instantMs / 60_000));
    const maskKey = `${request.demTileUrl}|${String(request.z)}/${String(request.x)}/${String(request.y)}@${maskInstant}|${String(request.nightSky)}`;
    const cached = this.#masks.get(maskKey);
    if (cached !== undefined) {
      this.storeMask(maskKey, cached);
      return {
        mask: cached,
        metrics: this.metrics({
          computeMs: 0,
          demFetchMs: 0,
          cacheHit: true,
          demTilesFetched: 0,
        }),
      };
    }

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
    const mosaicKey = levelUrls.flat().join('|');
    const urls = [...new Set(levelUrls.flat().filter((url) => url !== null))];

    for (const url of urls) this.#demPins.set(url, (this.#demPins.get(url) ?? 0) + 1);
    try {
      const fetchStartedAt = performance.now();
      const fetched = await Promise.all(
        urls.map((url) => this.acquireDemTile(url, signal)),
      );
      const demFetchMs = performance.now() - fetchStartedAt;

      const { mask, startedAt } = await this.runSerially(async () => {
        throwIfAborted(signal);
        if (generation !== this.#generation || this.#gpu !== gpu)
          throw contextLostError();
        const jobStartedAt = performance.now();
        if (this.#assembledMosaicKey !== mosaicKey) {
          this.#assembledMosaicKey = null;
          levelUrls.forEach((tileUrls, level) => {
            const mosaic = gpu.mosaics[level];
            if (mosaic === undefined) return;
            assembleMosaic(
              gpu,
              mosaic,
              tileUrls.map((url) => this.demTexture(url)),
            );
            reduceMaximum(gpu, mosaic, level);
          });
          // Level 0 is the 3×3 block around this tile at its own zoom, so the mosaic key
          // also identifies the tile, and its sky view holds for every instant.
          drawSkyView(gpu, request, levels);
          this.#assembledMosaicKey = mosaicKey;
        }
        drawShadePasses(gpu, request, levels);
        // Holding the queue until the GPU finishes keeps at most one tile of shadow work
        // competing with map frames, and makes `computeMs` the real GPU time.
        await waitForGpu(gpu.gl);
        if (gpu.gl.isContextLost()) throw contextLostError();
        return { mask: readShadeMask(gpu), startedAt: jobStartedAt };
      });
      this.storeMask(maskKey, mask);
      return {
        mask,
        metrics: this.metrics({
          computeMs: performance.now() - startedAt,
          demFetchMs,
          cacheHit: false,
          demTilesFetched: fetched.filter(Boolean).length,
        }),
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
    this.#assembledMosaicKey = null;
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

  /** Inserts or refreshes `key` as most recently used and evicts beyond the cap. */
  private storeMask(key: string, mask: Uint8Array): void {
    this.#masks.delete(key);
    this.#masks.set(key, mask);
    for (const oldestKey of this.#masks.keys()) {
      if (this.#masks.size <= terrainShadowMaskCacheLimit) break;
      this.#masks.delete(oldestKey);
    }
  }

  private runSerially<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#gpuQueue.then(yieldToEventLoop).then(job);
    this.#gpuQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private metrics(
    tile: Pick<
      TerrainShadowTileMetrics,
      'computeMs' | 'demFetchMs' | 'cacheHit' | 'demTilesFetched'
    >,
  ): TerrainShadowTileMetrics {
    let decodedTiles = 0;
    for (const entry of this.#demTiles.values()) {
      if (entry.texture !== null) decodedTiles += 1;
    }
    return {
      ...tile,
      memoryBytes:
        (this.#gpu?.staticBytes ?? 0) +
        decodedTiles * tileBytes +
        this.#masks.size * shadeMaskBytes,
      cachedMasks: this.#masks.size,
      cachedDemTiles: this.#demTiles.size,
    };
  }
}
