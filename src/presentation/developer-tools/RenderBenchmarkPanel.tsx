import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { downloadFile } from '@/presentation/downloadFile';
import {
  mapInteractionStore,
  requestRenderBenchmark,
} from '@/presentation/map/mapInteractionStore';
import {
  sceneSettleTimeoutMs,
  summarizeRenderBenchmark,
  summarizeSunShadowScene,
  type RenderBenchmarkReport,
  type RenderBenchmarkStep,
  type RenderBenchmarkVerdict,
  type SunShadowBenchmarkResults,
  type SunShadowSceneName,
} from '@/presentation/map/renderBenchmark';

const stepLabels: Record<RenderBenchmarkStep, string> = {
  settle: `Loading the 3D scene; waits for every tile, at most ${String(sceneSettleTimeoutMs / 1000)} s`,
  'warm-up': 'Loading tiles for the measured moves',
  static: 'Measuring a still view',
  orbit: 'Measuring rotation',
  zoom: 'Measuring zoom out and in',
  pan: 'Measuring panning',
  'shadow-initial': 'Computing sun shadows for a mountain scene',
  'shadow-time-change': 'Recomputing sun shadows 10 minutes later',
  'shadow-time-revisit': 'Returning to the first shadow time',
  'shadow-orbit': 'Measuring rotation over mountains with sun shadows',
  synthetic: 'Measuring raw GPU throughput',
};
const plainSteps: readonly RenderBenchmarkStep[] = [
  'settle',
  'warm-up',
  'static',
  'orbit',
  'zoom',
  'pan',
  'synthetic',
];
/** Shadow steps repeat per mountain scene, so progress steps back between scenes. */
const sunShadowSteps: readonly RenderBenchmarkStep[] = [
  'settle',
  'warm-up',
  'static',
  'orbit',
  'zoom',
  'pan',
  'shadow-initial',
  'shadow-time-change',
  'shadow-time-revisit',
  'shadow-orbit',
  'synthetic',
];

const sunShadowSceneLabels: Record<SunShadowSceneName, string> = {
  kazbegi: 'Kazbegi',
  ushba: 'Ushba',
};

const verdictChips: Record<
  RenderBenchmarkVerdict,
  {
    readonly label: string;
    readonly color: 'success' | 'info' | 'warning' | 'error';
  }
> = {
  good: { label: 'Good', color: 'success' },
  okay: { label: 'Okay', color: 'info' },
  bad: { label: 'Bad', color: 'warning' },
  potato: { label: 'Potato', color: 'error' },
};

