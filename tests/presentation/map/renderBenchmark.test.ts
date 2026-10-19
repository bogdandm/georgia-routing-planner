import { describe, expect, it } from 'vitest';

import {
  countDrapedStacks,
  phaseFrameIntervals,
  summarizeRenderBenchmark,
  type RenderBenchmarkPhase,
  type RenderBenchmarkReport,
} from '@/presentation/map/renderBenchmark';

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
    synthetic: null,
  };
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
});
