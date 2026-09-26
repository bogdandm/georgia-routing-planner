import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import AddIcon from '@mui/icons-material/Add';
import AltRouteOutlinedIcon from '@mui/icons-material/AltRouteOutlined';
import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaylistAddCheckOutlinedIcon from '@mui/icons-material/PlaylistAddCheckOutlined';
import WbCloudyOutlinedIcon from '@mui/icons-material/WbCloudyOutlined';
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';
import {
  MarkersPanel,
  MarkerSortControl,
  useMarkersWorkspace,
} from '@/presentation/markers/MarkersWorkspace';
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

const sidebarTitles: Readonly<Record<WorkspaceTab, MessageDescriptor>> = {
  tracks: msg`Tracks`,
  satellite: msg`Satellite imagery`,
  weather: msg`Weather`,
  markers: msg`Markers`,
  layers: msg`Layers`,
  user: msg`User`,
};

const markerWeatherDates = [
  new Date(Date.UTC(2024, 0, 7)),
  new Date(Date.UTC(2024, 0, 8)),
  new Date(Date.UTC(2024, 0, 9)),
  new Date(Date.UTC(2024, 0, 10)),
  new Date(Date.UTC(2024, 0, 11)),
  new Date(Date.UTC(2024, 0, 12)),
  new Date(Date.UTC(2024, 0, 13)),
] as const;

/* eslint-disable -- Stable DOM and ARIA control tokens. */
const weatherForecastLinksMenuId = 'weather-forecast-links-menu';
const menuPopupType = 'menu' as const;
/* eslint-enable */

function coordinateWithHemisphere(
  value: number,
  positiveHemisphere: 'N' | 'E',
  negativeHemisphere: 'S' | 'W',
): string {
  return `${Math.abs(value).toString()}${value >= 0 ? positiveHemisphere : negativeHemisphere}`;
}

/* eslint-disable -- Forecast URLs are locale-independent machine data. */
function meteoblueForecastUrl(coordinate: WeatherHeaderPoint['coordinate']): string {
  const latitude = coordinateWithHemisphere(coordinate.latitude, 'N', 'S');
  const longitude = coordinateWithHemisphere(coordinate.longitude, 'E', 'W');
  return `https://www.meteoblue.com/en/weather/week/${latitude}${longitude}`;
}

function windyForecastUrl(coordinate: WeatherHeaderPoint['coordinate']): string {
  return `https://www.windy.com/${coordinate.latitude.toString()}/${coordinate.longitude.toString()}`;
}
/* eslint-enable */

