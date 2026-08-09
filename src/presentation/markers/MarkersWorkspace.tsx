import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import EditIcon from '@mui/icons-material/Edit';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PaletteIcon from '@mui/icons-material/Palette';
import SortIcon from '@mui/icons-material/Sort';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  ClickAwayListener,
  IconButton,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { useStore } from 'zustand';

import { geodesicDistanceKm } from '@/application/map/expandPlaceSearchBounds';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  SAVED_MARKER_SCHEMA_VERSION,
  normalizeSavedMarkerName,
  type MarkerSort,
  type NormalizedSavedMarkerName,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  consumeMarkerCreationCommand,
  mapInteractionStore,
  requestMapNavigation,
} from '@/presentation/map/mapInteractionStore';
import type { MapCoordinate } from '@/presentation/map/mapTypes';
import {
  markerColorFor,
  markerColorOrder,
  markerIconFor,
} from '@/presentation/markers/markerCatalog';
import { PinheadIcon } from '@/presentation/markers/PinheadIcon';
import {
  MarkerEditorDialog,
  type MarkerAppearance,
} from '@/presentation/markers/MarkerEditorDialog';
import { useUiStore } from '@/presentation/shell/uiStore';

type MarkerLoadState = 'loading' | 'ready' | 'failed';

type MarkerEditorDraft =
  | {
      readonly mode: 'create';
      readonly coordinate: MapCoordinate;
      readonly initialName: string;
    }
  | { readonly mode: 'appearance'; readonly marker: SavedMarker };

interface MarkersWorkspaceValue {
  readonly markers: readonly SavedMarker[];
  readonly sortedMarkers: readonly SavedMarker[];
  readonly loadState: MarkerLoadState;
  readonly loadError: string | null;
  readonly notice: string | null;
  readonly mapCenter: MapCoordinate | null;
  readonly retryLoad: () => Promise<void>;
  readonly openAppearanceEditor: (marker: SavedMarker) => void;
  readonly renameMarker: (marker: SavedMarker, name: string) => Promise<void>;
  readonly deleteMarker: (marker: SavedMarker) => Promise<void>;
}

const MarkersWorkspaceContext = createContext<MarkersWorkspaceValue | null>(null);

function sortMarkers(
  markers: readonly SavedMarker[],
  sort: MarkerSort,
  mapCenter: MapCoordinate | null,
): readonly SavedMarker[] {
  if (sort === 'created' || (sort === 'distance' && mapCenter === null)) {
    return [...markers].sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt, 'en');
      return byCreatedAt === 0 ? left.id.localeCompare(right.id, 'en') : byCreatedAt;
    });
  }
  if (sort === 'name') {
    return [...markers].sort((left, right) => {
      const byName = left.normalizedName.localeCompare(right.normalizedName, 'en');
      if (byName !== 0) return byName;
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt, 'en');
      return byCreatedAt === 0 ? left.id.localeCompare(right.id, 'en') : byCreatedAt;
    });
  }
  if (sort === 'color') {
    return [...markers].sort((left, right) => {
      const byColor =
        markerColorOrder[left.colorKey] - markerColorOrder[right.colorKey];
      if (byColor !== 0) return byColor;
      const byName = left.normalizedName.localeCompare(right.normalizedName, 'en');
      return byName === 0 ? left.id.localeCompare(right.id, 'en') : byName;
    });
  }
  if (mapCenter === null) return [...markers];
  return [...markers].sort((left, right) => {
    const leftDistance = geodesicDistanceKm(
      mapCenter.latitude,
      mapCenter.longitude,
      left.coordinate[1],
      left.coordinate[0],
    );
    const rightDistance = geodesicDistanceKm(
      mapCenter.latitude,
      mapCenter.longitude,
      right.coordinate[1],
      right.coordinate[0],
    );
    const byDistance = leftDistance - rightDistance;
    if (byDistance !== 0) return byDistance;
    const byName = left.normalizedName.localeCompare(right.normalizedName, 'en');
    return byName === 0 ? left.id.localeCompare(right.id, 'en') : byName;
  });
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMarkersWorkspace(): MarkersWorkspaceValue {
  const value = use(MarkersWorkspaceContext);
  if (value === null) throw new Error('Markers workspace is unavailable.');
  return value;
}

