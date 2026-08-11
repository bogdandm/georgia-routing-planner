import {
  Alert,
  Button,
  LinearProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { ReactElement } from 'react';
import type { TrackElevationPreparationProgress } from '@/application/tracks/prepareImportedTrack';

import {
  canSaveRoutePlan,
  type RoutePlanDraft,
  type RoutePlanSegmentMode,
} from '@/presentation/tracks/routePlan';

interface RoutePlanControlsProps {
  readonly draft: RoutePlanDraft;
  readonly elevationProgress?: TrackElevationPreparationProgress | null;
  readonly onClear: () => void;
  readonly onDiscard: () => void;
  readonly onNameChange: (name: string) => void;
  readonly onNextSegmentModeChange: (mode: RoutePlanSegmentMode) => void;
  readonly onSave: () => void;
  readonly onUndo: () => void;
}

function failureMessage(failure: NonNullable<RoutePlanDraft['failure']>): string {
  if (failure.reason === 'no-nearby-trail') {
    if (failure.endpoint === 'both') {
      return 'No routable trail or road was found within 200 m of the start and destination points.';
    }
    return `No routable trail or road was found within 200 m of the ${
      failure.endpoint ?? 'selected'
    } point.`;
  }
  if (failure.reason === 'no-route') {
    return 'No connected route was found. Add a closer point or use Line for the next segment.';
  }
  if (failure.reason === 'area-too-large') {
    return 'This segment covers too large an area. Add an intermediate point.';
  }
  if (failure.reason === 'routing-data-unavailable') {
    return 'Routing data is unavailable. Try again when you are online.';
  }
  if (failure.reason === 'routing-timeout') {
    return 'Route calculation exceeded one minute. Add a closer point or try again.';
  }
  return 'Routing data could not be decoded.';
}

export function RoutePlanStatus({
  draft,
  elevationProgress,
}: {
  readonly draft: RoutePlanDraft;
  readonly elevationProgress: TrackElevationPreparationProgress | null;
}): ReactElement {
  let content: ReactElement;
  if (draft.status === 'calculating') {
    const progress = draft.routeProgress;
    const label =
      progress?.phase === 'loading-tiles'
        ? progress.totalTileCount > 0
          ? `Loading route tiles… ${String(progress.loadedTileCount)}/${String(progress.totalTileCount)}`
          : 'Loading route tiles…'
        : progress?.phase === 'building-graph'
          ? `Building route graph… ${String(Math.round(progress.graphProgress * 100))}%`
          : progress?.phase === 'searching-route'
            ? 'Searching for a route…'
            : 'Loading route tiles…';
    const value =
      progress?.phase === 'loading-tiles' && progress.totalTileCount > 0
        ? (progress.loadedTileCount / progress.totalTileCount) * 100
        : progress?.phase === 'building-graph'
          ? progress.graphProgress * 100
          : undefined;
    content = (
      <Stack spacing={0.75}>
        <Typography variant="body2">{label}</Typography>
        <LinearProgress
          aria-label={label}
          variant={value === undefined ? 'indeterminate' : 'determinate'}
          value={value}
        />
      </Stack>
    );
  } else if (draft.status === 'saving') {
    content = (
      <Stack spacing={0.75}>
        <Typography variant="body2">Saving route…</Typography>
        <LinearProgress aria-label="Saving route…" />
      </Stack>
    );
  } else if (draft.status === 'elevation-enriching') {
    const label =
      elevationProgress !== null && elevationProgress.totalTiles > 0
        ? `Loading elevation tiles: ${String(elevationProgress.completedTiles)} of ${String(elevationProgress.totalTiles)}`
        : 'Preparing terrain and elevation…';
    const value =
      elevationProgress !== null && elevationProgress.totalTiles > 0
        ? (elevationProgress.completedTiles / elevationProgress.totalTiles) * 100
        : undefined;
    content = (
      <Stack spacing={0.75}>
        <Typography variant="body2">{label}</Typography>
        <LinearProgress
          aria-label={label}
          variant={value === undefined ? 'indeterminate' : 'determinate'}
          value={value}
        />
      </Stack>
    );
  } else if (draft.status === 'failed' && draft.failure !== null) {
    content = <Alert severity="warning">{failureMessage(draft.failure)}</Alert>;
  } else if (draft.status === 'elevation-failed') {
    content = (
      <Alert severity="info">
        Elevation is unavailable. The route geometry is ready and can still be saved.
      </Alert>
    );
  } else {
    const instruction =
      draft.status === 'selecting-start'
        ? 'Click the map to choose the route start.'
        : draft.status === 'selecting-destination'
          ? 'Click the map to choose the next point.'
          : 'Route ready. Click the map to add another point.';
    content = (
      <Typography variant="body2" color="text.secondary">
        {instruction}
      </Typography>
    );
  }
  return (
    <Stack aria-live="polite" role="status" sx={{ minHeight: 40 }}>
      {content}
    </Stack>
  );
}

export function RoutePlanControls({
  draft,
  elevationProgress = null,
  onClear,
  onDiscard,
  onNameChange,
  onNextSegmentModeChange,
  onSave,
  onUndo,
}: RoutePlanControlsProps): ReactElement {
  const locked =
    draft.status === 'calculating' ||
    draft.status === 'saving' ||
    draft.pendingRequest !== null ||
    draft.queuedWaypoints.length > 0;
  return (
    <Stack spacing={2}>
      <TextField
        size="small"
        label="Track name"
        value={draft.name}
        disabled={locked}
        onChange={(event) => {
          onNameChange(event.target.value);
        }}
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />
      <Stack spacing={0.75}>
        <Typography variant="caption" color="text.secondary">
          Next segment
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          aria-label="Next segment"
          value={draft.nextSegmentMode}
          onChange={(_event, value: RoutePlanSegmentMode | null) => {
            if (value !== null) onNextSegmentModeChange(value);
          }}
        >
          <ToggleButton value="routes" disabled={locked}>
            Routes
          </ToggleButton>
          <ToggleButton value="line" disabled={locked}>
            Line
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <RoutePlanStatus draft={draft} elevationProgress={elevationProgress} />
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            color="inherit"
            disabled={draft.status === 'saving' || draft.waypoints.length === 0}
            onClick={onUndo}
          >
            Undo
          </Button>
          <Button
            size="small"
            color="inherit"
            disabled={draft.status === 'saving' || draft.waypoints.length === 0}
            onClick={onClear}
          >
            Clear
          </Button>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            color="inherit"
            disabled={draft.status === 'saving'}
            onClick={onDiscard}
          >
            Discard
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!canSaveRoutePlan(draft)}
            onClick={onSave}
          >
            Save
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}
