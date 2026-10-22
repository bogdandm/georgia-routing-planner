import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { keyframes } from '@mui/material/styles';
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';

import { useStore } from 'zustand';

import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';
import {
  setHoveredTrackPoint,
  trackPointHoverStore,
} from '@/presentation/tracks/trackPointHoverStore';
import {
  formatTrackDistance,
  formatTrackElevation,
} from '@/presentation/tracks/trackFormatters';

export type TrackPointsLegMode = 'routes' | 'line';

export interface TrackPointsAnchorView {
  /** Stable anchor id used as the React key. */
  readonly key: number;
  /**
   * Cumulative distance along the path. Independent segments add no distance, so a
   * segment's last point and the next segment's first point share it; the coordinate
   * tells them apart.
   */
  readonly distanceMeters: number;
  readonly coordinate: TrackCoordinate;
  readonly elevationMeters: number | null;
}

export type TrackPointsLegView =
  /** Boundary between independent segments: no line and no controls. */
  | { readonly kind: 'gap' }
  | {
      readonly kind: 'leg';
      readonly mode: TrackPointsLegMode;
      readonly pending: boolean;
    };

/** Inclusive anchor indexes with `first <= last`, grown from `anchor` by Shift. */
export interface TrackPointsSelection {
  readonly first: number;
  readonly last: number;
  /** The point a Shift+click extends from, in the list or on the map. */
  readonly anchor: number;
}

export interface TrackPointsInsertion {
  /** -1 = before the first anchor; anchors.length - 1 = after the last. */
  readonly afterIndex: number;
  readonly mode: TrackPointsLegMode;
}

export interface TrackPointsSectionProps {
  readonly variant: 'plan' | 'track';
  /** Track variant: point-edit mode is on. Plan variant: always true. */
  readonly editing: boolean;
  readonly anchors: readonly TrackPointsAnchorView[];
  /** Length `max(0, anchors.length - 1)`; leg `k` joins anchors `k` and `k + 1`. */
  readonly legs: readonly TrackPointsLegView[];
  readonly insertion: TrackPointsInsertion | null;
  readonly movingIndex: number | null;
  readonly selection: TrackPointsSelection | null;
  /** Scroll this anchor into view; a new object per request (map-click selection). */
  readonly revealRequest: { readonly index: number } | null;
  /** Saving or otherwise locked: show state, disable edit controls. */
  readonly disabled: boolean;
  /** Track variant pencil; when omitted no pencil is shown (plan variant, read-only tracks). */
  readonly onStartEditing?: () => void;
  readonly onSelectionChange: (selection: TrackPointsSelection | null) => void;
  readonly onDeleteSelection: (selection: TrackPointsSelection) => void;
  readonly onMoveStart: (index: number) => void;
  readonly onMoveCancel: () => void;
  readonly onInsertionStart: (afterIndex: number) => void;
  readonly onInsertionModeChange: (mode: TrackPointsLegMode) => void;
  readonly onInsertionEnd: () => void;
  readonly onLegModeChange: (legIndex: number, mode: TrackPointsLegMode) => void;
}

const POINT_ROW_HEIGHT = 40;
const LEG_ROW_HEIGHT = 32;
const INSERTION_ROW_HEIGHT = 72;
const MAX_LIST_HEIGHT = 420;
const OVERSCAN_PX = 240;
/** The rendered window moves in steps, so scrolling mounts rows only every few rows. */
const WINDOW_STEP_ROWS = 8;
const AUTO_SCROLL_EDGE_PX = 32;
const AUTO_SCROLL_MAX_STEP_PX = 18;
const DOT_COLUMN_WIDTH = 28;
const CONNECTOR_WIDTH = 4;

/* eslint-disable lingui/no-unlocalized-strings -- CSS class names. */
/** Hidden until row hover or focus on fine pointers; always shown on touch screens. */
const REVEAL_CLASS = 'TrackPoints-reveal';
const classes = {
  row: 'TrackPoints-row',
  point: 'TrackPoints-point',
  pointButton: 'TrackPoints-pointButton',
  dotColumn: 'TrackPoints-dotColumn',
  dot: 'TrackPoints-dot',
  number: 'TrackPoints-number',
  distance: 'TrackPoints-distance',
  elevation: 'TrackPoints-elevation',
  connector: 'TrackPoints-connector',
  pending: 'TrackPoints-pending',
  routed: 'TrackPoints-routed',
} as const;
/* eslint-enable lingui/no-unlocalized-strings */