function WeatherLocationHeader({ point }: { readonly point: WeatherHeaderPoint }) {
  const { i18n, t } = useLingui();
  /* eslint-disable -- Intl option values are locale-independent formatting tokens. */
  const coordinateFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.locale, {
        minimumFractionDigits: 5,
        maximumFractionDigits: 5,
      }),
    [i18n.locale],
  );
  const elevationFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.locale, {
        style: 'unit',
        unit: 'meter',
        unitDisplay: 'short',
        maximumFractionDigits: 0,
      }),
    [i18n.locale],
  );
  /* eslint-enable */
  return (
    <ButtonBase
      aria-label={t`Center map on forecast location`}
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
          aria-hidden
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
              `${coordinateFormatter.format(point.coordinate.latitude)}, ${coordinateFormatter.format(point.coordinate.longitude)}`}
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
              : elevationFormatter.format(Math.round(point.elevationMeters))}
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
  const { i18n, t } = useLingui();
  const { mapDiagnostics, mapLayers, mapViewport, trailRouter } = useRuntimeServices();
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
  const sidebarTitle = i18n._(sidebarTitles[activeTab]);
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
  /* eslint-disable -- Intl options and punctuation are locale-independent tokens. */
  const markerWeatherWeekdayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, {
        weekday: 'short',
        timeZone: 'UTC',
      }),
    [i18n.locale],
  );
  const markerWeatherWeekdayLabel = weatherPreferences.weekdays
    .map((weekday) => markerWeatherWeekdayFormatter.format(markerWeatherDates[weekday]))
    .join(', ');
  /* eslint-enable */
  const markerWeatherSettingsLabel = !weatherPreferencesReady
    ? t`Loading marker weather settings`
    : weatherPreferences.weekdays.length === 0
      ? t`Marker weather settings. Forecast disabled`
      : t`Marker weather settings. Forecast days: ${markerWeatherWeekdayLabel}`;
  const { multiTrackMode, startRoutePlan, toggleMultiTrackMode } = useTracksWorkspace();
  const { satelliteMode, toggleMosaicMode } = useSatelliteMosaic();
  const [weatherHeaderPoint, setWeatherHeaderPoint] =
    useState<WeatherHeaderPoint | null>(null);
  const [weatherForecastMenuAnchor, setWeatherForecastMenuAnchor] =
    useState<HTMLElement | null>(null);
  const weatherForecastMenuOpen =
    activeTab === 'weather' && weatherForecastMenuAnchor?.isConnected === true;
  const weatherPointSelectionActive = useStore(
    mapInteractionStore,
    (state) => state.weatherPointSelectionActive,
  );
  const weatherMap = useStore(mapLayerStore, (state) => state.weatherMap);
  useEffect(() => {
    if (activeTab !== 'weather') cancelWeatherPointSelection();
  }, [activeTab]);
  const canCreateMarkers = mapViewportSnapshot !== null && loadState === 'ready';
  const markerCreationMessage =
    mapViewportSnapshot === null
      ? t`Map is unavailable`
      : loadState === 'failed'
        ? t`Saved markers are unavailable`
        : t`Saved markers are loading`;
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
      aria-label={t`${sidebarTitle} tools`}
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
            {sidebarTitle}
          </Typography>
        </Box>
        {activeTab === 'weather' && weatherHeaderPoint !== null ? (
          <WeatherLocationHeader point={weatherHeaderPoint} />
        ) : null}
        <Box sx={{ display: compactMarkersHeader ? 'none' : undefined, flex: 1 }} />
        {activeTab === 'weather' ? (
          <Tooltip
            title={
              weatherMap.status === 'loading'
                ? t`Loading weather map`
                : weatherMap.enabled
                  ? t`Hide weather map`
                  : weatherMap.status === 'error'
                    ? t`Weather map is unavailable`
                    : t`Show weather map`
            }
          >
            <span>
              <ToggleButton
                size="small"
                value="weather-map"
                selected={weatherMap.enabled}
                disabled={mapLayers === null || weatherMap.status === 'loading'}
                aria-label={
                  weatherMap.enabled ? t`Hide weather map` : t`Show weather map`
                }
                onClick={() => {
                  void mapLayers?.setWeatherEnabled(!weatherMap.enabled);
                }}
              >
                <MapOutlinedIcon sx={{ fontSize: 20 }} />
              </ToggleButton>
            </span>
          </Tooltip>
        ) : null}
        {activeTab === 'weather' ? (
          <>
            <Tooltip
              title={
                weatherPointSelectionActive
                  ? t`Cancel forecast point selection`
                  : t`Select a forecast point on the map`
              }
            >
              <ToggleButton
                size="small"
                value="weather-point"
                selected={weatherPointSelectionActive}
                aria-label={
                  weatherPointSelectionActive
                    ? t`Cancel forecast point selection`
                    : t`Select forecast point`
                }
                onClick={toggleWeatherPointSelection}
              >
                <AddLocationAltIcon sx={{ fontSize: 20 }} />
              </ToggleButton>
            </Tooltip>
            <IconButton
              size="small"
              aria-controls={
                weatherForecastMenuOpen ? weatherForecastLinksMenuId : undefined
              }
              aria-expanded={weatherForecastMenuOpen}
              aria-haspopup={menuPopupType}
              aria-label={t`More weather actions`}
              disabled={weatherHeaderPoint === null}
              onClick={(event) => {
                setWeatherForecastMenuAnchor(event.currentTarget);
              }}
            >
              <MoreVertIcon sx={{ fontSize: 20 }} />
            </IconButton>
            <Menu
              anchorEl={weatherForecastMenuOpen ? weatherForecastMenuAnchor : null}
              id={weatherForecastLinksMenuId}
              open={weatherForecastMenuOpen}
              onClose={() => {
                setWeatherForecastMenuAnchor(null);
              }}
            >
              {weatherHeaderPoint === null ? null : (
                <>
                  <MenuItem
                    component="a"
                    href={meteoblueForecastUrl(weatherHeaderPoint.coordinate)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setWeatherForecastMenuAnchor(null);
                    }}
                  >
                    <Trans>Open meteoblue.com</Trans>
                    <OpenInNewIcon sx={{ ml: 1, fontSize: 20 }} />
                  </MenuItem>
                  <MenuItem
                    component="a"
                    href={windyForecastUrl(weatherHeaderPoint.coordinate)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setWeatherForecastMenuAnchor(null);
                    }}
                  >
                    <Trans>Open windy.com</Trans>
                    <OpenInNewIcon sx={{ ml: 1, fontSize: 20 }} />
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        ) : null}
        {activeTab === 'satellite' ? (
          <Tooltip
            title={
              satelliteMode === 'mosaic'
                ? t`Return to individual Sentinel scenes`
                : t`Switch to Sentinel Mosaic`
            }
          >
            <ToggleButton
              size="small"
              value="mosaic"
              selected={satelliteMode === 'mosaic'}
              aria-label={t`Mosaic`}
              aria-pressed={satelliteMode === 'mosaic'}
              sx={{ gap: 0.75 }}
              onClick={() => {
                if (satelliteMode === 'scene') onSatellitePaneOpenChange(false);
                toggleMosaicMode();
              }}
            >
              <GridViewOutlinedIcon
                sx={{ fontSize: 20, transform: 'translateY(-1px)' }}
              />
              <Trans>Mosaic</Trans>
            </ToggleButton>
          </Tooltip>
        ) : null}
        {activeTab === 'markers' ? (
          <Stack
            direction="row"
            spacing={compactMarkersHeader ? 0.5 : 1}
            sx={{
              alignItems: 'center',
              minWidth: 0,
              gridColumn: compactMarkersHeader ? '1 / -1' : undefined,
              gridRow: compactMarkersHeader ? 2 : undefined,
              ml: compactMarkersHeader ? '0 !important' : undefined,
            }}
          >
            <Tooltip
              title={
                !weatherPreferencesReady
                  ? t`Loading marker weather settings`
                  : weatherPreferences.weekdays.length === 0
                    ? t`Marker weather is disabled`
                    : t`Marker weather settings`
              }
            >
              <Button
                size="small"
                color={weatherPreferences.weekdays.length === 0 ? 'inherit' : 'primary'}
                disabled={!weatherPreferencesReady}
                aria-label={markerWeatherSettingsLabel}
                startIcon={<WbCloudyOutlinedIcon sx={{ fontSize: 20 }} />}
                sx={{
                  minWidth: 0,
                  px: compactMarkersHeader ? 0 : 1,
                  whiteSpace: 'nowrap',
                  '& .MuiButton-startIcon': compactMarkersHeader
                    ? { ml: 0, mr: 0.75 }
                    : undefined,
                }}
                onClick={openWeatherSettings}
              >
                {weatherPreferencesReady ? markerWeatherWeekdayLabel : ''}
              </Button>
            </Tooltip>
            {compactMarkersHeader ? <Box aria-hidden sx={{ flex: 1 }} /> : null}
            <Tooltip
              title={
                canCreateMarkers ? t`Place a marker on the map` : markerCreationMessage
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
                  <Trans>New marker</Trans>
                </Button>
              </span>
            </Tooltip>
            <MarkerSortControl onMarkerSortChange={onMarkerSortChange} />
          </Stack>
        ) : activeTab === 'tracks' ? (
          <>
            <Tooltip
              title={
                multiTrackMode
                  ? t`Exit multi-track selection`
                  : t`Select multiple tracks`
              }
            >
              <ToggleButton
                size="small"
                value="multi-track"
                aria-label={t`Select multiple tracks`}
                selected={multiTrackMode}
                onClick={() => {
                  void toggleMultiTrackMode();
                }}
              >
                <PlaylistAddCheckOutlinedIcon sx={{ fontSize: 20 }} />
              </ToggleButton>
            </Tooltip>
            <Tooltip
              title={
                trailRouter === null
                  ? t`Route planning is unavailable because map routing data is not configured`
                  : t`Plan a route on the map`
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
                  <Trans>Plan route</Trans>
                </Button>
              </span>
            </Tooltip>
            <TrackSortControl onTrackSortChange={onTrackSortChange} />
          </>
        ) : null}
        {fullWidth ? (
          <IconButton
            aria-label={t`Show map`}
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
