import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined';
import {
  Alert,
  Button,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
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

/** Mode changes wait for the pending leg and queued points, and nothing edits during save. */
function isRoutePlanLocked(draft: RoutePlanDraft): boolean {
  return (
    draft.status === 'calculating' ||
    draft.status === 'saving' ||
    draft.pendingRequest !== null ||
    draft.queuedWaypoints.length > 0
  );
}

function NextSegmentModeToggle({
  draft,
  fullWidth,
  onChange,
}: {
  readonly draft: RoutePlanDraft;
  readonly fullWidth: boolean;
  readonly onChange: (mode: RoutePlanSegmentMode) => void;
}): ReactElement {
  const { t } = useLingui();
  const locked = isRoutePlanLocked(draft);
  return (
    <ToggleButtonGroup
      exclusive
      fullWidth={fullWidth}
      size="small"
      aria-label={t`Next segment`}
      value={draft.nextSegmentMode}
      onChange={(_event, value: RoutePlanSegmentMode | null) => {
        if (value !== null) onChange(value);
      }}
    >
      <ToggleButton value="routes" disabled={locked}>
        <Trans>Routes</Trans>
      </ToggleButton>
      <ToggleButton value="line" disabled={locked}>
        <Trans>Line</Trans>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

/**
 * Undo and Next segment for planning while the editor is hidden: under the collapsed
 * desktop navigation and inside the smartphone track disclosure.
 */
export function RoutePlanQuickControls({
  draft,
  fullWidth = false,
  onNextSegmentModeChange,
  onUndo,
}: {
  readonly draft: RoutePlanDraft;
  readonly fullWidth?: boolean;
  readonly onNextSegmentModeChange: (mode: RoutePlanSegmentMode) => void;
  readonly onUndo: () => void;
}): ReactElement {
  const { t } = useLingui();
  const undoDisabled = draft.status === 'saving' || draft.waypoints.length === 0;
  return (
    <Stack
      direction="row"
      spacing={1}
      role="toolbar"
      aria-label={t`Route planning`}
      sx={{ width: fullWidth ? '100%' : undefined, alignItems: 'center' }}
    >
      <Tooltip title={t`Undo`}>
        <span>
          <IconButton
            color="inherit"
            aria-label={t`Undo`}
            disabled={undoDisabled}
            onClick={onUndo}
          >
            <UndoOutlinedIcon />
          </IconButton>
        </span>
      </Tooltip>
      <NextSegmentModeToggle
        draft={draft}
        fullWidth={fullWidth}
        onChange={onNextSegmentModeChange}
      />
    </Stack>
  );
}

function failureMessage(
  failure: NonNullable<RoutePlanDraft['failure']>,
  i18n: I18n,
): string {
  if (failure.reason === 'no-nearby-trail') {
    if (failure.endpoint === 'both') {
      return i18n._(
        msg`No routable trail or road was found within 200 m of the start and destination points.`,
      );
    }
    if (failure.endpoint === 'start') {
      return i18n._(
        msg`No routable trail or road was found within 200 m of the start point.`,
      );
    }
    if (failure.endpoint === 'destination') {
      return i18n._(
        msg`No routable trail or road was found within 200 m of the destination point.`,
      );
    }
    return i18n._(
      msg`No routable trail or road was found within 200 m of the selected point.`,
    );
  }
  if (failure.reason === 'no-route') {
    return i18n._(
      msg`No connected route was found. Add a closer point or use Line for the next segment.`,
    );
  }
  if (failure.reason === 'area-too-large') {
    return i18n._(
      msg`This segment covers too large an area. Add an intermediate point.`,
    );
  }
  if (failure.reason === 'routing-data-unavailable') {
    return i18n._(msg`Routing data is unavailable. Try again when you are online.`);
  }
  if (failure.reason === 'routing-timeout') {
    return i18n._(
      msg`Route calculation exceeded one minute. Add a closer point or try again.`,
    );
  }
  return i18n._(msg`Routing data could not be decoded.`);
}

export function RoutePlanStatus({
  draft,
  elevationProgress,
}: {
  readonly draft: RoutePlanDraft;
  readonly elevationProgress: TrackElevationPreparationProgress | null;
}): ReactElement {
  const { i18n, t } = useLingui();
  let content: ReactElement;
  if (draft.status === 'calculating') {
    const progress = draft.routeProgress;
    const countFormatter = new Intl.NumberFormat(i18n.locale);
    let label: string;
    if (progress?.phase === 'loading-tiles' && progress.totalTileCount > 0) {
      const loadedTiles = countFormatter.format(progress.loadedTileCount);
      const totalTiles = countFormatter.format(progress.totalTileCount);
      label = t`Loading route tiles… ${loadedTiles}/${totalTiles}`;
    } else if (progress?.phase === 'building-graph') {
      const graphProgress = new Intl.NumberFormat(i18n.locale, {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option token.
        style: 'percent',
      }).format(Math.round(progress.graphProgress * 100) / 100);
      label = t`Building route graph… ${graphProgress}`;
    } else if (progress?.phase === 'searching-route') {
      label = t`Searching for a route…`;
    } else {
      label = t`Loading route tiles…`;
    }
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
        <Typography variant="body2">
          <Trans>Saving route…</Trans>
        </Typography>
        <LinearProgress aria-label={t`Saving route…`} />
      </Stack>
    );
  } else if (draft.status === 'elevation-enriching') {
    let label: string;
    if (elevationProgress !== null && elevationProgress.totalTiles > 0) {
      const countFormatter = new Intl.NumberFormat(i18n.locale);
      const completedTiles = countFormatter.format(elevationProgress.completedTiles);
      const totalTiles = countFormatter.format(elevationProgress.totalTiles);
      label = t`Loading elevation tiles: ${completedTiles} of ${totalTiles}`;
    } else {
      label = t`Preparing terrain and elevation…`;
    }
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
    content = <Alert severity="warning">{failureMessage(draft.failure, i18n)}</Alert>;
  } else if (draft.status === 'elevation-failed') {
    content = (
      <Alert severity="info">
        <Trans>
          Elevation is unavailable. The route geometry is ready and can still be saved.
        </Trans>
      </Alert>
    );
  } else {
    const instruction =
      draft.status === 'selecting-start'
        ? t`Click the map to choose the route start.`
        : draft.status === 'selecting-destination'
          ? t`Click the map to choose the next point.`
          : t`Route ready. Click the map to add another point.`;
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
  const { t } = useLingui();
  const locked = isRoutePlanLocked(draft);
  return (
    <Stack spacing={2}>
      <TextField
        size="small"
        label={t`Track name`}
        value={draft.name}
        disabled={locked}
        onChange={(event) => {
          onNameChange(event.target.value);
        }}
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />
      <Stack spacing={0.75}>
        <Typography variant="caption" color="text.secondary">
          <Trans>Next segment</Trans>
        </Typography>
        <NextSegmentModeToggle
          fullWidth
          draft={draft}
          onChange={onNextSegmentModeChange}
        />
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
            <Trans>Undo</Trans>
          </Button>
          <Button
            size="small"
            color="inherit"
            disabled={draft.status === 'saving' || draft.waypoints.length === 0}
            onClick={onClear}
          >
            <Trans>Clear</Trans>
          </Button>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            color="inherit"
            disabled={draft.status === 'saving'}
            onClick={onDiscard}
          >
            <Trans>Discard</Trans>
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!canSaveRoutePlan(draft)}
            onClick={onSave}
          >
            <Trans>Save</Trans>
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}