export function MarkersWorkspaceProvider({ children }: PropsWithChildren) {
  const { clock, idGenerator, mapLayers, mapViewport, savedMarkers } =
    useRuntimeServices();
  const markerSort = useUiStore((state) => state.markerSort);
  const markerCreationCommand = useStore(
    mapInteractionStore,
    (state) => state.markerCreationCommand,
  );
  const subscribeViewport = useCallback(
    (listener: () => void) => mapViewport.subscribe(listener),
    [mapViewport],
  );
  const getViewportSnapshot = useCallback(
    () => mapViewport.getViewportSnapshot(),
    [mapViewport],
  );
  const viewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportSnapshot,
  );
  const [markers, setMarkers] = useState<readonly SavedMarker[]>([]);
  const [loadState, setLoadState] = useState<MarkerLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<MarkerEditorDraft | null>(null);

  const loadMarkers = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const loaded = await savedMarkers.listSavedMarkers();
      setMarkers(loaded);
      setLoadState('ready');
    } catch {
      setLoadState('failed');
      setLoadError('Saved markers could not be loaded.');
    }
  }, [savedMarkers]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMarkers();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadMarkers]);

  useEffect(() => {
    if (markerCreationCommand === null || loadState !== 'ready') return;
    const command = markerCreationCommand;
    const timer = window.setTimeout(() => {
      consumeMarkerCreationCommand(command.id);
      setNotice(null);
      setEditorDraft({
        mode: 'create',
        coordinate: { ...command.coordinate },
        initialName: command.suggestedName ?? '',
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadState, markerCreationCommand]);

  useEffect(() => {
    if (loadState === 'ready') mapLayers?.setSavedMarkers(markers);
  }, [loadState, mapLayers, markers]);

  useEffect(() => {
    return () => {
      mapLayers?.setSavedMarkers([]);
    };
  }, [mapLayers]);

  const createMarker = useCallback(
    async (name: NormalizedSavedMarkerName, appearance: MarkerAppearance) => {
      const draft = editorDraft;
      if (draft?.mode !== 'create')
        throw new Error('The marker creation draft is unavailable.');
      const timestamp = clock.now().toISOString();
      const marker: SavedMarker = {
        schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
        id: idGenerator.generate(),
        name: name.name,
        normalizedName: name.normalizedName,
        coordinate: [draft.coordinate.longitude, draft.coordinate.latitude],
        iconKey: appearance.iconKey,
        colorKey: appearance.colorKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await savedMarkers.saveSavedMarker(marker);
      setMarkers((current) => [...current, marker]);
      setEditorDraft(null);
    },
    [clock, editorDraft, idGenerator, savedMarkers],
  );

  const saveAppearance = useCallback(
    async (appearance: MarkerAppearance) => {
      const draft = editorDraft;
      if (draft?.mode !== 'appearance') {
        throw new Error('The marker appearance draft is unavailable.');
      }
      const updated = await savedMarkers.updateSavedMarker(draft.marker.id, {
        name: draft.marker.name,
        normalizedName: draft.marker.normalizedName,
        iconKey: appearance.iconKey,
        colorKey: appearance.colorKey,
        updatedAt: clock.now().toISOString(),
      });
      setMarkers((current) =>
        current.map((marker) => (marker.id === updated.id ? updated : marker)),
      );
      setEditorDraft(null);
    },
    [clock, editorDraft, savedMarkers],
  );

  const renameMarker = useCallback(
    async (marker: SavedMarker, name: string) => {
      const normalized = normalizeSavedMarkerName(name);
      const updated = await savedMarkers.updateSavedMarker(marker.id, {
        name: normalized.name,
        normalizedName: normalized.normalizedName,
        iconKey: marker.iconKey,
        colorKey: marker.colorKey,
        updatedAt: clock.now().toISOString(),
      });
      setMarkers((current) =>
        current.map((currentMarker) =>
          currentMarker.id === updated.id ? updated : currentMarker,
        ),
      );
    },
    [clock, savedMarkers],
  );

  const deleteMarker = useCallback(
    async (marker: SavedMarker) => {
      await savedMarkers.deleteSavedMarker(marker.id);
      setMarkers((current) =>
        current.filter((currentMarker) => currentMarker.id !== marker.id),
      );
    },
    [savedMarkers],
  );

  const mapCenter = viewport?.center ?? null;
  const sortedMarkers = useMemo(
    () => sortMarkers(markers, markerSort, mapCenter),
    [mapCenter, markerSort, markers],
  );
  const value = useMemo<MarkersWorkspaceValue>(
    () => ({
      markers,
      sortedMarkers,
      loadState,
      loadError,
      notice,
      mapCenter,
      retryLoad: loadMarkers,
      openAppearanceEditor: (marker) => {
        setEditorDraft({ mode: 'appearance', marker });
      },
      renameMarker,
      deleteMarker,
    }),
    [
      deleteMarker,
      loadError,
      loadMarkers,
      loadState,
      markers,
      notice,
      renameMarker,
      sortedMarkers,
      mapCenter,
    ],
  );

  return (
    <MarkersWorkspaceContext value={value}>
      {children}
      {editorDraft?.mode === 'create' ? (
        <MarkerEditorDialog
          mode="create"
          initialName={editorDraft.initialName}
          open
          onCancel={() => {
            setEditorDraft(null);
          }}
          onSubmit={createMarker}
        />
      ) : null}
      {editorDraft?.mode === 'appearance' ? (
        <MarkerEditorDialog
          mode="appearance"
          marker={editorDraft.marker}
          open
          onCancel={() => {
            setEditorDraft(null);
          }}
          onSubmit={saveAppearance}
        />
      ) : null}
    </MarkersWorkspaceContext>
  );
}

interface MarkerSortControlProps {
  readonly onMarkerSortChange: (sort: MarkerSort) => Promise<boolean>;
}

const markerSortLabels: Readonly<Record<MarkerSort, string>> = {
  created: 'Newest',
  name: 'Name',
  color: 'Icon color',
  distance: 'Distance from map center',
};

export function MarkerSortControl({ onMarkerSortChange }: MarkerSortControlProps) {
  const markerSort = useUiStore((state) => state.markerSort);
  const [sortSaveError, setSortSaveError] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);

  const chooseSort = async (sort: MarkerSort) => {
    setSortAnchor(null);
    const saved = await onMarkerSortChange(sort);
    setSortSaveError(!saved);
  };

  return (
    <>
      <Tooltip title={`Sort: ${markerSortLabels[markerSort]}`}>
        <IconButton
          size="small"
          aria-label={`Sort markers. Current: ${markerSortLabels[markerSort]}`}
          aria-haspopup="menu"
          onClick={(event) => {
            setSortAnchor(event.currentTarget);
          }}
        >
          <SortIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={sortAnchor}
        open={sortAnchor !== null}
        onClose={() => {
          setSortAnchor(null);
        }}
      >
        {(Object.keys(markerSortLabels) as MarkerSort[]).map((sort) => (
          <MenuItem
            key={sort}
            selected={sort === markerSort}
            onClick={() => {
              void chooseSort(sort);
            }}
          >
            {markerSortLabels[sort]}
          </MenuItem>
        ))}
      </Menu>
      <Snackbar
        open={sortSaveError}
        autoHideDuration={4_000}
        message="Sort preference could not be saved"
        onClose={() => {
          setSortSaveError(false);
        }}
      />
    </>
  );
}

const markerDistanceFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
});

function markerDistanceLabel(
  marker: SavedMarker,
  center: MapCoordinate | null,
): string {
  if (center === null) return 'Distance unavailable';
  const distanceKm = geodesicDistanceKm(
    center.latitude,
    center.longitude,
    marker.coordinate[1],
    marker.coordinate[0],
  );
  return `${markerDistanceFormatter.format(distanceKm)} km away`;
}

export function MarkersPanel() {
  const {
    deleteMarker,
    loadError,
    loadState,
    mapCenter,
    notice,
    openAppearanceEditor,
    renameMarker,
    retryLoad,
    sortedMarkers,
  } = useMarkersWorkspace();
  const [actionAnchor, setActionAnchor] = useState<HTMLElement | null>(null);
  const [actionMarker, setActionMarker] = useState<SavedMarker | null>(null);
  const [renameTarget, setRenameTarget] = useState<SavedMarker | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const [markerHoverSuppressed, setMarkerHoverSuppressed] = useState(false);

  const startRename = (marker: SavedMarker) => {
    setActionAnchor(null);
    setActionMarker(null);
    setRenameTarget(marker);
    setRenameValue(marker.name);
    setRenameError(null);
  };

  const saveRename = async () => {
    const target = renameTarget;
    if (target === null) return;
    try {
      await renameMarker(target, renameValue);
      setRenameTarget(null);
      setRenameError(null);
    } catch (error) {
      setRenameError(
        error instanceof Error ? error.message : 'The marker could not be renamed.',
      );
    }
  };

  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
      {loadState === 'loading' ? (
        <Stack direction="row" spacing={1} role="status" sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography>Loading saved markers</Typography>
        </Stack>
      ) : null}
      {loadState === 'failed' ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void retryLoad()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      ) : null}
      {notice !== null ? <Alert severity="warning">{notice}</Alert> : null}
      {deleteError !== null ? <Alert severity="warning">{deleteError}</Alert> : null}
      {loadState === 'ready' && sortedMarkers.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
          <Typography variant="body2" color="text.secondary">
            No saved markers yet. Use New marker, then choose a point on the map.
          </Typography>
        </Paper>
      ) : null}
      {loadState === 'ready' && sortedMarkers.length > 0 ? (
        <List
          aria-label="Saved markers"
          disablePadding
          sx={{ display: 'grid', gap: 1.5 }}
        >
          {sortedMarkers.map((marker) => {
            if (renameTarget?.id === marker.id) {
              return (
                <Paper
                  component="li"
                  key={marker.id}
                  variant="outlined"
                  sx={{ p: 1.5 }}
                >
                  <Stack spacing={1}>
                    <TextField
                      autoFocus
                      size="small"
                      label="Marker name"
                      value={renameValue}
                      onChange={(event) => {
                        setRenameValue(event.target.value);
                        setRenameError(null);
                      }}
                      error={renameError !== null}
                      helperText={renameError}
                      slotProps={{ htmlInput: { maxLength: 200 } }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveRename();
                        if (event.key === 'Escape') setRenameTarget(null);
                      }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button
                        onClick={() => void saveRename()}
                        variant="contained"
                        size="small"
                      >
                        Save
                      </Button>
                      <Button
                        onClick={() => {
                          setRenameTarget(null);
                        }}
                        size="small"
                      >
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              );
            }
            const icon = markerIconFor(marker.iconKey);
            const color = markerColorFor(marker.colorKey);
            const pending = pendingDeleteId === marker.id;
            const deleting = deletingId === marker.id;
            const hovered = hoveredMarkerId === marker.id;
            const deleteActionClassName = `marker-row-action${
              pending ? ' marker-row-action--pending' : ''
            }`;
            return (
              <ClickAwayListener
                key={marker.id}
                onClickAway={() => {
                  if (deletingId !== marker.id) {
                    setPendingDeleteId((current) =>
                      current === marker.id ? null : current,
                    );
                  }
                }}
              >
                <Paper
                  component="li"
                  variant="outlined"
                  className={hovered ? 'marker-row--hovered' : undefined}
                  onMouseEnter={() => {
                    if (!markerHoverSuppressed) setHoveredMarkerId(marker.id);
                  }}
                  onMouseMove={() => {
                    setMarkerHoverSuppressed(false);
                    setHoveredMarkerId(marker.id);
                  }}
                  onMouseLeave={() => {
                    setHoveredMarkerId((current) =>
                      current === marker.id ? null : current,
                    );
                    if (deletingId !== marker.id) {
                      setPendingDeleteId((current) =>
                        current === marker.id ? null : current,
                      );
                    }
                  }}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    alignItems: 'center',
                    bgcolor: hovered ? 'action.hover' : 'transparent',
                    '& .MuiListItemButton-root, & .MuiListItemButton-root:hover': {
                      bgcolor: 'transparent',
                    },
                    '& .marker-row-action': {
                      opacity: 0,
                      pointerEvents: 'none',
                      transition: 'opacity 150ms ease-out',
                    },
                    '& .marker-row-action--pending, &:focus-within .marker-row-action, &.marker-row--hovered .marker-row-action':
                      {
                        opacity: 1,
                        pointerEvents: 'auto',
                      },
                    '@media (width < 900px)': {
                      '& .marker-row-action': {
                        opacity: 1,
                        pointerEvents: 'auto',
                      },
                    },
                  }}
                >
                  <ListItemButton
                    onClick={() => {
                      requestMapNavigation({
                        longitude: marker.coordinate[0],
                        latitude: marker.coordinate[1],
                      });
                    }}
                    sx={{ minWidth: 0, px: 1.5, py: 1.25 }}
                  >
                    <Stack
                      direction="row"
                      spacing={1.25}
                      sx={{ alignItems: 'center', minWidth: 0 }}
                    >
                      <Box
                        aria-hidden
                        sx={{
                          width: 36,
                          height: 36,
                          flex: '0 0 36px',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        <PinheadIcon svg={icon.svg} color={color.value} size={28} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" noWrap>
                          {marker.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {markerDistanceLabel(marker, mapCenter)}
                        </Typography>
                      </Box>
                    </Stack>
                  </ListItemButton>
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ alignItems: 'center', px: 1 }}
                  >
                    <Tooltip
                      disableHoverListener={markerHoverSuppressed}
                      title="Marker actions"
                    >
                      <IconButton
                        className="marker-row-action"
                        size="small"
                        aria-label={`Marker actions for ${marker.name}`}
                        onClick={(event) => {
                          if (event.detail > 0) {
                            setMarkerHoverSuppressed(true);
                            setHoveredMarkerId(null);
                          }
                          setActionAnchor(event.currentTarget);
                          setActionMarker(marker);
                        }}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip
                      disableHoverListener={markerHoverSuppressed}
                      title={pending ? 'Confirm deletion' : 'Delete marker'}
                    >
                      <IconButton
                        className={deleteActionClassName}
                        size="small"
                        aria-label={
                          pending
                            ? `Confirm deletion of ${marker.name}`
                            : `Delete ${marker.name}`
                        }
                        color={pending ? 'error' : 'default'}
                        disabled={deleting}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && deletingId !== marker.id) {
                            setPendingDeleteId(null);
                            event.currentTarget.blur();
                          }
                        }}
                        onClick={() => {
                          if (!pending) {
                            setPendingDeleteId(marker.id);
                            return;
                          }
                          setDeletingId(marker.id);
                          setDeleteError(null);
                          void deleteMarker(marker)
                            .catch((error: unknown) => {
                              setDeleteError(
                                error instanceof Error
                                  ? error.message
                                  : 'The marker could not be deleted.',
                              );
                            })
                            .finally(() => {
                              setDeletingId(null);
                              setPendingDeleteId(null);
                            });
                        }}
                      >
                        {pending ? (
                          <DeleteForeverOutlinedIcon fontSize="small" />
                        ) : (
                          <DeleteOutlineIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              </ClickAwayListener>
            );
          })}
        </List>
      ) : null}
      <Menu
        anchorEl={actionAnchor}
        open={actionMarker !== null}
        onClose={() => {
          setActionAnchor(null);
          setActionMarker(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            if (actionMarker !== null) startRename(actionMarker);
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (actionMarker !== null) openAppearanceEditor(actionMarker);
            setActionAnchor(null);
            setActionMarker(null);
          }}
        >
          <PaletteIcon fontSize="small" sx={{ mr: 1 }} /> Change icon and color
        </MenuItem>
      </Menu>
    </Stack>
  );
}