const pathColor = mapVisualPalette.userGeometry.gpxTrack;
/** Legs that follow trails, so routed stretches stand out from straight lines. */
const routedPathColor = mapVisualPalette.userGeometry.gpxTrackHighlight;
const pendingPulse = keyframes`
  from { opacity: 0.25; }
  to { opacity: 0.7; }
`;

/**
 * While editing, rows alternate between anchors and the legs joining them, and the list
 * starts and ends with an add stub: `2n + 1` rows. Read-only lists show the points only.
 * Every row has a fixed height, which lets the list window rows with arithmetic instead
 * of measuring the DOM.
 */
interface RowLayout {
  readonly editing: boolean;
  readonly rowCount: number;
  /** The add stub or leg row replaced by the taller insertion row. */
  readonly insertionRow: number | null;
}

function createRowLayout(
  editing: boolean,
  anchorCount: number,
  insertion: TrackPointsInsertion | null,
): RowLayout {
  const rowCount = editing ? 2 * anchorCount + 1 : anchorCount;
  const insertionRow =
    editing &&
    insertion !== null &&
    insertion.afterIndex >= -1 &&
    insertion.afterIndex <= anchorCount - 1
      ? 2 * insertion.afterIndex + 2
      : null;
  return { editing, rowCount, insertionRow };
}

function rowOffset(layout: RowLayout, row: number): number {
  if (!layout.editing) return row * POINT_ROW_HEIGHT;
  const pointsBefore = Math.floor(row / 2);
  const legsBefore = row - pointsBefore;
  const insertionExtra =
    layout.insertionRow !== null && layout.insertionRow < row
      ? INSERTION_ROW_HEIGHT - LEG_ROW_HEIGHT
      : 0;
  return pointsBefore * POINT_ROW_HEIGHT + legsBefore * LEG_ROW_HEIGHT + insertionExtra;
}