function SunShadowSummary({
  results,
}: {
  readonly results: SunShadowBenchmarkResults;
}) {
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        Sun shadows at {results.instant}, then {String(results.timeChangeMinutes)}{' '}
        minutes later
      </Typography>
      {results.scenes.map((result) => {
        const summary = summarizeSunShadowScene(result);
        return (
          <Box key={summary.name}>
            <Typography variant="subtitle2">
              {sunShadowSceneLabels[summary.name]}
              {summary.settled ? '' : ': did not finish loading in time'}
            </Typography>
            <Typography variant="body2">
              First view: {String(summary.initialWallMs)} ms,{' '}
              {String(summary.initialTilesRendered)} tiles, GPU{' '}
              {String(summary.gpuMsPerTile.mean)} ms mean and{' '}
              {String(summary.gpuMsPerTile.max)} ms max per tile,{' '}
              {String(summary.demTilesFetched)} elevation tiles
            </Typography>
            <Typography variant="body2">
              Time change: {String(summary.timeChangeWallMs)} ms,{' '}
              {String(summary.timeChangeTilesRendered)} tiles
            </Typography>
            <Typography variant="body2">
              Back to the first time: {String(summary.revisitWallMs)} ms,{' '}
              {String(summary.revisitTilesFromCache)} tiles from cache
            </Typography>
            <Typography variant="body2">
              Rotation: {String(summary.orbitFramesPerSecond)} fps, 95% of frames within{' '}
              {String(summary.orbitFrameIntervalP95Ms)} ms
            </Typography>
            <Typography variant="body2">
              Shadow worker memory: {String(summary.memoryMegabytes)} MB
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

function BenchmarkSummary({ report }: { readonly report: RenderBenchmarkReport }) {
  const { buildInfo } = useRuntimeServices();
  const summary = summarizeRenderBenchmark(report);
  const chip = verdictChips[summary.verdict];
  const { synthetic } = report;
  const loadedBeforeMeasuring =
    report.scene.settled && report.phases.every((phase) => phase.startedSettled);
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Chip size="small" label={chip.label} color={chip.color} />
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {summary.gpu}
        </Typography>
      </Stack>
      {loadedBeforeMeasuring ? null : (
        <Alert severity="warning">
          The scene did not finish loading in time, so these numbers include tile
          loading. Run the benchmark again to measure with cached tiles.
        </Alert>
      )}
      <Box>
        <Typography variant="body2">
          Still view: {String(summary.staticFramesPerSecond)} fps, CPU{' '}
          {String(summary.renderCpuP50Ms)} ms
          {summary.gpuFrameP50Ms === null
            ? ''
            : `, GPU ${String(summary.gpuFrameP50Ms)} ms`}{' '}
          per frame
        </Typography>
        <Typography variant="body2">
          Camera motion: {String(summary.motionFramesPerSecond)} fps, 95% of frames
          within {String(summary.motionFrameIntervalP95Ms)} ms, freezes over 0.5 s:{' '}
          {String(summary.freezesOver500Ms)}
        </Typography>
        <Typography variant="body2">
          3D textures: {String(report.style.drapedStacks)} per terrain tile
        </Typography>
        {synthetic === null ? (
          <Typography variant="body2">
            Raw GPU: unavailable; the browser could not allocate or finish the test.
          </Typography>
        ) : (
          <Typography variant="body2">
            Raw GPU: fill {String(synthetic.fillMegapixelsPerSecond)} Mpx/s, draw call{' '}
            {String(synthetic.microsecondsPerDraw)} µs, terrain texture{' '}
            {String(synthetic.renderToTextureTileMs.size1024)} ms at 1024 px and{' '}
            {String(synthetic.renderToTextureTileMs.size2048)} ms at 2048 px
          </Typography>
        )}
      </Box>
      {report.sunShadows === null ? null : (
        <SunShadowSummary results={report.sunShadows} />
      )}
      <Button
        size="small"
        variant="outlined"
        startIcon={<DownloadOutlinedIcon />}
        onClick={() => {
          downloadFile(
            `render-benchmark-${report.createdAt.replaceAll(':', '-')}.json`,
            'application/json',
            `${JSON.stringify({ app: buildInfo, ...report }, null, 2)}\n`,
          );
        }}
      >
        Download benchmark report
      </Button>
    </Stack>
  );
}

/** Whole seconds since `startedAt`, refreshed every second while the step runs. */
function StepElapsed({ startedAt }: { readonly startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);
  return <> · {String(Math.max(0, Math.floor((now - startedAt) / 1000)))} s</>;
}

/** Developer drawer section that requests the map's 3D render benchmark. */
export function RenderBenchmarkPanel() {
  const state = useStore(mapInteractionStore, (current) => current.renderBenchmark);
  const busy = state.status === 'requested' || state.status === 'running';
  const steps =
    state.status === 'running' && state.options.sunShadows
      ? sunShadowSteps
      : plainSteps;
  const stepIndex = state.status === 'running' ? steps.indexOf(state.step) : 0;
  return (
    <Stack spacing={1}>
      <Typography variant="overline">3D render benchmark</Typography>
      <Typography variant="body2" color="text.secondary">
        Switches to 3D over Tbilisi for about a minute, measures rendering, then
        restores your view. With sun shadows, it also measures shadows over Kazbegi and
        Ushba, which takes longer, then restores your shadow settings. Keep this tab
        visible and leave the map alone while it runs.
      </Typography>
      <Button
        size="small"
        variant="outlined"
        startIcon={<SpeedOutlinedIcon />}
        disabled={busy}
        onClick={() => {
          requestRenderBenchmark({ sunShadows: false });
        }}
      >
        Run 3D benchmark
      </Button>
      <Button
        size="small"
        variant="outlined"
        startIcon={<SpeedOutlinedIcon />}
        disabled={busy}
        onClick={() => {
          requestRenderBenchmark({ sunShadows: true });
        }}
      >
        Run 3D benchmark with sun shadows
      </Button>
      {busy ? (
        <Box>
          <LinearProgress
            variant="determinate"
            value={(stepIndex / steps.length) * 100}
            aria-label="Benchmark progress"
          />
          <Typography variant="caption" color="text.secondary">
            {state.status === 'running' ? (
              <>
                {stepLabels[state.step]}
                <StepElapsed
                  key={state.stepStartedAt}
                  startedAt={state.stepStartedAt}
                />
              </>
            ) : (
              'Waiting for the map'
            )}
          </Typography>
        </Box>
      ) : null}
      {state.status === 'failed' ? (
        <Alert severity="error">{state.message}</Alert>
      ) : null}
      {state.status === 'complete' ? <BenchmarkSummary report={state.report} /> : null}
    </Stack>
  );
}
