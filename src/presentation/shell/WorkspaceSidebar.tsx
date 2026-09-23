import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import AddIcon from '@mui/icons-material/Add';
import AltRouteOutlinedIcon from '@mui/icons-material/AltRouteOutlined';
import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import PlaylistAddCheckOutlinedIcon from '@mui/icons-material/PlaylistAddCheckOutlined';
import WbCloudyOutlinedIcon from '@mui/icons-material/WbCloudyOutlined';
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';

import type { MarkerSort } from '@/domain/markers/savedMarker';
import type { TrackSort } from '@/domain/tracks/localTrack';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { LayersPanel } from '@/presentation/layers/LayersPanel';
import {
  cancelWeatherPointSelection,
  mapInteractionStore,
  requestMapNavigation,
  requestMarkerPlacement,
  startWeatherPointSelection,
} from '@/presentation/map/mapInteractionStore';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';
import {
  MarkersPanel,
  MarkerSortControl,
  useMarkersWorkspace,
} from '@/presentation/markers/MarkersWorkspace';
import { markerWeatherWeekdayLabel } from '@/presentation/markers/markerWeatherWeekdayOptions';
import { SatelliteBrowser } from '@/presentation/satellite-browser/SatelliteBrowser';
import { SatelliteMosaicBrowser } from '@/presentation/satellite-browser/SatelliteMosaicBrowser';
import { useSatelliteMosaic } from '@/presentation/satellite-browser/SatelliteMosaicProvider';
import type { WorkspaceTab } from '@/presentation/shell/uiStore';
import { appColors } from '@/presentation/theme/appColors';
import {
  TracksPanel,
  TrackSortControl,
  useTracksWorkspace,
} from '@/presentation/tracks/TracksWorkspace';
import { UserPanel } from '@/presentation/user/UserPanel';
import {
  WeatherPanel,
  type WeatherHeaderPoint,
} from '@/presentation/weather/WeatherPanel';

