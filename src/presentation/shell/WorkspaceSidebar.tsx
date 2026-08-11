import AddIcon from '@mui/icons-material/Add';
import AltRouteOutlinedIcon from '@mui/icons-material/AltRouteOutlined';
import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import PlaylistAddCheckOutlinedIcon from '@mui/icons-material/PlaylistAddCheckOutlined';
import {
  Box,
  Button,
  IconButton,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useSyncExternalStore, type ReactNode } from 'react';

import type { MarkerSort } from '@/domain/markers/savedMarker';
import type { TrackSort } from '@/domain/tracks/localTrack';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { LayersPanel } from '@/presentation/layers/LayersPanel';
import { requestMarkerPlacement } from '@/presentation/map/mapInteractionStore';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';
import {
  MarkersPanel,
  MarkerSortControl,
  useMarkersWorkspace,
} from '@/presentation/markers/MarkersWorkspace';
import { SatelliteBrowser } from '@/presentation/satellite-browser/SatelliteBrowser';
import type { WorkspaceTab } from '@/presentation/shell/uiStore';
import { appColors } from '@/presentation/theme/appColors';
import {
  TracksPanel,
  TrackSortControl,
  useTracksWorkspace,
} from '@/presentation/tracks/TracksWorkspace';
import { UserPanel } from '@/presentation/user/UserPanel';

interface WorkspaceSidebarProps {
  readonly activeTab: WorkspaceTab;
  readonly auxiliaryOverlay: boolean;
  readonly fullWidth: boolean;
  readonly onMarkerSortChange: (sort: MarkerSort) => Promise<boolean>;
  readonly onTrackSortChange: (sort: TrackSort) => Promise<boolean>;
  readonly onSatellitePaneOpenChange: (open: boolean) => void;
  readonly onShowMap: () => void;
  readonly onOpenActiveTrackDetails: () => void;
}

interface SidebarDefinition {
  readonly actions: ReactNode;
  readonly title: string;
}

const definitions: Record<WorkspaceTab, SidebarDefinition> = {
  tracks: {
    title: 'Tracks',
    actions: null,
  },
  satellite: {
    title: 'Satellite imagery',
    actions: null,
  },
  markers: {
    title: 'Markers',
    actions: null,
  },
  layers: {
    title: 'Layers',
    actions: null,
  },
  user: {
    title: 'User',
    actions: null,
  },
};

