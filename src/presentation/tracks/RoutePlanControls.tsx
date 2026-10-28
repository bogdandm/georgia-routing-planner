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

import { ShortcutTooltipTitle } from '@/presentation/KeyboardShortcutKeys';
import {
  canSaveTrackPath,
  canUndoTrackPath,
  type PathLegMode,
  type RoutePlanDraft,
  type TrackPathDraft,
  type TrackPathFailure,
} from '@/presentation/tracks/trackPathEditor';

interface RoutePlanControlsProps {
  readonly draft: RoutePlanDraft;
  readonly elevationProgress?: TrackElevationPreparationProgress | null;
  readonly onClear: () => void;
  readonly onDiscard: () => void;
  readonly onNameChange: (name: string) => void;
  readonly onSave: () => void;
  readonly onUndo: () => void;
}

/**
 * Undo and the mode of new points for planning while the editor is hidden: under the
 * collapsed desktop navigation and inside the smartphone track disclosure.
 */
export function RoutePlanQuickControls({
  draft,
  fullWidth = false,
  onNextSegmentModeChange,
  onUndo,
}: {
  readonly draft: RoutePlanDraft;
  readonly fullWidth?: boolean;
  readonly onNextSegmentModeChange: (mode: PathLegMode) => void;
  readonly onUndo: () => void;
}): ReactElement {
  const { t } = useLingui();
  return (
    <Stack
      direction="row"
      spacing={1}
      role="toolbar"
      aria-label={t`Route planning`}
      sx={{ width: fullWidth ? '100%' : undefined, alignItems: 'center' }}
    >
      <Tooltip
        describeChild
        title={<ShortcutTooltipTitle label={t`Undo`} shortcut={{ action: 'undo' }} />}
      >
        <span>
          <IconButton
            color="inherit"
            aria-label={t`Undo`}
            disabled={!canUndoTrackPath(draft)}
            onClick={onUndo}
          >
            <UndoOutlinedIcon />
          </IconButton>
        </span>
      </Tooltip>
      <ToggleButtonGroup
        exclusive
        fullWidth={fullWidth}
        size="small"
        aria-label={t`Next segment`}
        value={draft.insertion?.mode ?? null}
        onChange={(_event, value: PathLegMode | null) => {
          if (value !== null) onNextSegmentModeChange(value);
        }}
      >
        <ToggleButton value="routes" disabled={draft.status === 'saving'}>
          <Trans>Routes</Trans>
        </ToggleButton>
        <ToggleButton value="line" disabled={draft.status === 'saving'}>
          <Trans>Line</Trans>
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

function failureMessage(failure: TrackPathFailure, i18n: I18n): string {
  const { result, pointNumbers } = failure;
  if (result.reason === 'no-nearby-trail') {
    const [onlyPoint] = pointNumbers;
    if (onlyPoint !== undefined && pointNumbers.length === 1) {
      const point = new Intl.NumberFormat(i18n.locale).format(onlyPoint);
      return i18n._(
        msg`No routable trail or road was found within 200 m of point ${point}.`,
      );
    }
    if (pointNumbers.length > 1) {
      const numberFormat = new Intl.NumberFormat(i18n.locale);
      const points = new Intl.ListFormat(i18n.locale).format(
        pointNumbers.map((pointNumber) => numberFormat.format(pointNumber)),
      );
      return i18n._(
        msg`No routable trail or road was found within 200 m of points ${points}.`,
      );
    }
    return i18n._(
      msg`No routable trail or road was found within 200 m of the selected point.`,
    );
  }
  if (result.reason === 'no-route') {
    return i18n._(
      msg`No connected route was found. Add a closer point or use Line for this segment.`,
    );
  }
  if (result.reason === 'area-too-large') {
    return i18n._(
      msg`This segment covers too large an area. Add an intermediate point.`,
    );
  }
  if (result.reason === 'routing-data-unavailable') {
    return i18n._(msg`Routing data is unavailable. Try again when you are online.`);
  }
  if (result.reason === 'routing-timeout') {
    return i18n._(
      msg`Route calculation exceeded one minute. Add a closer point or try again.`,
    );
  }
  return i18n._(msg`Routing data could not be decoded.`);
}

/** Saved-track editing needs no idle hint: the Points list shows move and add hints. */
function instruction(draft: TrackPathDraft, i18n: I18n): string | null {
  if (draft.variant === 'track') return null;
  if (draft.movingAnchorId !== null) {
    return i18n._(msg`Click the map to move the point.`);
  }
  if (draft.status === 'selecting-start') {
    return i18n._(msg`Click the map to choose the route start.`);
  }
  if (draft.status === 'selecting-destination') {
    return i18n._(msg`Click the map to choose the next point.`);
  }
  return i18n._(msg`Route ready. Click the map to add another point.`);
}

/**
 * One fixed slot for routing, elevation, saving, failures, and the next action; empty
 * while a saved track is edited without work in progress.
 */
export function RoutePlanStatus({
  draft,
  elevationProgress,
}: {
  readonly draft: TrackPathDraft;
  readonly elevationProgress: TrackElevationPreparationProgress | null;
}): ReactElement | null {
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
    } else if (progress?.phase === 'loading-terrain') {
      label = t`Loading route terrain…`;
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
    const label = draft.variant === 'plan' ? t`Saving route…` : t`Saving track…`;
    content = (
      <Stack spacing={0.75}>
        <Typography variant="body2">{label}</Typography>
        <LinearProgress aria-label={label} />
      </Stack>
    );
  } else if (draft.status === 'elevation-enriching') {
    const completedFraction =
      elevationProgress !== null && elevationProgress.totalSamples > 0
        ? elevationProgress.completedSamples / elevationProgress.totalSamples
        : null;
    let label: string;
    if (completedFraction === null) {
      label = t`Preparing elevation…`;
    } else {
      const percent = new Intl.NumberFormat(i18n.locale, {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option token.
        style: 'percent',
      }).format(Math.floor(completedFraction * 100) / 100);
      label = t`Loading elevation: ${percent}`;
    }
    const value = completedFraction === null ? undefined : completedFraction * 100;
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
  } else if (draft.failure !== null) {
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
    const text = instruction(draft, i18n);
    if (text === null) return null;
    content = (
      <Typography variant="body2" color="text.secondary">
        {text}
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
  onSave,
  onUndo,
}: RoutePlanControlsProps): ReactElement {
  const { t } = useLingui();
  const saving = draft.status === 'saving';
  return (
    <Stack spacing={2}>
      <TextField
        size="small"
        label={t`Track name`}
        value={draft.name}
        disabled={saving}
        onChange={(event) => {
          onNameChange(event.target.value);
        }}
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />
      <RoutePlanStatus draft={draft} elevationProgress={elevationProgress} />
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1}>
          <Tooltip
            describeChild
            title={
              <ShortcutTooltipTitle label={t`Undo`} shortcut={{ action: 'undo' }} />
            }
          >
            <span>
              <Button
                size="small"
                color="inherit"
                disabled={!canUndoTrackPath(draft)}
                onClick={onUndo}
              >
                <Trans>Undo</Trans>
              </Button>
            </span>
          </Tooltip>
          <Button
            size="small"
            color="inherit"
            disabled={saving || draft.path.anchors.length === 0}
            onClick={onClear}
          >
            <Trans>Clear</Trans>
          </Button>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" color="inherit" disabled={saving} onClick={onDiscard}>
            <Trans>Discard</Trans>
          </Button>
          <Tooltip
            describeChild
            title={
              <ShortcutTooltipTitle label={t`Save`} shortcut={{ action: 'save' }} />
            }
          >
            <span>
              <Button
                size="small"
                variant="contained"
                disabled={!canSaveTrackPath(draft)}
                onClick={onSave}
              >
                <Trans>Save</Trans>
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
    </Stack>
  );
}

/** Point editing of a saved track, pinned below the scrolling pane. */
export function TrackEditControls({
  draft,
  onCancel,
  onSave,
  onUndo,
}: {
  readonly draft: TrackPathDraft;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onUndo: () => void;
}): ReactElement {
  const { t } = useLingui();
  const saving = draft.status === 'saving';
  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
      <Tooltip
        describeChild
        title={<ShortcutTooltipTitle label={t`Undo`} shortcut={{ action: 'undo' }} />}
      >
        <span>
          <Button
            size="small"
            color="inherit"
            disabled={!canUndoTrackPath(draft)}
            onClick={onUndo}
          >
            <Trans>Undo</Trans>
          </Button>
        </span>
      </Tooltip>
      <Stack direction="row" spacing={1}>
        <Button size="small" color="inherit" disabled={saving} onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Tooltip
          describeChild
          title={<ShortcutTooltipTitle label={t`Save`} shortcut={{ action: 'save' }} />}
        >
          <span>
            <Button
              size="small"
              variant="contained"
              disabled={!canSaveTrackPath(draft)}
              onClick={onSave}
            >
              <Trans>Save</Trans>
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
