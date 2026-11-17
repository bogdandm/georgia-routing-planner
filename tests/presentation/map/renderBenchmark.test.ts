import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  countDrapedStacks,
  phaseFrameIntervals,
  runRenderBenchmark,
  summarizeRenderBenchmark,
  summarizeSunShadowScene,
  type RenderBenchmarkPhase,
  type RenderBenchmarkReport,
  type RenderBenchmarkStep,
  type SunShadowBenchmarkHooks,
  type SunShadowStepResult,
} from '@/presentation/map/renderBenchmark';
import type { TerrainShadowMetricsSnapshot } from '@/presentation/map/TerrainShadowTileProvider';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function phase(
  name: RenderBenchmarkPhase['name'],
  values: { readonly p95: number; readonly freezes: number; readonly frames?: number },
): RenderBenchmarkPhase {
  return {
    name,
    startedSettled: true,
    durationMs: 1_000,
    frames: values.frames ?? 30,
    framesPerSecond: values.frames ?? 30,
    frameIntervalMs: { p50: 20, p95: values.p95, max: values.p95 },
    framesOver100Ms: 0,
    framesOver500Ms: values.freezes,
    renderCpuMs: { p50: 4, p95: 6, max: 8 },
    gpuFrameMs: null,
    glCallsPerFrame: {},
    longTasks: { count: 0, totalMs: 0 },
  };
}

function report(phases: readonly RenderBenchmarkPhase[]): RenderBenchmarkReport {
  return {
    kind: 'trail-planner-render-benchmark',
    version: 2,
    createdAt: '2026-10-18T00:00:00.000Z',
    environment: {
      userAgent: 'test',
      hardwareConcurrency: 4,
      deviceMemoryGb: null,
      devicePixelRatio: 1,
      screen: { width: 1920, height: 1080 },
      canvas: {
        cssWidth: 1,
        cssHeight: 1,
        drawingBufferWidth: 1,
        drawingBufferHeight: 1,
      },
      jsHeapUsedMb: null,
    },
    webGl: {
      vendor: null,
      renderer: null,
      maxTextureSize: 4096,
      maxRenderbufferSize: 4096,
      timerQuery: false,
    },
    scene: {
      longitude: 0,
      latitude: 0,
      zoom: 0,
      bearing: 0,
      pitch: 0,
      settleMs: 0,
      settled: true,
    },
    style: {
      layerCount: 0,
      visibleLayerIds: [],
      drapedStacks: 1,
      allocatedTextureSizes: {},
    },
    phases,
    sunShadows: null,
    synthetic: null,
  };
}

const emptyShadowMetrics: TerrainShadowMetricsSnapshot = {
  tilesRendered: 0,
  tilesFromCache: 0,
  tilesFailed: 0,
  pendingTiles: 0,
  totalComputeMs: 0,
  maxComputeMs: 0,
  totalDemFetchMs: 0,
  demTilesFetched: 0,
  memoryBytes: 0,
  stages: {},
};

function shadowStep(
  wallMs: number,
  metrics: Partial<TerrainShadowMetricsSnapshot>,
): SunShadowStepResult {
  return {
    instant: '2026-12-21T05:30:00.000Z',
    wallMs,
    settled: true,
    metrics: { ...emptyShadowMetrics, ...metrics },
  };
}