/** Last row starting at or above `offset`. */
function rowAtOffset(layout: RowLayout, offset: number): number {
  let low = 0;
  let high = Math.max(0, layout.rowCount - 1);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (rowOffset(layout, middle) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

function pointRow(layout: RowLayout, index: number): number {
  return layout.editing ? 2 * index + 1 : index;
}

/** Keeps a visible anchor in place and centers a hidden one. */
function revealScrollTop(
  layout: RowLayout,
  index: number,
  scrollTop: number,
  viewportHeight: number,
): number {
  const top = rowOffset(layout, pointRow(layout, index));
  const bottom = top + POINT_ROW_HEIGHT;
  if (top >= scrollTop && bottom <= scrollTop + viewportHeight) return scrollTop;
  const maximum = Math.max(0, rowOffset(layout, layout.rowCount) - viewportHeight);
  const centered = top - (viewportHeight - POINT_ROW_HEIGHT) / 2;
  return Math.min(maximum, Math.max(0, centered));
}

function selectionRange(anchor: number, to: number): TrackPointsSelection {
  return { first: Math.min(anchor, to), last: Math.max(anchor, to), anchor };
}

function closestPointIndex(element: Element | null): number | null {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM selector.
  const row = element?.closest<HTMLElement>('[data-point-index]');
  if (row === null || row === undefined) return null;
  return Number(row.dataset.pointIndex);
}

interface DragSelection {
  readonly pointerId: number;
  readonly anchor: number;
  current: TrackPointsSelection;
  clientX: number;
  clientY: number;
}

/** Row callbacks with a stable identity, so memoized rows skip unchanged renders. */
interface RowActions {
  readonly select: (index: number, extend: boolean) => void;
  readonly moveStart: (index: number) => void;
  readonly moveCancel: () => void;
  readonly deletePoint: (index: number) => void;
  readonly insertionStart: (afterIndex: number) => void;
  readonly legModeChange: (legIndex: number, mode: TrackPointsLegMode) => void;
}

/** A track-styled line half or whole across a leg row; orange where it follows trails. */
function LegConnector({
  routed,
  pending,
  toPrevious,
  toNext,
}: {
  readonly routed: boolean;
  readonly pending: boolean;
  /** Add stubs draw only the half that touches their neighbouring point. */
  readonly toPrevious: boolean;
  readonly toNext: boolean;
}): ReactElement {
  let className: string = classes.connector;
  if (routed) className += ` ${classes.routed}`;
  if (pending) className += ` ${classes.pending}`;
  return (
    <span
      aria-hidden
      className={className}
      style={{ top: toPrevious ? 0 : '50%', bottom: toNext ? 0 : '50%' }}
    />
  );
}

function LegModeToggle({
  label,
  mode,
  disabled,
  reveal,
  onChange,
}: {
  readonly label: string;
  readonly mode: TrackPointsLegMode;
  readonly disabled: boolean;
  readonly reveal: boolean;
  readonly onChange: (mode: TrackPointsLegMode) => void;
}): ReactElement {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      aria-label={label}
      className={reveal ? REVEAL_CLASS : undefined}
      value={mode}
      onChange={(_event, value: TrackPointsLegMode | null) => {
        if (value !== null) onChange(value);
      }}
      sx={{ '& .MuiToggleButton-root': { height: 24, px: 1, py: 0, fontSize: 12 } }}
    >
      <ToggleButton value="routes" disabled={disabled}>
        <Trans>Routes</Trans>
      </ToggleButton>
      <ToggleButton value="line" disabled={disabled}>
        <Trans>Line</Trans>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

const AddButton = memo(function AddButton({
  afterIndex,
  label,
  disabled,
  actions,
}: {
  readonly afterIndex: number;
  readonly label: string;
  readonly disabled: boolean;
  readonly actions: RowActions;
}): ReactElement {
  return (
    <Button
      className={REVEAL_CLASS}
      size="small"
      startIcon={<AddIcon />}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        actions.insertionStart(afterIndex);
      }}
      sx={{ minHeight: 24, py: 0 }}
    >
      <Trans>Add</Trans>
    </Button>
  );
});

const PointRow = memo(function PointRow({
  index,
  top,
  number,
  distance,
  elevation,
  selected,
  moving,
  editing,
  disabled,
  actions,
}: {
  readonly index: number;
  readonly top: number;
  readonly number: string;
  readonly distance: string;
  readonly elevation: string;
  readonly selected: boolean;
  readonly moving: boolean;
  readonly editing: boolean;
  readonly disabled: boolean;
  readonly actions: RowActions;
}): ReactElement {
  const { t } = useLingui();
  // Only the rows entering and leaving the hover re-render on a pointer move.
  const hovered = useStore(trackPointHoverStore, (state) => state.index === index);
  const moveLabel = t`Move point ${number}`;
  const deleteLabel = t`Delete point ${number}`;
  return (
    <div
      role="listitem"
      className={`${classes.row} ${classes.point}`}
      data-point-index={index}
      data-selected={selected}
      data-hovered={hovered}
      style={{ top, height: POINT_ROW_HEIGHT }}
      onPointerEnter={() => {
        setHoveredTrackPoint(index, 'list');
      }}
      onPointerLeave={() => {
        setHoveredTrackPoint(null, 'list');
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={t`Point ${number}, ${distance}, ${elevation}`}
        className={classes.pointButton}
        onClick={() => {
          actions.select(index, false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          actions.select(index, event.shiftKey);
        }}
      >
        <span aria-hidden className={classes.dotColumn}>
          <span className={classes.dot} />
        </span>
        <span aria-hidden className={classes.number}>
          {number}
        </span>
        {moving ? null : (
          <>
            <span aria-hidden className={classes.distance}>
              {distance}
            </span>
            <span aria-hidden className={classes.elevation}>
              {elevation}
            </span>
          </>
        )}
      </div>
      {moving ? (
        <>
          <Typography
            role="status"
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ flex: 1, minWidth: 0 }}
          >
            <Trans>Click the map to move point {number}</Trans>
          </Typography>
          <Button size="small" onClick={actions.moveCancel}>
            <Trans>Cancel</Trans>
          </Button>
        </>
      ) : null}
      {editing && !moving ? (
        <Stack className={REVEAL_CLASS} direction="row" spacing={0.25}>
          <IconButton
            size="small"
            title={moveLabel}
            aria-label={moveLabel}
            disabled={disabled}
            onClick={() => {
              actions.moveStart(index);
            }}
          >
            <OpenWithIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            title={deleteLabel}
            aria-label={deleteLabel}
            disabled={disabled}
            onClick={() => {
              actions.deletePoint(index);
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
      ) : null}
    </div>
  );
});

const LegRow = memo(function LegRow({
  legIndex,
  top,
  leg,
  fromNumber,
  toNumber,
  selected,
  revealToggle,
  disabled,
  addLabel,
  actions,
}: {
  readonly legIndex: number;
  readonly top: number;
  readonly leg: TrackPointsLegView;
  readonly fromNumber: string;
  readonly toNumber: string;
  readonly selected: boolean;
  readonly revealToggle: boolean;
  readonly disabled: boolean;
  readonly addLabel: string;
  readonly actions: RowActions;
}): ReactElement {
  const { t } = useLingui();
  return (
    <div
      role="listitem"
      className={classes.row}
      data-selected={selected}
      style={{ top, height: LEG_ROW_HEIGHT }}
    >
      {leg.kind === 'gap' ? (
        <Typography variant="caption" color="text.secondary" noWrap>
          <Trans>Separate segment</Trans>
        </Typography>
      ) : (
        <>
          <LegConnector
            routed={leg.mode === 'routes'}
            pending={leg.pending}
            toPrevious
            toNext
          />
          <LegModeToggle
            label={t`Segment between points ${fromNumber} and ${toNumber}`}
            mode={leg.mode}
            disabled={disabled}
            reveal={revealToggle}
            onChange={(mode) => {
              actions.legModeChange(legIndex, mode);
            }}
          />
          <AddButton
            afterIndex={legIndex}
            label={addLabel}
            disabled={disabled}
            actions={actions}
          />
        </>
      )}
    </div>
  );
});

export function TrackPointsSection(props: TrackPointsSectionProps): ReactElement {
  const {
    variant,
    editing,
    anchors,
    legs,
    insertion,
    movingIndex,
    selection,
    revealRequest,
    disabled,
    onStartEditing,
    onSelectionChange,
    onDeleteSelection,
    onInsertionModeChange,
    onInsertionEnd,
  } = props;
  const { i18n, t } = useLingui();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const detailsId = `track-points-${useId().replaceAll(':', '')}`;
  const [expanded, setExpanded] = useState(editing);
  const [observedEditing, setObservedEditing] = useState(editing);
  const [observedReveal, setObservedReveal] = useState(revealRequest);
  const [scrollTop, setScrollTop] = useState(0);
  /** Height the list grows to below the pane's other sections; 0 until measured. */
  const [measuredHeight, setMeasuredHeight] = useState(0);
  /** Scroll position the viewport must adopt after the next commit. */
  const [scrollCommand, setScrollCommand] = useState<{ readonly top: number } | null>(
    null,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSelection | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  /** A mouse or pen press already selected; the click that follows must not repeat it. */
  const pointerSelectedRef = useRef(false);
  const latestProps = useRef(props);
  useLayoutEffect(() => {
    latestProps.current = props;
  });
  const actions = useMemo<RowActions>(
    () => ({
      select: (index, extend) => {
        if (pointerSelectedRef.current) return;
        const current = latestProps.current;
        const anchor = current.selection?.anchor;
        current.onSelectionChange(
          extend && anchor !== undefined && anchor < current.anchors.length
            ? selectionRange(anchor, index)
            : selectionRange(index, index),
        );
      },
      moveStart: (index) => {
        latestProps.current.onMoveStart(index);
      },
      moveCancel: () => {
        latestProps.current.onMoveCancel();
      },
      deletePoint: (index) => {
        latestProps.current.onDeleteSelection(selectionRange(index, index));
      },
      insertionStart: (afterIndex) => {
        latestProps.current.onInsertionStart(afterIndex);
      },
      legModeChange: (legIndex, mode) => {
        latestProps.current.onLegModeChange(legIndex, mode);
      },
    }),
    [],
  );

  const anchorCount = anchors.length;
  const layout = createRowLayout(editing, anchorCount, insertion);
  const totalHeight = rowOffset(layout, layout.rowCount);
  const minimumViewportHeight = Math.min(totalHeight, MAX_LIST_HEIGHT);
  const viewportHeight = Math.min(
    totalHeight,
    Math.max(minimumViewportHeight, measuredHeight),
  );

  if (editing !== observedEditing) {
    setObservedEditing(editing);
    if (editing) setExpanded(true);
  }
  if (revealRequest !== observedReveal) {
    setObservedReveal(revealRequest);
    if (
      revealRequest !== null &&
      revealRequest.index >= 0 &&
      revealRequest.index < anchorCount
    ) {
      const top = revealScrollTop(
        layout,
        revealRequest.index,
        scrollTop,
        viewportHeight,
      );
      setExpanded(true);
      setScrollTop(top);
      setScrollCommand({ top });
    }
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (scrollCommand !== null && viewport !== null)
      viewport.scrollTop = scrollCommand.top;
  }, [scrollCommand]);

  useEffect(() => {
    const frames = autoScrollFrameRef;
    return () => {
      if (frames.current !== null) cancelAnimationFrame(frames.current);
    };
  }, []);

  const open = variant === 'plan' || expanded;
  const hasRows = layout.rowCount > 0;
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!open || !hasRows || viewport === null || !('ResizeObserver' in globalThis)) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setMeasuredHeight(entry.contentRect.height);
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, [hasRows, open]);
  const numberFormat = new Intl.NumberFormat(i18n.locale);
  const pointNumber = (index: number): string => numberFormat.format(index + 1);

  const updateDragSelection = (viewport: HTMLDivElement, drag: DragSelection) => {
    const bounds = viewport.getBoundingClientRect();
    const clientX = Math.min(Math.max(drag.clientX, bounds.left + 1), bounds.right - 1);
    const clientY = Math.min(Math.max(drag.clientY, bounds.top + 1), bounds.bottom - 1);
    const index = closestPointIndex(
      viewport.ownerDocument.elementFromPoint(clientX, clientY),
    );
    if (index === null) return;
    const next = selectionRange(drag.anchor, index);
    if (next.first === drag.current.first && next.last === drag.current.last) return;
    drag.current = next;
    onSelectionChange(next);
  };

  const autoScrollStep = (viewport: HTMLDivElement, drag: DragSelection): number => {
    const bounds = viewport.getBoundingClientRect();
    const intoTop = bounds.top + AUTO_SCROLL_EDGE_PX - drag.clientY;
    const intoBottom = drag.clientY - (bounds.bottom - AUTO_SCROLL_EDGE_PX);
    const depth = Math.max(intoTop, intoBottom);
    if (depth <= 0) return 0;
    const step = Math.ceil(
      Math.min(1, depth / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP_PX,
    );
    return intoTop > 0 ? -step : step;
  };

  const runAutoScroll = () => {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    const step =
      viewport === null || drag === null ? 0 : autoScrollStep(viewport, drag);
    if (viewport === null || drag === null || step === 0) {
      autoScrollFrameRef.current = null;
      return;
    }
    viewport.scrollTop += step;
    updateDragSelection(viewport, drag);
    autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
  };

  const stopDrag = (viewport: HTMLDivElement, pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) return;
    dragRef.current = null;
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    if (viewport.hasPointerCapture(pointerId))
      viewport.releasePointerCapture(pointerId);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerSelectedRef.current = false;
    if (event.button !== 0) return;
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const target = event.target instanceof Element ? event.target : null;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM selector.
    if (target?.closest('button') !== null) return;
    const index = closestPointIndex(target);
    if (index === null) return;
    pointerSelectedRef.current = true;
    const previousAnchor = selection?.anchor;
    const anchor =
      event.shiftKey && previousAnchor !== undefined && previousAnchor < anchorCount
        ? previousAnchor
        : index;
    const current = selectionRange(anchor, index);
    onSelectionChange(current);
    dragRef.current = {
      pointerId: event.pointerId,
      anchor,
      current,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    updateDragSelection(event.currentTarget, drag);
    if (
      autoScrollFrameRef.current === null &&
      autoScrollStep(event.currentTarget, drag) !== 0
    ) {
      autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && selection !== null) {
      event.stopPropagation();
      onSelectionChange(null);
      return;
    }
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      editing &&
      !disabled &&
      selection !== null
    ) {
      event.preventDefault();
      onDeleteSelection(selection);
    }
  };

  const isSelected = (index: number): boolean =>
    selection !== null && index >= selection.first && index <= selection.last;

  /** `afterIndex` follows the insertion contract: -1 before the first point. */
  const addButtonLabel = (afterIndex: number): string => {
    if (anchorCount === 0) return t`Add points`;
    if (afterIndex === -1) return t`Add points before point ${pointNumber(0)}`;
    if (afterIndex === anchorCount - 1) {
      return t`Add points after point ${pointNumber(afterIndex)}`;
    }
    const from = pointNumber(afterIndex);
    const to = pointNumber(afterIndex + 1);
    return t`Add points between points ${from} and ${to}`;
  };

  const renderPointRow = (index: number, top: number): ReactElement | null => {
    const anchor = anchors[index];
    if (anchor === undefined) return null;
    return (
      <PointRow
        key={`point-${String(anchor.key)}`}
        index={index}
        top={top}
        number={pointNumber(index)}
        distance={formatTrackDistance(anchor.distanceMeters, i18n)}
        elevation={
          anchor.elevationMeters === null
            ? '—'
            : formatTrackElevation(anchor.elevationMeters, i18n)
        }
        selected={isSelected(index)}
        moving={movingIndex === index}
        editing={editing}
        disabled={disabled}
        actions={actions}
      />
    );
  };

  const renderInsertionRow = (
    activeInsertion: TrackPointsInsertion,
    top: number,
  ): ReactElement => {
    const { afterIndex } = activeInsertion;
    const showDone = !(variant === 'plan' && afterIndex === anchorCount - 1);
    return (
      <div
        key="insertion"
        role="listitem"
        className={classes.row}
        style={{ top, height: INSERTION_ROW_HEIGHT, display: 'block' }}
      >
        {anchorCount === 0 ? null : (
          <LegConnector
            routed={activeInsertion.mode === 'routes'}
            pending={false}
            toPrevious={afterIndex >= 0}
            toNext={afterIndex < anchorCount - 1}
          />
        )}
        <Stack spacing={0.5} sx={{ py: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <LegModeToggle
              label={t`New points mode`}
              mode={activeInsertion.mode}
              disabled={disabled}
              reveal={false}
              onChange={onInsertionModeChange}
            />
            <Box sx={{ flex: 1 }} />
            {showDone ? (
              <Button size="small" variant="outlined" onClick={onInsertionEnd}>
                <Trans>Done</Trans>
              </Button>
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap>
            <Trans>Click the map to add points</Trans>
          </Typography>
        </Stack>
      </div>
    );
  };

  const renderStubRow = (afterIndex: number, top: number): ReactElement => (
    <div
      key={afterIndex === -1 ? 'stub-before' : 'stub-after'}
      role="listitem"
      className={classes.row}
      style={{ top, height: LEG_ROW_HEIGHT }}
    >
      {anchorCount === 0 ? null : (
        <LegConnector
          routed={false}
          pending={false}
          toPrevious={afterIndex >= 0}
          toNext={afterIndex < anchorCount - 1}
        />
      )}
      <AddButton
        afterIndex={afterIndex}
        label={addButtonLabel(afterIndex)}
        disabled={disabled}
        actions={actions}
      />
    </div>
  );

  const renderLegRow = (legIndex: number, top: number): ReactElement | null => {
    const leg = legs[legIndex];
    const from = anchors[legIndex];
    if (leg === undefined || from === undefined) return null;
    return (
      <LegRow
        key={`leg-${String(from.key)}`}
        legIndex={legIndex}
        top={top}
        leg={leg}
        fromNumber={pointNumber(legIndex)}
        toNumber={pointNumber(legIndex + 1)}
        selected={isSelected(legIndex) && isSelected(legIndex + 1)}
        revealToggle={variant === 'track'}
        disabled={disabled}
        addLabel={addButtonLabel(legIndex)}
        actions={actions}
      />
    );
  };

  const renderRow = (row: number, top: number): ReactElement | null => {
    if (!editing) return renderPointRow(row, top);
    if (row % 2 === 1) return renderPointRow((row - 1) / 2, top);
    if (row === layout.insertionRow && insertion !== null) {
      return renderInsertionRow(insertion, top);
    }
    const afterIndex = row / 2 - 1;
    if (afterIndex === -1 || afterIndex === anchorCount - 1) {
      return renderStubRow(afterIndex, top);
    }
    return renderLegRow(afterIndex, top);
  };

  const rows: ReactElement[] = [];
  if (open && layout.rowCount > 0) {
    const visibleTop = Math.max(0, Math.min(scrollTop, totalHeight - viewportHeight));
    const firstRow = rowAtOffset(layout, Math.max(0, visibleTop - OVERSCAN_PX));
    const windowStart = firstRow - (firstRow % WINDOW_STEP_ROWS);
    const windowBottom =
      rowOffset(layout, windowStart) +
      viewportHeight +
      2 * OVERSCAN_PX +
      WINDOW_STEP_ROWS * POINT_ROW_HEIGHT;
    for (
      let row = windowStart;
      row < layout.rowCount && rowOffset(layout, row) < windowBottom;
      row += 1
    ) {
      const element = renderRow(row, rowOffset(layout, row));
      if (element !== null) rows.push(element);
    }
  }

  const selectedCount = selection === null ? 0 : selection.last - selection.first + 1;
  const countLabel = numberFormat.format(anchorCount);
  const heading = (
    <Typography component="h3" variant="subtitle2">
      <Trans>Points ({countLabel})</Trans>
    </Typography>
  );

  return (
    // Grows into the free pane height so a long list does not end above empty space.
    <Box
      component="section"
      sx={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column' }}
    >
      <Box
        sx={{
          minHeight: 44,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'center',
          columnGap: 0.5,
        }}
      >
        {variant === 'plan' ? (
          <Box sx={{ px: 1 }}>{heading}</Box>
        ) : (
          <ButtonBase
            aria-label={t`Points`}
            aria-controls={detailsId}
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((current) => !current);
              setScrollTop(0);
            }}
            sx={{
              minWidth: 0,
              minHeight: 44,
              justifyContent: 'space-between',
              px: 1,
              textAlign: 'left',
            }}
          >
            {heading}
            <ExpandMoreIcon
              aria-hidden
              fontSize="small"
              sx={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: (theme) =>
                  theme.transitions.create('transform', {
                    duration: theme.transitions.duration.shortest,
                  }),
              }}
            />
          </ButtonBase>
        )}
        {variant === 'track' && !editing && onStartEditing !== undefined ? (
          <Tooltip title={t`Edit points`}>
            <span>
              <IconButton
                size="small"
                aria-label={t`Edit points`}
                disabled={disabled}
                onClick={onStartEditing}
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Box>
      {open ? (
        <Box
          id={detailsId}
          sx={{ px: 1, flex: '1 0 auto', display: 'flex', flexDirection: 'column' }}
          onKeyDown={handleListKeyDown}
        >
          {selection === null ? null : (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', minHeight: 36, mb: 0.5 }}
            >
              <Typography role="status" variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                {t`${plural(selectedCount, {
                  one: '# point selected',
                  other: '# points selected',
                })}`}
              </Typography>
              {editing ? (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  disabled={disabled}
                  onClick={() => {
                    onDeleteSelection(selection);
                  }}
                >
                  <Trans>Delete</Trans>
                </Button>
              ) : null}
              <Tooltip title={t`Clear selection`}>
                <IconButton
                  size="small"
                  aria-label={t`Clear selection`}
                  onClick={() => {
                    onSelectionChange(null);
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
          {layout.rowCount === 0 ? (
            <Typography variant="caption" color="text.secondary">
              <Trans>No points in this track.</Trans>
            </Typography>
          ) : (
            <Box
              ref={viewportRef}
              onScroll={(event) => {
                setScrollTop(event.currentTarget.scrollTop);
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => {
                stopDrag(event.currentTarget, event.pointerId);
              }}
              onPointerCancel={(event) => {
                stopDrag(event.currentTarget, event.pointerId);
              }}
              onLostPointerCapture={(event) => {
                stopDrag(event.currentTarget, event.pointerId);
              }}
              onClick={() => {
                pointerSelectedRef.current = false;
              }}
              style={{
                flex: '1 1 0',
                minHeight: minimumViewportHeight,
                maxHeight: totalHeight,
              }}
              sx={(theme) => ({
                position: 'relative',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                userSelect: 'none',
                ...theme.typography.body2,
                [`& .${classes.row}`]: {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  columnGap: theme.spacing(0.5),
                  pl: `${String(DOT_COLUMN_WIDTH)}px`,
                  pr: 0.5,
                },
                [`& .${classes.point}`]: { pl: 0 },
                [`& .${classes.pointButton}`]: {
                  flex: '1 1 auto',
                  minWidth: 0,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  columnGap: theme.spacing(1),
                  pr: 1,
                  cursor: 'pointer',
                  borderRadius: `${String(theme.shape.borderRadius)}px`,
                  outline: 'none',
                  '&:focus-visible': {
                    boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
                  },
                },
                [`& .${classes.dotColumn}`]: {
                  width: DOT_COLUMN_WIDTH,
                  flex: '0 0 auto',
                  display: 'flex',
                  justifyContent: 'center',
                },
                [`& .${classes.dot}`]: {
                  width: 16,
                  height: 16,
                  boxSizing: 'border-box',
                  borderRadius: '50%',
                  border: `2px solid ${theme.palette.common.white}`,
                  bgcolor: pathColor,
                  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.24)',
                },
                [`& .${classes.number}`]: {
                  minWidth: '5ch',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                },
                [`& .${classes.distance}`]: {
                  minWidth: '8ch',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                },
                [`& .${classes.elevation}`]: {
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  color: theme.palette.text.secondary,
                  fontVariantNumeric: 'tabular-nums',
                },
                // The leg line matches the map track: solid blue, white casing, soft shadow.
                [`& .${classes.connector}`]: {
                  position: 'absolute',
                  left: (DOT_COLUMN_WIDTH - CONNECTOR_WIDTH) / 2,
                  width: CONNECTOR_WIDTH,
                  bgcolor: pathColor,
                  boxShadow: `0 0 0 1.5px ${theme.palette.common.white}, 0 1px 3px 1.5px rgba(0, 0, 0, 0.25)`,
                },
                [`& .${classes.routed}`]: { bgcolor: routedPathColor },
                [`& .${classes.pending}`]: {
                  animation: `${pendingPulse} 900ms ease-in-out infinite alternate`,
                  '@media (prefers-reduced-motion: reduce)': {
                    animation: 'none',
                    opacity: 0.4,
                  },
                },
                [`& .${REVEAL_CLASS}`]: {
                  transition: theme.transitions.create('opacity', {
                    duration: theme.transitions.duration.shortest,
                  }),
                },
                '@media (hover: hover) and (pointer: fine)': {
                  [`& .${REVEAL_CLASS}`]: { opacity: 0, pointerEvents: 'none' },
                  [`& [role="listitem"]:hover .${REVEAL_CLASS}, & [role="listitem"]:focus-within .${REVEAL_CLASS}`]:
                    { opacity: 1, pointerEvents: 'auto' },
                },
                // List, map, and profile share one hovered point.
                '& [data-hovered="true"]': { bgcolor: 'action.hover' },
                '& [data-selected="true"], & [data-selected="true"]:hover': {
                  bgcolor: 'action.selected',
                },
              })}
            >
              <Box
                role="list"
                aria-label={t`Track points`}
                style={{ height: totalHeight }}
                sx={{ position: 'relative' }}
              >
                {rows}
              </Box>
            </Box>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