export function WorkspaceSidebar({
  activeTab,
  auxiliaryOverlay,
  fullWidth,
  onMarkerSortChange,
  onTrackSortChange,
  onSatellitePaneOpenChange,
  onOpenActiveTrackDetails,
  onShowMap,
}: WorkspaceSidebarProps) {
  const { mapDiagnostics, mapViewport, trailRouter } = useRuntimeServices();
  const subscribeToMap = useCallback(
    (listener: () => void) => mapDiagnostics.subscribe(listener),
    [mapDiagnostics],
  );
  const getMapSnapshot = useCallback(
    () => mapDiagnostics.getSnapshot(),
    [mapDiagnostics],
  );
  const mapSnapshot = useSyncExternalStore(
    subscribeToMap,
    getMapSnapshot,
    getMapSnapshot,
  );
  const subscribeToViewport = useCallback(
    (listener: () => void) => mapViewport.subscribe(listener),
    [mapViewport],
  );
  const getViewportSnapshot = useCallback(
    () => mapViewport.getViewportSnapshot(),
    [mapViewport],
  );
  const mapViewportSnapshot = useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getViewportSnapshot,
  );
  const definition = definitions[activeTab];
  const camera = mapSnapshot?.camera ?? defaultGeorgiaCamera;
  const searchAreaCoordinates = `${camera.latitude.toFixed(4)}, ${camera.longitude.toFixed(4)}`;
  const onSceneSelected = fullWidth ? onShowMap : undefined;
  const onMarkerSelected = fullWidth ? onShowMap : undefined;
  const { loadState } = useMarkersWorkspace();
  const { multiTrackMode, startRoutePlan, toggleMultiTrackMode } = useTracksWorkspace();
  const canCreateMarkers = mapViewportSnapshot !== null && loadState === 'ready';
  const markerCreationMessage =
    mapViewportSnapshot === null
      ? 'Map is unavailable'
      : loadState === 'failed'
        ? 'Saved markers are unavailable'
        : 'Saved markers are loading';
  const startMarkerPlacement = () => {
    if (fullWidth) onShowMap();
    requestMarkerPlacement();
  };

  return (
    <Box
      component="aside"
      aria-label={`${definition.title} tools`}
      sx={{
        position: 'relative',
        width: fullWidth ? '100%' : { xs: 420, xl: 464 },
        height: '100%',
        flexGrow: fullWidth ? 1 : 0,
        flexShrink: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        borderRadius: 0,
        overflow: 'hidden',
        boxShadow: 'none',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          minHeight: 64,
          px: 2,
          bgcolor: appColors.surface.subtle,
          borderBottom: `1px solid ${appColors.brand.sky}`,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="h1" variant="h6" noWrap>
            {definition.title}
          </Typography>
        </Box>
        {activeTab === 'markers' ? (
          <>
            <Tooltip
              title={
                canCreateMarkers ? 'Place a marker on the map' : markerCreationMessage
              }
            >
              <span>
                <Button
                  disabled={!canCreateMarkers}
                  size="small"
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={startMarkerPlacement}
                >
                  New marker
                </Button>
              </span>
            </Tooltip>
            <MarkerSortControl onMarkerSortChange={onMarkerSortChange} />
          </>
        ) : activeTab === 'tracks' ? (
          <>
            <Tooltip
              title={
                multiTrackMode ? 'Exit multi-track selection' : 'Select multiple tracks'
              }
            >
              <ToggleButton
                size="small"
                value="multi-track"
                aria-label="Select multiple tracks"
                selected={multiTrackMode}
                onClick={() => {
                  void toggleMultiTrackMode();
                }}
              >
                <PlaylistAddCheckOutlinedIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip
              title={
                trailRouter === null
                  ? 'Route planning is unavailable because map routing data is not configured'
                  : 'Plan a route on the map'
              }
            >
              <span>
                <Button
                  disabled={trailRouter === null}
                  size="small"
                  variant="contained"
                  startIcon={<AltRouteOutlinedIcon />}
                  onClick={startRoutePlan}
                >
                  Plan route
                </Button>
              </span>
            </Tooltip>
            <TrackSortControl onTrackSortChange={onTrackSortChange} />
          </>
        ) : (
          definition.actions
        )}
        {fullWidth ? (
          <IconButton aria-label="Show map" onClick={onShowMap}>
            <ChevronLeftOutlinedIcon />
          </IconButton>
        ) : null}
      </Stack>
      <Box
        sx={{
          minHeight: 0,
          flex: 1,
          overflowX: 'hidden',
          overflowY: activeTab === 'tracks' ? 'hidden' : 'auto',
        }}
      >
        <Box
          sx={{
            display: activeTab === 'tracks' ? 'block' : 'none',
            height: '100%',
          }}
        >
          <TracksPanel onOpenActiveDetails={onOpenActiveTrackDetails} />
        </Box>
        <Box sx={{ display: activeTab === 'satellite' ? 'block' : 'none' }}>
          <SatelliteBrowser
            active={activeTab === 'satellite'}
            auxiliaryOverlay={auxiliaryOverlay}
            fallbackCoordinates={searchAreaCoordinates}
            onPaneOpenChange={onSatellitePaneOpenChange}
            {...(onSceneSelected === undefined ? {} : { onSceneSelected })}
          />
        </Box>
        <Box sx={{ display: activeTab === 'markers' ? 'block' : 'none' }}>
          <MarkersPanel
            {...(onMarkerSelected === undefined ? {} : { onMarkerSelected })}
          />
        </Box>
        <Box sx={{ display: activeTab === 'layers' ? 'block' : 'none' }}>
          <LayersPanel />
        </Box>
        {activeTab === 'user' ? <UserPanel /> : null}
      </Box>
    </Box>
  );
}
