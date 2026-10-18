import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Developer 3D render benchmark. It drives the native map through a fixed forested scene
 * above Mestia so reports from different computers describe the same work, and adds
 * synthetic WebGL measurements that separate fill-rate from draw-call limits. Reports
 * contain no user camera, tracks, markers, or URLs beyond provider host names.
 */

export type RenderBenchmarkPhaseName = 'static' | 'orbit' | 'zoom' | 'pan';
export type RenderBenchmarkStep =
  'settle' | 'warm-up' | RenderBenchmarkPhaseName | 'synthetic';

const glCallNames = [
  'drawElements',
  'drawArrays',
  'bufferData',
  'bufferSubData',
  'texImage2D',
  'texSubImage2D',
  'texStorage2D',
  'generateMipmap',
  'bindFramebuffer',
  'useProgram',
  'clear',
] as const;
type GlCallName = (typeof glCallNames)[number];

interface Distribution {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface RenderBenchmarkPhase {
  readonly name: RenderBenchmarkPhaseName;
  /** Whether the map finished loading the scene before the phase started. */
  readonly startedSettled: boolean;
  readonly durationMs: number;
  readonly frames: number;
  readonly framesPerSecond: number;
  /** Time between consecutive map frames; long intervals are what users feel as freezes. */
  readonly frameIntervalMs: Distribution;
  readonly framesOver100Ms: number;
  readonly framesOver500Ms: number;
  /** Main-thread time MapLibre spent issuing one frame. */
  readonly renderCpuMs: Distribution;
  /** GPU execution time of one map frame; `null` without the WebGL timer-query extension. */
  readonly gpuFrameMs: (Distribution & { readonly samples: number }) | null;
  readonly glCallsPerFrame: Readonly<Record<string, number>>;
  readonly longTasks: { readonly count: number; readonly totalMs: number };
}

export interface SyntheticGpuResults {
  /** Blended, textured full-target quads into a 1024 px framebuffer. */
  readonly fillMegapixelsPerSecond: number;
  /** Tiny draws, each preceded by a small buffer upload like MapLibre's uniform blocks. */
  readonly microsecondsPerDraw: number;
  /** One draped-texture tile: allocate, clear, eight overdraw passes, mipmaps. */
  readonly renderToTextureTileMs: {
    readonly size1024: number;
    readonly size2048: number;
  };
}

export interface RenderBenchmarkReport {
  readonly kind: 'trail-planner-render-benchmark';
  readonly version: 1;
  readonly createdAt: string;
  readonly environment: {
    readonly userAgent: string;
    readonly hardwareConcurrency: number;
    readonly deviceMemoryGb: number | null;
    readonly devicePixelRatio: number;
    readonly screen: { readonly width: number; readonly height: number };
    readonly canvas: {
      readonly cssWidth: number;
      readonly cssHeight: number;
      readonly drawingBufferWidth: number;
      readonly drawingBufferHeight: number;
    };
    readonly jsHeapUsedMb: number | null;
  };
  readonly webGl: {
    readonly vendor: string | null;
    readonly renderer: string | null;
    readonly maxTextureSize: number;
    readonly maxRenderbufferSize: number;
    readonly timerQuery: boolean;
  };
  readonly scene: {
    readonly longitude: number;
    readonly latitude: number;
    readonly zoom: number;
    readonly bearing: number;
    readonly pitch: number;
    readonly settleMs: number;
    /** Whether every tile loaded within the settle limit; otherwise phases include loading. */
    readonly settled: boolean;
  };
  readonly style: {
    readonly layerCount: number;
    readonly visibleLayerIds: readonly string[];
    /** Texture stacks 3D terrain drapes per terrain tile at the scene zoom. */
    readonly drapedStacks: number;
    /** Square textures of at least 512 px allocated while measuring, by size. */
    readonly allocatedTextureSizes: Readonly<Record<string, number>>;
  };
  readonly phases: readonly RenderBenchmarkPhase[];
  readonly synthetic: SyntheticGpuResults | null;
}

export type RenderBenchmarkVerdict = 'good' | 'okay' | 'bad' | 'potato';

/**
 * Best tier first; the first whose limits the camera-motion phases meet wins, and
 * anything worse than `bad` is `potato`. Limits apply to the worst phase's 95th
 * percentile frame interval and to freezes over 500 ms summed across those phases.
 */
const verdictTiers = [
  // Two display refreshes at 60 Hz: about 30 fps.
  { verdict: 'good', maxFrameIntervalP95Ms: 34, maxFreezes: 0 },
  { verdict: 'okay', maxFrameIntervalP95Ms: 100, maxFreezes: 1 },
  { verdict: 'bad', maxFrameIntervalP95Ms: 250, maxFreezes: 3 },
] as const;

export interface RenderBenchmarkSummary {
  readonly verdict: RenderBenchmarkVerdict;
  readonly gpu: string;
  readonly staticFramesPerSecond: number;
  readonly motionFramesPerSecond: number;
  readonly motionFrameIntervalP95Ms: number;
  readonly freezesOver500Ms: number;
  readonly renderCpuP50Ms: number;
  readonly gpuFrameP50Ms: number | null;
}

const scene = {
  longitude: 42.73,
  latitude: 43.035,
  zoom: 14.5,
  bearing: 20,
  pitch: 70,
};
/** Loading the scene from a cold cache can take this long on slow connections. */
export const sceneSettleTimeoutMs = 30_000;
/** Each phase restarts from the loaded scene; tiles are already cached by then. */
const phaseSettleTimeoutMs = 10_000;

/** Layer types MapLibre renders into the per-tile textures it drapes over 3D terrain. */
const drapedLayerTypes: Record<string, true> = {
  background: true,
  fill: true,
  line: true,
  raster: true,
  hillshade: true,
  'color-relief': true,
};

// The project targets ES2023, which has no Promise.withResolvers.

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error('The benchmark stopped.');
}

