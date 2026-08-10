import {
  Alert,
  Button,
  CircularProgress,
  LinearProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { ReactElement } from 'react';

import {
  canSaveRoutePlan,
  type RoutePlanDraft,
  type RoutePlanSegmentMode,
} from '@/presentation/tracks/routePlan';

interface RoutePlanControlsProps {
  readonly draft: RoutePlanDraft;
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

function RoutePlanStatus({ draft }: { readonly draft: RoutePlanDraft }): ReactElement {
  if (draft.status === 'calculating') {
    const progress = draft.routeProgress;
    const label =
      progress?.phase === 'loading-tiles'
        ? progress.totalTileCount > 0
          ? `Loading route tiles… ${String(progress.loadedTileCount)}/${String(progress.totalTileCount)}`
          : 'Loading route tiles…'
        : progress?.phase === 'building-graph'
          ? 'Building route graph…'
          : progress?.phase === 'searching-route'
            ? 'Searching for a route…'
            : 'Loading route tiles…';
    const value =
      progress?.phase === 'loading-tiles' && progress.totalTileCount > 0
        ? (progress.loadedTileCount / progress.totalTileCount) * 100
        : undefined;
    return (
      <Stack spacing={0.75}>
        <Typography variant="body2">{label}</Typography>
        <LinearProgress
          aria-label={label}
          variant={value === undefined ? 'indeterminate' : 'determinate'}
          value={value}
        />
      </Stack>
    );
  }
  if (draft.status === 'saving') {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={18} />
        <Typography variant="body2">Saving route…</Typography>
      </Stack>
    );
  }
  if (draft.status === 'elevation-enriching') {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={18} />
        <Typography variant="body2">Preparing elevation…</Typography>
      </Stack>
    );
  }
  if (draft.status === 'failed' && draft.failure !== null) {
    return <Alert severity="warning">{failureMessage(draft.failure)}</Alert>;
  }
  if (draft.status === 'elevation-failed') {
    return (
      <Alert severity="info">
        Elevation is unavailable. The route geometry is ready and can still be saved.
      </Alert>
    );
  }
  const instruction =
    draft.status === 'selecting-start'
      ? 'Click the map to choose the route start.'
      : draft.status === 'selecting-destination'
        ? 'Click the map to choose the next point.'
        : 'Route ready. Click the map to add another point.';
  return (
    <Typography variant="body2" color="text.secondary">
      {instruction}
    </Typography>
  );
}

export function RoutePlanControls({
  draft,
  onClear,
  onDiscard,
  onNameChange,
  onNextSegmentModeChange,
  onSave,
  onUndo,
}: RoutePlanControlsProps): ReactElement {
  const locked = draft.status === 'calculating' || draft.status === 'saving';
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
      <RoutePlanStatus draft={draft} />
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