/** Goes idle one frame after every repaint and records camera jumps in `events`. */
class BenchmarkMap {
  readonly #listeners = new Map<string, Set<() => void>>();
  readonly #gl = {
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    getExtension: () => null,
    getParameter: () => 0,
  };
  readonly #canvas = {
    clientWidth: 800,
    clientHeight: 600,
    getContext: () => this.#gl,
  };

  public constructor(private readonly events: string[]) {}

  public getCanvas() {
    return this.#canvas;
  }

  public on(type: string, listener: () => void): void {
    const listeners = this.#listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public off(type: string, listener: () => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public triggerRepaint(): void {
    setTimeout(() => {
      for (const type of ['render', 'idle']) {
        for (const listener of [...(this.#listeners.get(type) ?? [])]) listener();
      }
    }, 16);
  }

  public jumpTo(options: { readonly center: readonly [number, number] }): void {
    this.events.push(`jump ${String(options.center[0])}`);
  }

  public readonly easeTo = vi.fn();

  public readonly stop = vi.fn();

  public getZoom(): number {
    return 14;
  }

  public getStyle() {
    return { layers: [] };
  }

  public getLayoutProperty(): undefined {
    return undefined;
  }
}

async function runFakeBenchmark(
  events: string[],
  sunShadow: SunShadowBenchmarkHooks | null,
): Promise<{
  readonly report: RenderBenchmarkReport;
  readonly steps: readonly RenderBenchmarkStep[];
}> {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'Date',
    ],
  });
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      public readonly observe = vi.fn();
      public readonly disconnect = vi.fn();
    },
  );
  // The synthetic test's own context; jsdom has no WebGL.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const steps: RenderBenchmarkStep[] = [];
  const run = runRenderBenchmark(
    new BenchmarkMap(events) as unknown as MapLibreMap,
    (step) => {
      steps.push(step);
    },
    new AbortController().signal,
    sunShadow,
  );
  await vi.advanceTimersByTimeAsync(120_000);
  return { report: await run, steps };
}

