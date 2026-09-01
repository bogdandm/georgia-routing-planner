import AddIcon from '@mui/icons-material/Add';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Box,
  Button,
  ButtonBase,
  ClickAwayListener,
  IconButton,
  List,
  ListItemButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useId, useState, type ReactElement } from 'react';

import type {
  ElevationProvider,
  ElevationSample,
} from '@/application/ports/ElevationProvider';
import { MAXIMUM_TRACK_MARKERS, type TrackMarker } from '@/domain/tracks/localTrack';
import { requestMapNavigation } from '@/presentation/map/mapInteractionStore';
import { formatTrackElevation } from '@/presentation/tracks/trackFormatters';

interface TrackMarkersSectionProps {
  readonly elevationProvider: ElevationProvider | null;
  readonly markers: readonly TrackMarker[];
  readonly onAdd: () => void;
  readonly onRename: (markerId: string, name: string) => Promise<void>;
  readonly onDelete: (markerId: string) => Promise<void>;
}

export function TrackMarkersSection({
  elevationProvider,
  markers,
  onAdd,
  onRename,
  onDelete,
}: TrackMarkersSectionProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const detailsId = `track-markers-${useId().replaceAll(':', '')}`;
  const [markerElevations, setMarkerElevations] = useState<
    ReadonlyMap<string, ElevationSample>
  >(new Map());

  useEffect(() => {
    const controller = new AbortController();
    if (markers.length === 0 || elevationProvider === null) {
      return () => {
        controller.abort();
      };
    }

    void elevationProvider
      .sampleMany(
        markers.map((marker) => ({
          longitude: marker.coordinate[0],
          latitude: marker.coordinate[1],
        })),
        controller.signal,
      )
      .then((samples) => {
        if (controller.signal.aborted) return;
        setMarkerElevations(
          new Map(
            markers.map((marker, index) => [
              marker.id,
              samples[index] ?? { status: 'unavailable' },
            ]),
          ),
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setMarkerElevations(
          new Map(
            markers.map((marker) => [marker.id, { status: 'unavailable' }] as const),
          ),
        );
      });

    return () => {
      controller.abort();
    };
  }, [elevationProvider, markers]);

  const startRename = (marker: TrackMarker) => {
    setRenameTargetId(marker.id);
    setRenameValue(marker.name);
    setRenameError(null);
  };

  const saveRename = async () => {
    if (renameTargetId === null) return;
    try {
      await onRename(renameTargetId, renameValue);
      setRenameTargetId(null);
      setRenameError(null);
    } catch (error) {
      setRenameError(
        error instanceof Error
          ? error.message
          : 'The track marker could not be renamed.',
      );
    }
  };

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
        <ButtonBase
          aria-label="Markers"
          aria-controls={detailsId}
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
          }}
          sx={{
            minWidth: 0,
            minHeight: 44,
            justifyContent: 'space-between',
            px: 1,
            textAlign: 'left',
          }}
        >
          <Typography component="h3" variant="subtitle2">
            Markers ({markers.length})
          </Typography>
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
        <Tooltip title="Add track marker">
          <span>
            <IconButton
              size="small"
              aria-label="Add track marker"
              disabled={markers.length >= MAXIMUM_TRACK_MARKERS}
              onClick={onAdd}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {expanded ? (
        <Box id={detailsId} sx={{ px: 1 }}>
          {deleteError === null ? null : (
            <Typography variant="caption" color="error">
              {deleteError}
            </Typography>
          )}
          {markers.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              No markers for this track.
            </Typography>
          ) : (
            <List
              aria-label="Track markers"
              disablePadding
              sx={{ display: 'grid', gap: 1 }}
            >
              {markers.map((marker) => {
                if (renameTargetId === marker.id) {
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
                            if (event.key === 'Escape') setRenameTargetId(null);
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
                              setRenameTargetId(null);
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
                const pendingDelete = pendingDeleteId === marker.id;
                const deleting = deletingId === marker.id;
                const elevation = markerElevations.get(marker.id);
                const elevationLabel =
                  elevation?.status === 'available'
                    ? formatTrackElevation(elevation.meters)
                    : elevationProvider === null || elevation?.status === 'unavailable'
                      ? 'Elevation unavailable'
                      : 'Loading elevation…';
                return (
                  <ClickAwayListener
                    key={marker.id}
                    onClickAway={() => {
                      if (!deleting) {
                        setPendingDeleteId((current) =>
                          current === marker.id ? null : current,
                        );
                      }
                    }}
                  >
                    <Paper
                      component="li"
                      variant="outlined"
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        alignItems: 'center',
                        '@media (hover: hover) and (pointer: fine)': {
                          '& .TrackMarker-actions': {
                            opacity: 0,
                            pointerEvents: 'none',
                          },
                          '&:hover .TrackMarker-actions, &:focus-within .TrackMarker-actions':
                            {
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
                        <Stack spacing={0.125} sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2" noWrap>
                            {marker.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {elevationLabel}
                          </Typography>
                        </Stack>
                      </ListItemButton>
                      <Stack
                        className="TrackMarker-actions"
                        direction="row"
                        spacing={0.5}
                        sx={{
                          alignItems: 'center',
                          px: 1,
                          transition: (theme) =>
                            theme.transitions.create('opacity', {
                              duration: theme.transitions.duration.shortest,
                            }),
                        }}
                      >
                        <Button
                          size="small"
                          onClick={() => {
                            startRename(marker);
                          }}
                        >
                          Rename
                        </Button>
                        <Tooltip
                          title={pendingDelete ? 'Confirm deletion' : 'Delete marker'}
                        >
                          <IconButton
                            size="small"
                            aria-label={
                              pendingDelete
                                ? `Confirm deletion of ${marker.name}`
                                : `Delete ${marker.name}`
                            }
                            color={pendingDelete ? 'error' : 'default'}
                            disabled={deleting}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape' && !deleting) {
                                setPendingDeleteId(null);
                                event.currentTarget.blur();
                              }
                            }}
                            onClick={() => {
                              if (!pendingDelete) {
                                setPendingDeleteId(marker.id);
                                return;
                              }
                              setDeletingId(marker.id);
                              setDeleteError(null);
                              void onDelete(marker.id)
                                .catch((error: unknown) => {
                                  setDeleteError(
                                    error instanceof Error
                                      ? error.message
                                      : 'The track marker could not be deleted.',
                                  );
                                })
                                .finally(() => {
                                  setDeletingId(null);
                                  setPendingDeleteId(null);
                                });
                            }}
                          >
                            {pendingDelete ? (
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
          )}
        </Box>
      ) : null}
    </Box>
  );
}