/** Resolves after `ms`, or rejects with the abort reason when the run stops first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Next animation frame; browsers pause these in hidden tabs, which aborts the run. */
function nextFrame(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cancelAnimationFrame(frame);
      reject(abortReason(signal));
    };
    const frame = requestAnimationFrame(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Nearest-rank percentiles; an empty sample reads as zeros. */
export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (quantile: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)] ?? 0;
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1) ?? 0) };
}

/**
 * Intervals between frames, with the phase edges as boundaries: time without a frame at
 * the start or end, or a phase that never rendered, is a long interval rather than none.
 */
export function phaseFrameIntervals(
  startedAt: number,
  frameTimes: readonly number[],
  endedAt: number,
): number[] {
  const boundaries = [startedAt, ...frameTimes, endedAt];
  return boundaries.slice(1).map((time, index) => time - (boundaries[index] ?? time));
}

/**
 * Counts the texture stacks 3D terrain drapes: consecutive visible draped layers share
 * one stack, and any other visible layer between them starts the next one.
 */
export function countDrapedStacks(
  layers: readonly { readonly type: string; readonly visible: boolean }[],
): number {
  let stacks = 0;
  let inStack = false;
  for (const layer of layers) {
    if (!layer.visible) continue;
    const draped = drapedLayerTypes[layer.type] === true;
    if (draped && !inStack) stacks += 1;
    inStack = draped;
  }
  return stacks;
}

/** Summary numbers and the verdict tier from the camera-motion phases. */
export function summarizeRenderBenchmark(
  report: RenderBenchmarkReport,
): RenderBenchmarkSummary {
  const motion = report.phases.filter((phase) => phase.name !== 'static');
  const staticPhase = report.phases.find((phase) => phase.name === 'static');
  const motionFrames = motion.reduce((sum, phase) => sum + phase.frames, 0);
  const motionDurationMs = motion.reduce((sum, phase) => sum + phase.durationMs, 0);
  const motionFrameIntervalP95Ms = Math.max(
    0,
    ...motion.map((phase) => phase.frameIntervalMs.p95),
  );
  const freezesOver500Ms = motion.reduce(
    (sum, phase) => sum + phase.framesOver500Ms,
    0,
  );
  const verdict: RenderBenchmarkVerdict =
    verdictTiers.find(
      (tier) =>
        motionFrameIntervalP95Ms <= tier.maxFrameIntervalP95Ms &&
        freezesOver500Ms <= tier.maxFreezes,
    )?.verdict ?? 'potato';
  return {
    verdict,
    gpu: report.webGl.renderer ?? 'Unknown GPU',
    staticFramesPerSecond: staticPhase?.framesPerSecond ?? 0,
    motionFramesPerSecond:
      motionDurationMs > 0 ? round((motionFrames * 1000) / motionDurationMs) : 0,
    motionFrameIntervalP95Ms,
    freezesOver500Ms,
    renderCpuP50Ms: staticPhase?.renderCpuMs.p50 ?? 0,
    gpuFrameP50Ms: staticPhase?.gpuFrameMs?.p50 ?? null,
  };
}

interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

function isTimerQueryExtension(value: unknown): value is TimerQueryExtension {
  return (
    typeof value === 'object' &&
    value !== null &&
    'TIME_ELAPSED_EXT' in value &&
    typeof value.TIME_ELAPSED_EXT === 'number' &&
    'GPU_DISJOINT_EXT' in value &&
    typeof value.GPU_DISJOINT_EXT === 'number'
  );
}

/**
 * Observes the map's own WebGL context by shadowing selected methods on the context
 * instance, and brackets each frame by shadowing the map's internal `_render`, the one
 * call every MapLibre frame goes through; tile uploads between frames stay outside the
 * bracket. `stop` deletes the shadows so the prototype methods apply again. Without
 * `_render` (another MapLibre version) frame CPU and GPU timings are left empty.
 */
class MapGlProbe {
  readonly #map: MapLibreMap;
  readonly #gl: WebGL2RenderingContext;
  readonly #timer: TimerQueryExtension | null;
  readonly #counts = new Map<GlCallName, number>();
  readonly textureSizes = new Map<string, number>();
  readonly #pendingQueries: WebGLQuery[] = [];
  #renderCpuMs: number[] = [];
  #gpuFrameMs: number[] = [];

  public constructor(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.#map = map;
    this.#gl = gl;
    const extension: unknown = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const render: unknown = Reflect.get(map, '_render');
    this.#timer =
      isTimerQueryExtension(extension) && typeof render === 'function'
        ? extension
        : null;
    for (const name of glCallNames) {
      const original: unknown = Reflect.get(gl, name);
      if (typeof original !== 'function') continue;
      Reflect.set(gl, name, (...args: unknown[]): unknown => {
        this.#record(name, args);
        const result: unknown = Reflect.apply(original, gl, args);
        return result;
      });
    }
    if (typeof render !== 'function') return;
    Reflect.set(map, '_render', (...args: unknown[]): unknown => {
      const timer = this.#timer;
      const query = timer === null ? null : gl.createQuery();
      if (timer !== null && query !== null)
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      const startedAt = performance.now();
      try {
        const result: unknown = Reflect.apply(render, map, args);
        return result;
      } finally {
        this.#renderCpuMs.push(performance.now() - startedAt);
        if (timer !== null && query !== null) {
          gl.endQuery(timer.TIME_ELAPSED_EXT);
          this.#pendingQueries.push(query);
        }
        this.#collectQueries();
      }
    });
  }

  public get timerQuery(): boolean {
    return this.#timer !== null;
  }