describe('render benchmark', () => {
  it('counts one draped stack per run of visible line and fill layers', () => {
    expect(
      countDrapedStacks([
        { type: 'background', visible: true },
        { type: 'fill', visible: true },
        // Hidden layers never interrupt a stack.
        { type: 'symbol', visible: false },
        { type: 'line', visible: true },
        { type: 'symbol', visible: true },
        { type: 'circle', visible: true },
        { type: 'line', visible: true },
        { type: 'symbol', visible: true },
      ]),
    ).toBe(2);
  });

  it('grades only camera-motion phases at each tier boundary', () => {
    const verdictOf = (...phases: RenderBenchmarkPhase[]) =>
      summarizeRenderBenchmark(report(phases)).verdict;
    const slowStill = phase('static', { p95: 400, freezes: 3 });

    expect(
      verdictOf(
        slowStill,
        phase('orbit', { p95: 34, freezes: 0 }),
        phase('pan', { p95: 20, freezes: 0 }),
      ),
    ).toBe('good');
    expect(verdictOf(phase('orbit', { p95: 34.1, freezes: 0 }))).toBe('okay');
    expect(
      verdictOf(
        phase('zoom', { p95: 100, freezes: 1 }),
        phase('pan', { p95: 20, freezes: 0 }),
      ),
    ).toBe('okay');
    // Freezes add up across motion phases.
    expect(
      verdictOf(
        phase('zoom', { p95: 60, freezes: 1 }),
        phase('pan', { p95: 20, freezes: 1 }),
      ),
    ).toBe('bad');
    expect(verdictOf(phase('orbit', { p95: 250, freezes: 3 }))).toBe('bad');
    expect(verdictOf(phase('orbit', { p95: 250.1, freezes: 0 }))).toBe('potato');
    expect(verdictOf(phase('orbit', { p95: 30, freezes: 4 }))).toBe('potato');
  });

  it('averages motion frame rate over the combined motion time', () => {
    const summary = summarizeRenderBenchmark(
      report([
        phase('static', { p95: 10, freezes: 0, frames: 60 }),
        phase('orbit', { p95: 40, freezes: 0, frames: 10 }),
        phase('zoom', { p95: 40, freezes: 0, frames: 20 }),
      ]),
    );
    expect(summary.staticFramesPerSecond).toBe(60);
    expect(summary.motionFramesPerSecond).toBe(15);
  });

  it('counts time without frames at the phase edges as frame intervals', () => {
    // A phase that never rendered is one freeze, not an empty, perfect sample.
    expect(phaseFrameIntervals(1_000, [], 5_000)).toEqual([4_000]);
    // Rendering that stops early leaves the remaining time as the last interval.
    expect(phaseFrameIntervals(0, [10, 30], 900)).toEqual([10, 20, 870]);
  });

  it('summarizes each sun-shadow scene from its steps and orbit', () => {
    const summary = summarizeSunShadowScene({
      name: 'kazbegi',
      longitude: 44.643,
      latitude: 42.6573,
      zoom: 12.6,
      bearing: 200,
      pitch: 60,
      initial: shadowStep(1_840, {
        tilesRendered: 3,
        totalComputeMs: 100,
        maxComputeMs: 52.34,
        demTilesFetched: 12,
      }),
      timeChange: shadowStep(920, { tilesRendered: 3 }),
      revisit: shadowStep(40, { tilesFromCache: 3 }),
      orbit: phase('orbit', { p95: 48, freezes: 0, frames: 24 }),
      jsHeapUsedMb: null,
      memoryBytes: 25 * 2 ** 20,
    });

    expect(summary).toEqual({
      name: 'kazbegi',
      settled: true,
      initialWallMs: 1_840,
      initialTilesRendered: 3,
      gpuMsPerTile: { mean: 33.3, max: 52.3 },
      demTilesFetched: 12,
      timeChangeWallMs: 920,
      timeChangeTilesRendered: 3,
      revisitWallMs: 40,
      revisitTilesFromCache: 3,
      orbitFramesPerSecond: 24,
      orbitFrameIntervalP95Ms: 48,
      memoryMegabytes: 25,
    });
    // Without computed tiles, there is no per-tile GPU time to average.
    expect(
      summarizeSunShadowScene({
        name: 'ushba',
        longitude: 42.68,
        latitude: 43.095,
        zoom: 12.6,
        bearing: 150,
        pitch: 60,
        jsHeapUsedMb: null,
        memoryBytes: 0,
        initial: shadowStep(10, {}),
        timeChange: { ...shadowStep(30_000, {}), settled: false },
        revisit: shadowStep(10, {}),
        orbit: phase('orbit', { p95: 20, freezes: 0 }),
      }),
    ).toMatchObject({ settled: false, gpuMsPerTile: { mean: 0, max: 0 } });
  });

  it('leaves sun shadows alone and reports none in a plain run', async () => {
    const events: string[] = [];

    const { report: result, steps } = await runFakeBenchmark(events, null);

    expect(result.sunShadows).toBeNull();
    expect(steps).toEqual([
      'settle',
      'warm-up',
      'static',
      'orbit',
      'zoom',
      'pan',
      'synthetic',
    ]);
    expect(new Set(events)).toEqual(new Set(['jump 44.74552']));
  });

  it('measures every phase with shadows on, then each mountain scene', async () => {
    const events: string[] = [];
    const hooks: SunShadowBenchmarkHooks = {
      setInstant: (instantMs) => {
        events.push(`instant ${new Date(instantMs).toISOString()}`);
      },
      metrics: () => ({
        ...emptyShadowMetrics,
        tilesRendered: 4,
        memoryBytes: 2 ** 23,
      }),
      resetMetrics: () => {
        events.push('reset');
      },
    };

    const { report: result, steps } = await runFakeBenchmark(events, hooks);

    const first = 'instant 2026-12-21T05:30:00.000Z';
    const later = 'instant 2026-12-21T05:40:00.000Z';
    // Shadows are on before the Tbilisi scene loads.
    expect(events.slice(0, 2)).toEqual([first, 'jump 44.74552']);
    expect(events.slice(events.indexOf('reset'))).toEqual([
      ...['reset', first, 'jump 44.643', 'reset', later, 'reset', first, 'jump 44.643'],
      ...['reset', first, 'jump 42.68', 'reset', later, 'reset', first, 'jump 42.68'],
    ]);
    const sceneSteps = [
      'shadow-initial',
      'shadow-time-change',
      'shadow-time-revisit',
      'shadow-orbit',
    ];
    expect(steps).toEqual([
      ...['settle', 'warm-up', 'static', 'orbit', 'zoom', 'pan'],
      ...sceneSteps,
      ...sceneSteps,
      'synthetic',
    ]);
    expect(result.phases.map((measured) => measured.name)).toEqual([
      'static',
      'orbit',
      'zoom',
      'pan',
    ]);
    const scenes = result.sunShadows?.scenes ?? [];
    expect(scenes.map((scene) => scene.name)).toEqual(['kazbegi', 'ushba']);
    expect(scenes[0]).toMatchObject({
      initial: { instant: '2026-12-21T05:30:00.000Z', settled: true },
      timeChange: { instant: '2026-12-21T05:40:00.000Z', settled: true },
      revisit: { instant: '2026-12-21T05:30:00.000Z', settled: true },
      orbit: { name: 'orbit', startedSettled: true },
      memoryBytes: 2 ** 23,
    });
  });
});