interface WorkspaceSidebarProps {
  readonly activeTab: WorkspaceTab;
  readonly auxiliaryOverlay: boolean;
  readonly collapsed: boolean;
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
  weather: {
    title: 'Weather',
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

function WeatherLocationHeader({ point }: { readonly point: WeatherHeaderPoint }) {
  return (
    <ButtonBase
      aria-label="Center map on forecast location"
      onClick={() => {
        requestMapNavigation(point.coordinate);
      }}
      sx={{
        minWidth: 0,
        px: 0.5,
        py: 0.25,
        borderRadius: 1,
        textAlign: 'left',
        transition: (theme) => theme.transitions.create('background-color'),
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
        <LocationOnOutlinedIcon
          aria-hidden="true"
          sx={{ flexShrink: 0, fontSize: 18, color: 'text.secondary' }}
        />
        <Stack spacing={0} sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            color={point.placeLabel === undefined ? 'text.secondary' : 'text.primary'}
            noWrap
            sx={{
              fontWeight: point.placeLabel === undefined ? 400 : 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {point.placeLabel ??
              `${point.coordinate.latitude.toFixed(5)}, ${point.coordinate.longitude.toFixed(5)}`}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            aria-hidden={point.elevationMeters === undefined}
            sx={{
              visibility: point.elevationMeters === undefined ? 'hidden' : 'visible',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {point.elevationMeters === undefined
              ? '\u00a0'
              : `${Math.round(point.elevationMeters).toLocaleString('en-US')} m`}
          </Typography>
        </Stack>
      </Stack>
    </ButtonBase>
  );
}

export function WorkspaceSidebar({
  activeTab,
  auxiliaryOverlay,
  collapsed,
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
  const {
    loadState,
    openWeatherSettings,
    weatherPreferences,
    weatherPreferencesReady,
  } = useMarkersWorkspace();
  const { multiTrackMode, startRoutePlan, toggleMultiTrackMode } = useTracksWorkspace();
  const { satelliteMode, toggleMosaicMode } = useSatelliteMosaic();
  const [weatherHeaderPoint, setWeatherHeaderPoint] =
    useState<WeatherHeaderPoint | null>(null);
  const weatherPointSelectionActive = useStore(
    mapInteractionStore,
    (state) => state.weatherPointSelectionActive,
  );
  useEffect(() => {
    if (activeTab !== 'weather') cancelWeatherPointSelection();
  }, [activeTab]);
  const canCreateMarkers = mapViewportSnapshot !== null && loadState === 'ready';
  const markerCreationMessage =
    mapViewportSnapshot === null
      ? 'Map is unavailable'
      : loadState === 'failed'
        ? 'Saved markers are unavailable'
        : 'Saved markers are loading';
  const startMarkerPlacement = () => {
    if (fullWidth) onShowMap();
    requestMarkerPlacement({ kind: 'saved-marker' });
  };
  const toggleWeatherPointSelection = () => {
    if (weatherPointSelectionActive) {
      cancelWeatherPointSelection();
      return;
    }
    startWeatherPointSelection();
    if (fullWidth) onShowMap();
  };
  const compactMarkersHeader = fullWidth && activeTab === 'markers';

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
          display: compactMarkersHeader ? 'grid' : 'flex',
          gridTemplateColumns: compactMarkersHeader ? 'minmax(0, 1fr) auto' : undefined,
          gridTemplateRows: compactMarkersHeader ? 'auto auto' : undefined,
          columnGap: compactMarkersHeader ? 1 : undefined,
          rowGap: compactMarkersHeader ? 0.5 : undefined,
          alignItems: 'center',
          minHeight: 64,
          px: compactMarkersHeader ? 1 : 2,
          py: compactMarkersHeader ? 1 : 0,
          bgcolor: appColors.surface.subtle,
          borderBottom: `1px solid ${appColors.brand.sky}`,
        }}
      >
        <Box
          sx={{
            minWidth: 0,
            gridColumn: compactMarkersHeader ? 1 : undefined,
            gridRow: compactMarkersHeader ? 1 : undefined,
          }}
        >
          <Typography component="h1" variant="h6" noWrap>
            {definition.title}
          </Typography>
        </Box>
        {activeTab === 'weather' && weatherHeaderPoint !== null ? (
          <WeatherLocationHeader point={weatherHeaderPoint} />
        ) : null}
        <Box sx={{ display: compactMarkersHeader ? 'none' : undefined, flex: 1 }} />
        {activeTab === 'weather' ? (
          <Tooltip
            title={
              weatherPointSelectionActive
                ? 'Cancel forecast point selection'
                : 'Select a forecast point on the map'
            }
          >
            <ToggleButton
              size="small"
              value="weather-point"
              selected={weatherPointSelectionActive}
              aria-label={
                weatherPointSelectionActive
                  ? 'Cancel forecast point selection'
                  : 'Select forecast point'
              }
              onClick={toggleWeatherPointSelection}
            >
              <AddLocationAltIcon fontSize="small" />
            </ToggleButton>
          </Tooltip>
        ) : null}
        {activeTab === 'satellite' ? (
          <Tooltip
            title={
              satelliteMode === 'mosaic'
                ? 'Return to individual Sentinel scenes'
                : 'Switch to Sentinel Mosaic'
            }
          >
            <ToggleButton
              size="small"
              value="mosaic"
              selected={satelliteMode === 'mosaic'}
              aria-label="Mosaic"
              aria-pressed={satelliteMode === 'mosaic'}
              sx={{ gap: 0.75 }}
              onClick={() => {
                if (satelliteMode === 'scene') onSatellitePaneOpenChange(false);
                toggleMosaicMode();
              }}
            >
              <GridViewOutlinedIcon
                fontSize="small"
                sx={{ transform: 'translateY(-1px)' }}
              />
              Mosaic
            </ToggleButton>
          </Tooltip>
        ) : null}
        {activeTab === 'markers' ? (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              alignItems: 'center',
              minWidth: 0,
              gridColumn: compactMarkersHeader ? '1 / -1' : undefined,
              gridRow: compactMarkersHeader ? 2 : undefined,
            }}
          >
            <Tooltip
              title={
                !weatherPreferencesReady
                  ? 'Loading marker weather settings'
                  : weatherPreferences.weekdays.length === 0
                    ? 'Marker weather is disabled'
                    : 'Marker weather settings'
              }
            >
              <Button
                size="small"
                color={weatherPreferences.weekdays.length === 0 ? 'inherit' : 'primary'}
                disabled={!weatherPreferencesReady}
                aria-label={
                  weatherPreferencesReady
                    ? `Marker weather settings. ${
                        weatherPreferences.weekdays.length === 0
                          ? 'Forecast disabled'
                          : `Forecast days: ${markerWeatherWeekdayLabel(
                              weatherPreferences.weekdays,
                            )}`
                      }`
                    : 'Loading marker weather settings'
                }
                startIcon={<WbCloudyOutlinedIcon fontSize="small" />}
                sx={{
                  minWidth: 0,
                  px: compactMarkersHeader ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                }}
                onClick={openWeatherSettings}
              >
                {weatherPreferencesReady
                  ? markerWeatherWeekdayLabel(weatherPreferences.weekdays)
                  : ''}
              </Button>
            </Tooltip>
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
          </Stack>
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
          <IconButton
            aria-label="Show map"
            sx={{
              gridColumn: compactMarkersHeader ? 2 : undefined,
              gridRow: compactMarkersHeader ? 1 : undefined,
            }}
            onClick={onShowMap}
          >
            <ChevronLeftOutlinedIcon />
          </IconButton>
        ) : null}
      </Stack>
      <Box
        sx={{
          minHeight: 0,
          flex: 1,
          overflowX: 'hidden',
          overflowY:
            activeTab === 'tracks' || activeTab === 'weather' ? 'hidden' : 'auto',
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
          {satelliteMode === 'mosaic' ? (
            <SatelliteMosaicBrowser />
          ) : (
            <SatelliteBrowser
              active={activeTab === 'satellite'}
              auxiliaryOverlay={auxiliaryOverlay}
              fallbackCoordinates={searchAreaCoordinates}
              onPaneOpenChange={onSatellitePaneOpenChange}
              {...(onSceneSelected === undefined ? {} : { onSceneSelected })}
            />
          )}
        </Box>
        <Box
          sx={{
            display: activeTab === 'weather' ? 'block' : 'none',
            height: '100%',
          }}
        >
          <WeatherPanel
            sidebarCollapsed={collapsed}
            onSelectedPointChange={setWeatherHeaderPoint}
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