  #record(name: GlCallName, args: readonly unknown[]): void {
    this.#counts.set(name, (this.#counts.get(name) ?? 0) + 1);
    // texStorage2D(target, levels, format, width, height) and texImage2D(target, level,
    // format, width, height, ...) both carry the size in arguments 3 and 4.
    const width =
      name === 'texStorage2D' || name === 'texImage2D' ? args[3] : undefined;
    const height = args[4];
    if (typeof width === 'number' && width === height && width >= 512) {
      const key = `${String(width)}px`;
      this.textureSizes.set(key, (this.textureSizes.get(key) ?? 0) + 1);
    }
  }

  #collectQueries(): void {
    const gl = this.#gl;
    if (this.#timer === null) return;
    const disjoint = gl.getParameter(this.#timer.GPU_DISJOINT_EXT) === true;
    while (this.#pendingQueries.length > 0) {
      const query = this.#pendingQueries[0];
      if (query === undefined) break;
      if (
        gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) !== true &&
        !disjoint
      ) {
        break;
      }
      const nanoseconds: unknown = disjoint
        ? null
        : gl.getQueryParameter(query, gl.QUERY_RESULT);
      if (typeof nanoseconds === 'number') this.#gpuFrameMs.push(nanoseconds / 1e6);
      gl.deleteQuery(query);
      this.#pendingQueries.shift();
    }
  }

  /**
   * Starts a phase: resets counters and frame timings, keeping texture allocations.
   * Queries still pending belong to the unmeasured settle frames and are dropped.
   */
  public resetPhase(): void {
    for (const query of this.#pendingQueries) this.#gl.deleteQuery(query);
    this.#pendingQueries.length = 0;
    this.#counts.clear();
    this.#renderCpuMs = [];
    this.#gpuFrameMs = [];
  }

  /** Waits briefly for outstanding GPU timings, then returns the phase's samples. */
  public async finishPhase(signal: AbortSignal): Promise<{
    readonly counts: ReadonlyMap<GlCallName, number>;
    readonly renderCpuMs: readonly number[];
    readonly gpuFrameMs: readonly number[];
  }> {
    const renderCpuMs = [...this.#renderCpuMs];
    for (
      let attempt = 0;
      attempt < 30 && this.#pendingQueries.length > 0;
      attempt += 1
    ) {
      await nextFrame(signal);
      this.#collectQueries();
    }
    return {
      counts: new Map(this.#counts),
      renderCpuMs,
      gpuFrameMs: [...this.#gpuFrameMs],
    };
  }

  public stop(): void {
    for (const query of this.#pendingQueries) this.#gl.deleteQuery(query);
    this.#pendingQueries.length = 0;
    for (const name of glCallNames) Reflect.deleteProperty(this.#gl, name);
    Reflect.deleteProperty(this.#map, '_render');
  }
}

/** Resolves `true` once the map is idle, or `false` when the limit passes first. */
function waitForIdle(
  map: MapLibreMap,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanUp = () => {
      clearTimeout(timeout);
      map.off('idle', onIdle);
      signal.removeEventListener('abort', onAbort);
    };
    const onIdle = () => {
      cleanUp();
      resolve(true);
    };
    const onAbort = () => {
      cleanUp();
      reject(abortReason(signal));
    };
    const timeout = setTimeout(() => {
      cleanUp();
      resolve(false);
    }, timeoutMs);
    map.on('idle', onIdle);
    signal.addEventListener('abort', onAbort, { once: true });
    map.triggerRepaint();
  });
}

async function ease(
  map: MapLibreMap,
  options: Parameters<MapLibreMap['easeTo']>[0] & { readonly duration: number },
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  map.easeTo({ ...options, easing: (progress) => progress });
  await sleep(options.duration + 50, signal);
}

/** Phase camera scripts; each starts from the fixed scene. */
const phaseScripts: Record<
  RenderBenchmarkPhaseName,
  (map: MapLibreMap, signal: AbortSignal) => Promise<void>
> = {
  // The settled scene: cached draped textures, terrain, and labels.
  static: async (_map, signal) => {
    await sleep(3_000, signal);
  },
  // Turns around the scene, so terrain tiles enter the view and need new textures.
  orbit: async (map, signal) => {
    await ease(map, { bearing: scene.bearing + 120, duration: 4_000 }, signal);
  },
  // Crosses the minimum zooms of detail layers out and back, reloading tiles.
  zoom: async (map, signal) => {
    await ease(map, { zoom: 11.5, duration: 1_500 }, signal);
    await sleep(1_500, signal);
    await ease(map, { zoom: scene.zoom, duration: 1_500 }, signal);
    await sleep(1_500, signal);
  },
  // Pans across the valley with a bearing change, like a user exploring a route.
  pan: async (map, signal) => {
    await ease(
      map,
      {
        center: [scene.longitude + 0.03, scene.latitude + 0.015],
        bearing: scene.bearing + 40,
        duration: 2_000,
      },
      signal,
    );
    await ease(
      map,
      {
        center: [scene.longitude - 0.02, scene.latitude + 0.025],
        bearing: scene.bearing - 30,
        duration: 2_000,
      },
      signal,
    );
    await sleep(1_000, signal);
  },
};

function jumpToScene(map: MapLibreMap): void {
  map.jumpTo({
    center: [scene.longitude, scene.latitude],
    zoom: scene.zoom,
    bearing: scene.bearing,
    pitch: scene.pitch,
  });
}

async function measurePhase(
  map: MapLibreMap,
  probe: MapGlProbe,
  name: RenderBenchmarkPhaseName,
  signal: AbortSignal,
): Promise<RenderBenchmarkPhase> {
  jumpToScene(map);
  const startedSettled = await waitForIdle(map, phaseSettleTimeoutMs, signal);
  probe.resetPhase();
  const frameTimes: number[] = [];
  const onRender = () => {
    frameTimes.push(performance.now());
  };
  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  });
  observer.observe({ type: 'longtask', buffered: false });
  // MapLibre stops drawing once nothing changes, so a pause in a camera script would
  // read as a long frame interval. Repainting every frame keeps each interval the real
  // cost of one frame.
  const repaint = () => {
    if (repainting && !signal.aborted) {
      map.triggerRepaint();
      requestAnimationFrame(repaint);
    }
  };
  let repainting = true;
  const startedAt = performance.now();
  map.on('render', onRender);
  repaint();
  try {
    await phaseScripts[name](map, signal);
  } finally {
    repainting = false;
    map.off('render', onRender);
    observer.disconnect();
  }
  const endedAt = performance.now();
  const durationMs = endedAt - startedAt;
  const { counts, renderCpuMs, gpuFrameMs } = await probe.finishPhase(signal);
  const intervals = phaseFrameIntervals(startedAt, frameTimes, endedAt);
  const frames = Math.max(1, frameTimes.length);
  const glCallsPerFrame = Object.fromEntries(
    glCallNames.map((callName) => [
      callName,
      round((counts.get(callName) ?? 0) / frames),
    ]),
  );
  return {
    name,
    startedSettled,
    durationMs: Math.round(durationMs),
    frames: frameTimes.length,
    framesPerSecond: round((frameTimes.length * 1000) / durationMs),
    frameIntervalMs: distribution(intervals),
    framesOver100Ms: intervals.filter((interval) => interval > 100).length,
    framesOver500Ms: intervals.filter((interval) => interval > 500).length,
    renderCpuMs: distribution(renderCpuMs),
    gpuFrameMs: probe.timerQuery
      ? { ...distribution(gpuFrameMs), samples: gpuFrameMs.length }
      : null,
    glCallsPerFrame,
    longTasks: {
      count: longTasks.length,
      totalMs: Math.round(longTasks.reduce((sum, duration) => sum + duration, 0)),
    },
  };
}

function compileProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ] as const) {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error('The benchmark shader could not be created.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error('The benchmark shader did not link.');
  }
  return program;
}

