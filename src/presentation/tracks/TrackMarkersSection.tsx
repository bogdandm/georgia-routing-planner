import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
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
import { MarkerNameError } from '@/domain/markers/savedMarker';
import { MAXIMUM_TRACK_MARKERS, type TrackMarker } from '@/domain/tracks/localTrack';
import { requestMapNavigation } from '@/presentation/map/mapInteractionStore';
import { useUiStore } from '@/presentation/shell/uiStore';
import { formatTrackElevation } from '@/presentation/tracks/trackFormatters';

function markerElevationKey(marker: TrackMarker): string {
  return `${marker.id}:${String(marker.coordinate[0])}:${String(marker.coordinate[1])}`;
}

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
  const { i18n, t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<MessageDescriptor | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const setMobileWorkspaceOpen = useUiStore((state) => state.setMobileWorkspaceOpen);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element ID.
  const detailsId = `track-markers-${useId().replaceAll(':', '')}`;
  const [markerElevations, setMarkerElevations] = useState<
    ReadonlyMap<string, ElevationSample>
  >(new Map());

  useEffect(() => {
    const controller = new AbortController();
    const pendingMarkers = markers.filter(
      (marker) => !markerElevations.has(markerElevationKey(marker)),
    );
    if (pendingMarkers.length === 0 || elevationProvider === null) {
      return () => {
        controller.abort();
      };
    }

    const applySamples = (samples: readonly ElevationSample[]): void => {
      if (controller.signal.aborted) return;
      const resolved = new Map<string, ElevationSample>();
      for (let index = 0; index < pendingMarkers.length; index += 1) {
        const marker = pendingMarkers[index];
        if (marker === undefined) continue;
        resolved.set(
          markerElevationKey(marker),
          samples[index] ?? { status: 'unavailable' },
        );
      }
      setMarkerElevations((current) => {
        const next = new Map<string, ElevationSample>();
        for (const marker of markers) {
          const key = markerElevationKey(marker);
          const sample = resolved.get(key) ?? current.get(key);
          if (sample !== undefined) next.set(key, sample);
        }
        return next;
      });
    };

    void elevationProvider
      .sampleMany(
        pendingMarkers.map((marker) => ({
          longitude: marker.coordinate[0],
          latitude: marker.coordinate[1],
        })),
        controller.signal,
      )
      .then(applySamples)
      .catch(() => {
        applySamples([]);
      });

    return () => {
      controller.abort();
    };
  }, [elevationProvider, markerElevations, markers]);

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
      if (!(error instanceof MarkerNameError)) {
        setRenameError(msg`The track marker could not be renamed.`);
      } else if (error.problem === 'required') {
        setRenameError(msg`Enter a marker name.`);
      } else if (error.problem === 'too-long') {
        setRenameError(msg`Marker names must be 200 characters or fewer.`);
      } else {
        setRenameError(msg`The marker name contains unsupported characters.`);
      }
    }
  };

  const markerCount = markers.length;

  return (
    <Box component="section" data-tour="track-markers">
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
          aria-label={t`Markers`}
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
            <Trans>Markers ({markerCount})</Trans>
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
        <Tooltip title={t`Add track marker`}>
          <span>
            <IconButton
              size="small"
              aria-label={t`Add track marker`}
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
          {deleteFailed ? (
            <Typography variant="caption" color="error">
              <Trans>The track marker could not be deleted.</Trans>
            </Typography>
          ) : null}
          {markers.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              <Trans>No markers for this track.</Trans>
            </Typography>
          ) : (
            <List
              aria-label={t`Track markers`}
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
                          label={t`Marker name`}
                          value={renameValue}
                          onChange={(event) => {
                            setRenameValue(event.target.value);
                            setRenameError(null);
                          }}
                          error={renameError !== null}
                          helperText={renameError === null ? null : i18n._(renameError)}
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
                            <Trans>Save</Trans>
                          </Button>
                          <Button
                            onClick={() => {
                              setRenameTargetId(null);
                            }}
                            size="small"
                          >
                            <Trans>Cancel</Trans>
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  );
                }
                const pendingDelete = pendingDeleteId === marker.id;
                const deleting = deletingId === marker.id;
                const markerName = marker.name;
                const elevation = markerElevations.get(markerElevationKey(marker));
                const elevationLabel =
                  elevation?.status === 'available'
                    ? formatTrackElevation(elevation.meters, i18n)
                    : elevationProvider === null || elevation?.status === 'unavailable'
                      ? t`Elevation unavailable`
                      : t`Loading elevation…`;
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
                          setMobileWorkspaceOpen(false);
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
                          <Trans>Rename</Trans>
                        </Button>
                        <Tooltip
                          title={pendingDelete ? t`Confirm deletion` : t`Delete marker`}
                        >
                          <IconButton
                            size="small"
                            aria-label={
                              pendingDelete
                                ? t`Confirm deletion of ${markerName}`
                                : t`Delete ${markerName}`
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
                              setDeleteFailed(false);
                              void onDelete(marker.id)
                                .catch(() => {
                                  setDeleteFailed(true);
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
