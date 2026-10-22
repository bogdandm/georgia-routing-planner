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
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';

import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';
import {
  formatTrackDistance,
  formatTrackElevation,
} from '@/presentation/tracks/trackFormatters';

export type TrackPointsLegMode = 'routes' | 'line';

export interface TrackPointsAnchorView {
  /** Stable anchor id used as the React key. */
  readonly key: number;
  /** Cumulative distance along the path. */
  readonly distanceMeters: number;
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

/** Inclusive anchor indexes with `first <= last`. */
export interface TrackPointsSelection {
  readonly first: number;
  readonly last: number;
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
const AUTO_SCROLL_EDGE_PX = 32;
const AUTO_SCROLL_MAX_STEP_PX = 18;
const DOT_COLUMN_WIDTH = 28;
const CONNECTOR_WIDTH = 3;
/** Hidden until row hover or focus on fine pointers; always shown on touch screens. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS class name.
const REVEAL_CLASS = 'TrackPoints-reveal';

const pathColor = mapVisualPalette.userGeometry.gpxTrack;
const pendingPulse = keyframes`
  from { opacity: 0.2; }
  to { opacity: 0.6; }
`;

/**
 * Rows alternate between anchors and the legs joining them. While editing, the list
 * also starts and ends with an add stub, so the row count is `2n + 1`; read-only lists
 * have `2n - 1` rows. Every row has a fixed height, which lets the list window rows
 * with arithmetic instead of measuring the DOM.
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
  const rowCount = editing ? 2 * anchorCount + 1 : Math.max(0, 2 * anchorCount - 1);
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
  const pointsBefore = layout.editing ? Math.floor(row / 2) : Math.ceil(row / 2);
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
  let high = layout.rowCount - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (rowOffset(layout, middle) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Keeps a visible anchor in place and centers a hidden one. */
function revealScrollTop(
  layout: RowLayout,
  index: number,
  scrollTop: number,
  viewportHeight: number,
): number {
  const top = rowOffset(layout, layout.editing ? 2 * index + 1 : 2 * index);
  const bottom = top + POINT_ROW_HEIGHT;
  if (top >= scrollTop && bottom <= scrollTop + viewportHeight) return scrollTop;
  const maximum = Math.max(0, rowOffset(layout, layout.rowCount) - viewportHeight);
  const centered = top - (viewportHeight - POINT_ROW_HEIGHT) / 2;
  return Math.min(maximum, Math.max(0, centered));
}

function selectionRange(from: number, to: number): TrackPointsSelection {
  return { first: Math.min(from, to), last: Math.max(from, to) };
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

function LegConnector({
  mode,
  pending,
  toPrevious,
  toNext,
}: {
  readonly mode: TrackPointsLegMode;
  readonly pending: boolean;
  /** Add stubs draw only the half that touches their neighbouring point. */
  readonly toPrevious: boolean;
  readonly toNext: boolean;
}): ReactElement {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        left: (DOT_COLUMN_WIDTH - CONNECTOR_WIDTH) / 2,
        top: toPrevious ? 0 : '50%',
        bottom: toNext ? 0 : '50%',
        borderLeftWidth: CONNECTOR_WIDTH,
        borderLeftStyle: mode === 'routes' ? 'solid' : 'dashed',
        borderLeftColor: pathColor,
        opacity: pending ? 0.4 : 1,
        animation: pending
          ? `${pendingPulse} 900ms ease-in-out infinite alternate`
          : 'none',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
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

const rowSx = {
  position: 'absolute',
  left: 0,
  right: 0,
  display: 'flex',
  alignItems: 'center',
  columnGap: 0.5,
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS length.
  pl: `${String(DOT_COLUMN_WIDTH)}px`,
  pr: 0.5,
} as const;

export function TrackPointsSection({
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
  onMoveStart,
  onMoveCancel,
  onInsertionStart,
  onInsertionModeChange,
  onInsertionEnd,
  onLegModeChange,
}: TrackPointsSectionProps): ReactElement {
  const { i18n, t } = useLingui();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const detailsId = `track-points-${useId().replaceAll(':', '')}`;
  const [expanded, setExpanded] = useState(editing);
  const [observedEditing, setObservedEditing] = useState(editing);
  const [observedReveal, setObservedReveal] = useState(revealRequest);
  const [scrollTop, setScrollTop] = useState(0);
  /** Scroll position the viewport must adopt after the next commit. */
  const [scrollCommand, setScrollCommand] = useState<{ readonly top: number } | null>(
    null,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const dragRef = useRef<DragSelection | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  /** A mouse or pen press already selected; the click that follows must not repeat it. */
  const pointerSelectedRef = useRef(false);

  const anchorCount = anchors.length;
  const layout = createRowLayout(editing, anchorCount, insertion);
  const totalHeight = rowOffset(layout, layout.rowCount);
  const viewportHeight = Math.min(totalHeight, MAX_LIST_HEIGHT);

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
  const numberFormat = new Intl.NumberFormat(i18n.locale);
  const pointNumber = (index: number): string => numberFormat.format(index + 1);

  const selectPoint = (index: number, extend: boolean) => {
    const anchor = selectionAnchorRef.current;
    if (extend && anchor !== null && anchor < anchorCount) {
      onSelectionChange(selectionRange(anchor, index));
      return;
    }
    selectionAnchorRef.current = index;
    onSelectionChange({ first: index, last: index });
  };

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
    const previousAnchor = selectionAnchorRef.current;
    const anchor =
      event.shiftKey && previousAnchor !== null && previousAnchor < anchorCount
        ? previousAnchor
        : index;
    selectionAnchorRef.current = anchor;
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

  const renderPointRow = (index: number, top: number): ReactElement | null => {
    const anchor = anchors[index];
    if (anchor === undefined) return null;
    const number = pointNumber(index);
    const distance = formatTrackDistance(anchor.distanceMeters, i18n);
    const elevation =
      anchor.elevationMeters === null
        ? '—'
        : formatTrackElevation(anchor.elevationMeters, i18n);
    const moving = movingIndex === index;
    const selected = isSelected(index);
    return (
      <Box
        key={`point-${String(anchor.key)}`}
        role="listitem"
        data-point-index={index}
        data-selected={selected}
        style={{ top, height: POINT_ROW_HEIGHT }}
        sx={{ ...rowSx, pl: 0 }}
      >
        <Box
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-label={t`Point ${number}, ${distance}, ${elevation}`}
          onClick={() => {
            if (!pointerSelectedRef.current) selectPoint(index, false);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            selectPoint(index, event.shiftKey);
          }}
          sx={{
            flex: moving ? '0 0 auto' : '1 1 auto',
            minWidth: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            columnGap: 1,
            pr: 1,
            cursor: 'pointer',
            borderRadius: 1,
            outline: 'none',
            '&:focus-visible': {
              boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
            },
          }}
        >
          <Box
            aria-hidden
            sx={{
              width: DOT_COLUMN_WIDTH,
              flex: '0 0 auto',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <Box
              sx={{
                width: 16,
                height: 16,
                boxSizing: 'border-box',
                borderRadius: '50%',
                border: '2px solid',
                borderColor: 'common.white',
                bgcolor: pathColor,
                boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.24)',
              }}
            />
          </Box>
          <Typography
            aria-hidden
            variant="body2"
            sx={{
              minWidth: '6ch',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {number}
          </Typography>
          {moving ? null : (
            <>
              <Typography
                aria-hidden
                variant="body2"
                noWrap
                sx={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}
              >
                {distance}
              </Typography>
              <Typography
                aria-hidden
                variant="body2"
                color="text.secondary"
                noWrap
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {elevation}
              </Typography>
            </>
          )}
        </Box>
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
            <Button size="small" onClick={onMoveCancel}>
              <Trans>Cancel</Trans>
            </Button>
          </>
        ) : null}
        {editing && !moving ? (
          <Stack className={REVEAL_CLASS} direction="row" spacing={0.25}>
            <Tooltip title={t`Move point ${number}`}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t`Move point ${number}`}
                  disabled={disabled}
                  onClick={() => {
                    onMoveStart(index);
                  }}
                >
                  <OpenWithIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t`Delete point ${number}`}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t`Delete point ${number}`}
                  disabled={disabled}
                  onClick={() => {
                    onDeleteSelection({ first: index, last: index });
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        ) : null}
      </Box>
    );
  };

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

  const renderInsertionRow = (
    activeInsertion: TrackPointsInsertion,
    top: number,
  ): ReactElement => {
    const { afterIndex } = activeInsertion;
    const showDone = !(variant === 'plan' && afterIndex === anchorCount - 1);
    return (
      <Box
        key="insertion"
        role="listitem"
        style={{ top, height: INSERTION_ROW_HEIGHT }}
        sx={{ ...rowSx, display: 'block' }}
      >
        {anchorCount === 0 ? null : (
          <LegConnector
            mode={activeInsertion.mode}
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
      </Box>
    );
  };

  const renderAddButton = (afterIndex: number): ReactElement => (
    <Button
      className={REVEAL_CLASS}
      size="small"
      startIcon={<AddIcon />}
      aria-label={addButtonLabel(afterIndex)}
      disabled={disabled}
      onClick={() => {
        onInsertionStart(afterIndex);
      }}
      sx={{ minHeight: 24, py: 0 }}
    >
      <Trans>Add</Trans>
    </Button>
  );

  const renderStubRow = (afterIndex: number, top: number): ReactElement => {
    const connector =
      anchorCount === 0 ? null : (
        <LegConnector
          mode="routes"
          pending={false}
          toPrevious={afterIndex >= 0}
          toNext={afterIndex < anchorCount - 1}
        />
      );
    return (
      <Box
        key={afterIndex === -1 ? 'stub-before' : 'stub-after'}
        role="listitem"
        style={{ top, height: LEG_ROW_HEIGHT }}
        sx={rowSx}
      >
        {connector}
        {renderAddButton(afterIndex)}
      </Box>
    );
  };

  const renderLegRow = (legIndex: number, top: number): ReactElement | null => {
    const leg = legs[legIndex];
    const from = anchors[legIndex];
    if (leg === undefined || from === undefined) return null;
    const selected = isSelected(legIndex) && isSelected(legIndex + 1);
    const fromNumber = pointNumber(legIndex);
    const toNumber = pointNumber(legIndex + 1);
    return (
      <Box
        key={`leg-${String(from.key)}`}
        role="listitem"
        data-selected={selected}
        style={{ top, height: LEG_ROW_HEIGHT }}
        sx={rowSx}
      >
        {leg.kind === 'gap' ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            <Trans>Separate segment</Trans>
          </Typography>
        ) : (
          <>
            <LegConnector mode={leg.mode} pending={leg.pending} toPrevious toNext />
            {editing ? (
              <>
                <LegModeToggle
                  label={t`Segment between points ${fromNumber} and ${toNumber}`}
                  mode={leg.mode}
                  disabled={disabled}
                  reveal={variant === 'track'}
                  onChange={(mode) => {
                    onLegModeChange(legIndex, mode);
                  }}
                />
                {renderAddButton(legIndex)}
              </>
            ) : null}
          </>
        )}
      </Box>
    );
  };

  const renderRow = (row: number, top: number): ReactElement | null => {
    if (!editing) {
      return row % 2 === 0
        ? renderPointRow(row / 2, top)
        : renderLegRow((row - 1) / 2, top);
    }
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
    const visibleTop = Math.min(scrollTop, totalHeight - viewportHeight);
    const windowBottom = visibleTop + viewportHeight + OVERSCAN_PX;
    for (
      let row = rowAtOffset(layout, Math.max(0, visibleTop - OVERSCAN_PX));
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
    <Box component="section">
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
        <Box id={detailsId} sx={{ px: 1 }} onKeyDown={handleListKeyDown}>
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
              style={{ height: viewportHeight }}
              sx={{
                position: 'relative',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                userSelect: 'none',
                [`& .${REVEAL_CLASS}`]: {
                  transition: (theme) =>
                    theme.transitions.create('opacity', {
                      duration: theme.transitions.duration.shortest,
                    }),
                },
                '@media (hover: hover) and (pointer: fine)': {
                  [`& .${REVEAL_CLASS}`]: { opacity: 0, pointerEvents: 'none' },
                  [`& [role="listitem"]:hover .${REVEAL_CLASS}, & [role="listitem"]:focus-within .${REVEAL_CLASS}`]:
                    { opacity: 1, pointerEvents: 'auto' },
                  '& [data-point-index]:hover': { bgcolor: 'action.hover' },
                },
                '& [data-selected="true"], & [data-selected="true"]:hover': {
                  bgcolor: 'action.selected',
                },
              }}
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