const quadVertexShader = `#version 300 es
in vec2 a_position;
uniform float u_scale;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position * u_scale, 0.0, 1.0);
}`;

const patternFragmentShader = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_pattern;
out vec4 color;
void main() {
  color = texture(u_pattern, v_uv * 16.0) * vec4(1.0, 1.0, 1.0, 0.35);
}`;

/** Waits until the GPU has executed everything issued so far. */
function finishGpu(gl: WebGL2RenderingContext): void {
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

/**
 * Allocates a framebuffer target and rebinds `sampledTexture` afterwards: drawing while
 * the target's own texture is bound for sampling is a feedback loop that WebGL 2 drops
 * with INVALID_OPERATION, which would time no work at all.
 */
function createTarget(
  gl: WebGL2RenderingContext,
  size: number,
  mipmapped: boolean,
  sampledTexture: WebGLTexture,
): { readonly texture: WebGLTexture; readonly framebuffer: WebGLFramebuffer } {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const levels = mipmapped ? Math.log2(size) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, size, size);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  // Allocation failures under GPU memory pressure surface here, not as exceptions.
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('A benchmark framebuffer could not be allocated.');
  }
  gl.bindTexture(gl.TEXTURE_2D, sampledTexture);
  return { texture, framebuffer };
}

/**
 * Synthetic WebGL work on a separate context, independent of the map's content. Returns
 * `null` when the browser cannot allocate or complete the work, so a failed run never
 * reads as a fast one.
 */
function runSyntheticGpuBenchmark(): SyntheticGpuResults | null {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (gl === null) return null;
  try {
    const program = compileProgram(gl, quadVertexShader, patternFragmentShader);
    gl.useProgram(program);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const scale = gl.getUniformLocation(program, 'u_scale');

    const pattern = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, pattern);
    const patternPixels = new Uint8Array(64 * 64 * 4).map(
      (_, index) => (index * 37) % 251,
    );
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      64,
      64,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      patternPixels,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Fill rate: 32 textured, blended passes over a 1024 px target, after one warm-up.
    const fillTarget = createTarget(gl, 1024, false, pattern);
    gl.viewport(0, 0, 1024, 1024);
    gl.uniform1f(scale, 1);
    const fillPasses = 32;
    const measuredFillRounds = 3;
    let fillMs = 0;
    for (let iteration = 0; iteration <= measuredFillRounds; iteration += 1) {
      const startedAt = performance.now();
      for (let pass = 0; pass < fillPasses; pass += 1)
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      finishGpu(gl);
      if (iteration > 0) fillMs += performance.now() - startedAt;
    }
    const fillMegapixelsPerSecond =
      (measuredFillRounds * fillPasses * 1024 * 1024) /
      1e6 /
      Math.max(fillMs / 1000, 1e-6);
    gl.deleteFramebuffer(fillTarget.framebuffer);
    gl.deleteTexture(fillTarget.texture);

    // Draw calls: tiny quads, each after a uniform-block-sized buffer upload.
    gl.uniform1f(scale, 0.001);
    const uniformBlock = gl.createBuffer();
    const uniformData = new Float32Array(32);
    const draws = 3_000;
    finishGpu(gl);
    const drawStartedAt = performance.now();
    for (let draw = 0; draw < draws; draw += 1) {
      uniformData[0] = draw;
      gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBlock);
      gl.bufferData(gl.UNIFORM_BUFFER, uniformData, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    finishGpu(gl);
    const microsecondsPerDraw = ((performance.now() - drawStartedAt) * 1000) / draws;

    // Draped-texture tiles at both sizes MapLibre can allocate for this DEM; each tile is
    // released after drawing so low-memory GPUs are not pushed into allocation failures.
    const tileMs = (size: number): number => {
      const tiles = 6;
      gl.uniform1f(scale, 1);
      finishGpu(gl);
      const startedAt = performance.now();
      for (let tile = 0; tile < tiles; tile += 1) {
        const target = createTarget(gl, size, true, pattern);
        gl.viewport(0, 0, size, size);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (let pass = 0; pass < 8; pass += 1) gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, pattern);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
      finishGpu(gl);
      return (performance.now() - startedAt) / tiles;
    };
    tileMs(1024);
    const size1024 = tileMs(1024);
    const size2048 = tileMs(2048);
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) return null;
    return {
      fillMegapixelsPerSecond: Math.round(fillMegapixelsPerSecond),
      microsecondsPerDraw: round(microsecondsPerDraw, 2),
      renderToTextureTileMs: {
        size1024: round(size1024, 2),
        size2048: round(size2048, 2),
      },
    };
  } catch {
    return null;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function readWebGlInfo(gl: WebGL2RenderingContext, timerQuery: boolean) {
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor: unknown =
    debugInfo === null ? null : gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
  const renderer: unknown =
    debugInfo === null ? null : gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  const maxTextureSize: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxRenderbufferSize: unknown = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  return {
    vendor: typeof vendor === 'string' ? vendor : null,
    renderer: typeof renderer === 'string' ? renderer : null,
    maxTextureSize: typeof maxTextureSize === 'number' ? maxTextureSize : 0,
    maxRenderbufferSize:
      typeof maxRenderbufferSize === 'number' ? maxRenderbufferSize : 0,
    timerQuery,
  };
}

function readEnvironment(map: MapLibreMap, gl: WebGL2RenderingContext) {
  const canvas = map.getCanvas();
  const deviceMemory: unknown = Reflect.get(navigator, 'deviceMemory');
  const memory: unknown = Reflect.get(performance, 'memory');
  const usedHeap: unknown =
    typeof memory === 'object' && memory !== null
      ? Reflect.get(memory, 'usedJSHeapSize')
      : null;
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: typeof deviceMemory === 'number' ? deviceMemory : null,
    devicePixelRatio: window.devicePixelRatio,
    screen: { width: window.screen.width, height: window.screen.height },
    canvas: {
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      drawingBufferWidth: gl.drawingBufferWidth,
      drawingBufferHeight: gl.drawingBufferHeight,
    },
    jsHeapUsedMb: typeof usedHeap === 'number' ? Math.round(usedHeap / 2 ** 20) : null,
  };
}

function readStyle(map: MapLibreMap) {
  const zoom = map.getZoom();
  const layers = map.getStyle().layers.map((layer) => ({
    id: layer.id,
    type: layer.type,
    visible:
      map.getLayoutProperty(layer.id, 'visibility') !== 'none' &&
      zoom >= (layer.minzoom ?? 0) &&
      zoom < (layer.maxzoom ?? 24),
  }));
  return {
    layerCount: layers.length,
    visibleLayerIds: layers.filter((layer) => layer.visible).map((layer) => layer.id),
    drapedStacks: countDrapedStacks(layers),
  };
}

/**
 * Runs the benchmark on a map that already shows 3D terrain. The caller owns the terrain
 * mode, restores the user's camera afterwards, and can stop the run with `callerSignal`.
 * Hidden tabs get no animation frames, so hiding the tab stops the run instead of
 * measuring nothing.
 */
export async function runRenderBenchmark(
  map: MapLibreMap,
  onStep: (step: RenderBenchmarkStep) => void,
  callerSignal: AbortSignal,
): Promise<RenderBenchmarkReport> {
  const gl = map.getCanvas().getContext('webgl2');
  if (gl === null) throw new Error('The map has no WebGL 2 context.');
  const controller = new AbortController();
  const signal = AbortSignal.any([callerSignal, controller.signal]);
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') return;
    controller.abort(
      new Error(
        'The tab was hidden, so the benchmark stopped. Run it again and keep this tab visible.',
      ),
    );
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  // A run can also start in an already hidden tab, which never fires the event.
  handleVisibilityChange();
  const probe = new MapGlProbe(map, gl);
  try {
    onStep('settle');
    jumpToScene(map);
    const settleStartedAt = performance.now();
    const settled = await waitForIdle(map, sceneSettleTimeoutMs, signal);
    const settleMs = Math.round(performance.now() - settleStartedAt);
    const style = readStyle(map);

    // One unmeasured pass loads the tiles every measured phase reaches.
    onStep('warm-up');
    await phaseScripts.zoom(map, signal);
    jumpToScene(map);
    await phaseScripts.pan(map, signal);

    const phases: RenderBenchmarkPhase[] = [];
    for (const name of ['static', 'orbit', 'zoom', 'pan'] as const) {
      onStep(name);
      phases.push(await measurePhase(map, probe, name, signal));
    }
    const textureSizes = Object.fromEntries(probe.textureSizes);

    onStep('synthetic');
    await waitForIdle(map, 5_000, signal);
    const synthetic = runSyntheticGpuBenchmark();

    return {
      kind: 'trail-planner-render-benchmark',
      version: 1,
      createdAt: new Date().toISOString(),
      environment: readEnvironment(map, gl),
      webGl: readWebGlInfo(gl, probe.timerQuery),
      scene: { ...scene, settleMs, settled },
      style: { ...style, allocatedTextureSizes: textureSizes },
      phases,
      synthetic,
    };
  } finally {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    // An interrupted ease would otherwise keep moving the camera the caller restores.
    if (signal.aborted) map.stop();
    probe.stop();
  }
}
