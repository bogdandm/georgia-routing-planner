import { useLingui } from '@lingui/react/macro';
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import {
  Alert,
  Box,
  Button,
  Paper,
  Popover,
  Slide,
  Snackbar,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import type {
  Map as MapLibreMap,
  MapLayerMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Map, {
  GeolocateControl,
  NavigationControl,
  Marker,
  type MapRef,
} from 'react-map-gl/maplibre';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  defaultMapSharePreferences,
  type MapSharePreferences,
} from '@/application/map/MapSharePreferences';
import type { MapViewState } from '@/application/ports/MapCameraRepository';
import type {
  MapFacade,
  MapInteractionMode,
  MapViewportMovement,
  PlanningPreview,
} from '@/presentation/map/MapFacade';
import { MapLibreFacade } from '@/presentation/map/MapLibreFacade';
import { SettledCameraPersistence } from '@/presentation/map/SettledCameraPersistence';
import {
  MapViewControls,
  MapViewControlsControl,
  type TerrainControlState,
} from '@/presentation/map/MapViewControls';
import { useSatelliteMode } from '@/presentation/satellite-browser/SatelliteMosaicProvider';
import { createHikingMapStyle } from '@/presentation/map/mapStyleFactory';
import {
  defaultGeorgiaCamera,
  type MapCamera,
  type MapCoordinate,
  type MapFitPadding,
  type MapLayerPreset,
  type MapPointInspection,
} from '@/presentation/map/mapTypes';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import {
  cancelMarkerPlacement,
  cancelWeatherPointSelection,
  completeMarkerPlacement,
  completeWeatherPointSelection,
  consumeMapFitBoundsCommand,
  consumeMapNavigationCommand,
  consumeMapPointInspectionCommand,
  mapInteractionStore,
  openMapShare,
  requestMarkerCreationAt,
  requestSatelliteSearch,
  requestWeatherForecast,
  setRenderBenchmarkState,
  type WeatherMapForecastMarker,
} from '@/presentation/map/mapInteractionStore';
import {
  applySharedMapView,
  createMapShareUrl,
  parseSharedComparison,
  parseSharedMapView,
  parseWeatherMapUrlState,
  readShareableMapState,
  satelliteBasemaps,
  selectMapShareView,
  updateWeatherMapUrl,
} from '@/presentation/map/mapShareUrl';
import { useUiStore, type WorkspaceTab } from '@/presentation/shell/uiStore';
import {
  closeComparison,
  isComparisonOpen,
  maximumComparedScenes,
  minimumComparedScenes,
  openComparison,
  openSharedComparison,
  reopenComparison,
  restorePreferredComparisonLayout,
  satelliteCompareStore,
} from '@/presentation/satellite-browser/satelliteCompareStore';
import {
  comparisonHash,
  isComparisonHash,
  workspaceHashForTab,
  workspaceTabFromHash,
} from '@/presentation/shell/workspaceTabLocation';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { ElevationGradeLegend } from '@/presentation/map/ElevationGradeLegend';
import {
  MarkerWeatherSummaryButton,
  useOptionalMarkersWorkspace,
} from '@/presentation/markers/MarkersWorkspace';
import {
  MapPointActionList,
  MapPointInspectorContent,
  type MapPointAction,
} from '@/presentation/map/MapPointInspectorContent';
import { useOptionalTracksWorkspace } from '@/presentation/tracks/TracksWorkspace';
import { parseTrackShareLocation } from '@/presentation/tracks/trackShareUrl';
import { MonochromeWeatherPeriodIcon } from '@/presentation/weather/WeatherConditionIcon';
import { WeatherTimeControl } from '@/presentation/weather/WeatherTimeControl';
import {
  formatWeatherMillimetres,
  formatWeatherTemperatureRange,
} from '@/presentation/weather/weatherFormatters';

interface MapWorkspaceProps {
  readonly facade?: MapFacade;
  readonly mapCanvas?: ReactNode | ((initialCamera: MapCamera) => ReactNode);
  readonly cameraRestoreTimeoutMs?: number;
  readonly terrainRetryDelaysMs?: readonly number[];
  readonly getNavigationPadding?: () => MapFitPadding | undefined;
  readonly onElevationGradeLegendDismissedChange?: (dismissed: boolean) => void;
}

const unavailableMapStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

const cameraRestoreTimeoutMs = 2_000;
const terrainRetryDelaysMs = [1_000, 3_000] as const;
/**
 * MapLibre's drag-pan inertia covering the same distance in half the time. Its coast
 * lasts velocity / deceleration and covers velocity² × linearity / (2 × deceleration),
 * so doubling deceleration, linearity, and the speed cap halves only the duration.
 */
const dragPanInertia = {
  linearity: 0.6,
  deceleration: 5_000,
  maxSpeed: 2_800,
} as const;

type MapWorkspaceNotice =
  | 'camera-save-failed'
  | 'camera-restore-failed'
  | 'shared-scene-restore-failed'
  | 'shared-comparison-restore-failed';
type CopyConfirmation = 'coordinates' | 'link' | 'weather-link';
type OpenMapPointInspection = Exclude<MapPointInspection, { status: 'closed' }>;

function WeatherForecastMapMarker({
  marker,
}: {
  readonly marker: WeatherMapForecastMarker;
}) {
  const { i18n, t } = useLingui();
  const temperature = formatWeatherTemperatureRange(
    marker.period.temperatureMinCelsius,
    marker.period.temperatureMaxCelsius,
    i18n,
  );
  const precipitation = formatWeatherMillimetres(marker.period.precipitationMm, i18n);
  const label = t`Current weather: ${temperature}, ${precipitation} precipitation`;
  return (
    <Marker
      longitude={marker.coordinate.longitude}
      latitude={marker.coordinate.latitude}
      anchor="bottom"
    >
      <Box
        role="img"
        aria-label={label}
        sx={{
          display: 'flex',
          minWidth: 64,
          flexDirection: 'column',
          alignItems: 'center',
          px: 0.75,
          pt: 0.5,
          pb: 0.75,
          pointerEvents: 'none',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          bgcolor: 'rgba(255, 255, 255, 0.94)',
          boxShadow: 3,
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: 48,
            height: 40,
            flexShrink: 0,
            overflow: 'hidden',
            '& > img': {
              position: 'absolute',
              top: -8,
              left: '50%',
              transform: 'translateX(-50%)',
            },
          }}
        >
          <MonochromeWeatherPeriodIcon
            icon={marker.period.status.primary.icon}
            visibility={marker.period.status.visibility}
            isDay={marker.isDay}
            size={56}
          />
        </Box>
        <Stack spacing={0.25} sx={{ alignItems: 'center', whiteSpace: 'nowrap' }}>
          <Typography
            variant="body2"
            sx={{
              color: 'grey.900',
              fontWeight: 700,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {temperature}
          </Typography>
          <Stack
            direction="row"
            spacing={0.25}
            sx={{ alignItems: 'center', color: 'info.dark' }}
          >
            <WaterDropOutlinedIcon
              aria-hidden="true"
              sx={{ fontSize: 13, color: 'inherit' }}
            />
            <Typography
              variant="caption"
              sx={{
                color: 'inherit',
                fontWeight: 600,
                lineHeight: 1.2,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {precipitation}
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </Marker>
  );
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

async function loadMapViewWithDeadline(
  load: () => Promise<MapViewState | null>,
  timeoutMs: number,
): Promise<MapViewState | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Map camera restoration timed out.'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/** Consumes a one-shot map command even when running it throws. */
function runThenConsume(run: () => void, consume: () => void): void {
  try {
    run();
  } finally {
    consume();
  }
}

/**
 * Coordinates React-visible map states while delegating all native MapLibre lifecycle
 * work to `MapFacade`. The map mounts only after camera restoration settles or expires.
 */
export function MapWorkspace({
  facade: suppliedFacade,
  mapCanvas,
  cameraRestoreTimeoutMs: restoreTimeoutMs = cameraRestoreTimeoutMs,
  terrainRetryDelaysMs: retryDelaysMs = terrainRetryDelaysMs,
  getNavigationPadding,
  onElevationGradeLegendDismissedChange,
}: MapWorkspaceProps) {
  const { t } = useLingui();
  const {
    database,
    logger,
    elevationProvider,
    mapCameraRepository,
    mapDiagnostics,
    mapLayers,
    mapProviderConfiguration,
    mapViewport,
    satelliteCatalogGateway,
    idGenerator,
  } = useRuntimeServices();
  const satelliteMode = useSatelliteMode();
  const mosaicActive = satelliteMode === 'mosaic';
  const sharedMapView = useMemo(() => parseSharedMapView(window.location.search), []);
  const sharedComparison = useMemo(
    () => parseSharedComparison(window.location.search),
    [],
  );
  const sharedWeatherMap = useMemo(
    () => parseWeatherMapUrlState(window.location.search),
    [],
  );
  const [restoredView, setRestoredView] = useState<MapViewState | null>(null);
  // Cleared by a direct 2D/3D choice or Mosaic so a restored 3D view cannot override it.
  const [startupTerrainIntentActive, setStartupTerrainIntentActive] = useState(true);
  const [sharedSceneToApply, setSharedSceneToApply] = useState<SatelliteScene | null>(
    null,
  );
  // Set once the startup 3D intent is started or superseded by Mosaic.
  const startupTerrainConsumed = useRef(false);
  const sharedSceneApplyController = useRef<AbortController | null>(null);
  const sharedSceneRestorationCancelled = useRef(false);
  const sharedWeatherMapRestoreRequested = useRef(false);
  const sharedBasemapRestoreRequested = useRef(false);
  const [sharedWeatherMapRestoreComplete, setSharedWeatherMapRestoreComplete] =
    useState(() => sharedWeatherMap === null);
  const [cameraNotice, setCameraNotice] = useState<MapWorkspaceNotice | null>(null);
  const [terrainCommandState, setTerrainCommandState] = useState<Exclude<
    TerrainControlState,
    'flat' | 'terrain'
  > | null>(null);
  const terrainCommandAbort = useRef<AbortController | null>(null);
  const terrainCommandTail = useRef<Promise<void>>(Promise.resolve());
  const [online, setOnline] = useState(() => navigator.onLine);
  // `null` while the ruler is off; an empty list means it waits for the first click.
  const [measurementPoints, setMeasurementPoints] = useState<
    readonly TrackCoordinate[] | null
  >(null);
  const measurementActive = measurementPoints !== null;
  const [contextMenu, setContextMenu] = useState<{
    readonly mouseX: number;
    readonly mouseY: number;
    readonly coordinate: MapCoordinate;
  } | null>(null);
  const [copyConfirmation, setCopyConfirmation] = useState<CopyConfirmation | null>(
    null,
  );
  const [copyError, setCopyError] = useState(false);
  const [layerChangeFailed, setLayerChangeFailed] = useState(false);
  const smartphoneViewport = useMediaQuery('(width < 900px)');
  // Touch-first devices have no reliable right click, so the tap popup carries the actions.
  const touchPointer = useMediaQuery('(pointer: coarse)');
  const navigationCommand = useStore(
    mapInteractionStore,
    (state) => state.navigationCommand,
  );
  const markerPlacement = useStore(
    mapInteractionStore,
    (state) => state.markerPlacement,
  );
  const weatherPointSelectionActive = useStore(
    mapInteractionStore,
    (state) => state.weatherPointSelectionActive,
  );
  const selectedWeatherForecastPoint = useStore(
    mapInteractionStore,
    (state) => state.selectedWeatherForecastPoint,
  );
  const weatherMapForecastMarker = useStore(
    mapInteractionStore,
    (state) => state.weatherMapForecastMarker,
  );
  const terrainComputeStatus = useStore(
    mapLayerStore,
    (state) => state.terrainComputeStatus,
  );
  const elevationGradientVisible = useStore(
    mapLayerStore,
    (state) =>
      state.visibility['imported-tracks'] &&
      state.visibility['track-elevation-gradient'],
  );
  const googleSatelliteVisible = useStore(
    mapLayerStore,
    (state) => state.visibility['google-satellite'],
  );
  const bingSatelliteVisible = useStore(
    mapLayerStore,
    (state) => state.visibility['bing-satellite'],
  );
  const esriSatelliteVisible = useStore(
    mapLayerStore,
    (state) => state.visibility['esri-satellite'],
  );
  const naprOrthophotoVisible = useStore(
    mapLayerStore,
    (state) => state.visibility['napr-orthophoto'],
  );
  const sovietTopographicVisible = useStore(
    mapLayerStore,
    (state) => state.visibility['soviet-topographic'],
  );
  const satelliteImagerySelected = useStore(
    mapLayerStore,
    (state) => state.visibility['satellite-imagery'],
  );
  const openStreetMapOpacity = useStore(
    mapLayerStore,
    (state) => state.openStreetMapOpacity,
  );
  const appliedImagery = useStore(mapLayerStore, (state) => state.appliedImagery);
  const appliedMosaic = useStore(mapLayerStore, (state) => state.appliedMosaic);
  const weatherMap = useStore(mapLayerStore, (state) => state.weatherMap);
  const tracksWorkspace = useOptionalTracksWorkspace();
  const markersWorkspace = useOptionalMarkersWorkspace();
  const activeTab = useUiStore((state) => state.activeTab);
  const activeProfile = tracksWorkspace?.activeProfile ?? null;
  const editablePath =
    activeTab === 'tracks' &&
    tracksWorkspace !== null &&
    tracksWorkspace.activePath !== null &&
    tracksWorkspace.activePath.status !== 'saving'
      ? tracksWorkspace.activePath
      : null;
  // Clicks place points while a plan is open or a saved track moves or adds a point;
  // otherwise an edited track's clicks select its nearest point.
  const routePlanningActive =
    editablePath !== null &&
    (editablePath.movingAnchorId !== null || editablePath.insertion !== null);
  const trackEditingActive = editablePath !== null && !routePlanningActive;
  // An enabled weather map yields clicks to the ruler; a one-shot weather pick does not.
  const weatherOwnsMapClicks =
    weatherPointSelectionActive || (weatherMap.enabled && !measurementActive);
  const placePathPoint = tracksWorkspace?.placePathPoint;
  const selectPathPointNear = tracksWorkspace?.selectPathPointNear;
  const hoverPathPointNear = tracksWorkspace?.hoverPathPointNear;
  const insertionAnchorId = editablePath?.insertion?.afterAnchorId ?? null;
  const routePlanPreviewAnchor =
    editablePath === null ||
    !routePlanningActive ||
    editablePath.movingAnchorId !== null
      ? null
      : ((insertionAnchorId === null
          ? editablePath.path.anchors[0]
          : editablePath.path.anchors.find((anchor) => anchor.id === insertionAnchorId)
        )?.point.coordinate ?? null);
  const planningPreview = useMemo((): PlanningPreview | null => {
    if (measurementPoints === null) {
      return routePlanPreviewAnchor === null
        ? null
        : {
            anchor: {
              longitude: routePlanPreviewAnchor[0],
              latitude: routePlanPreviewAnchor[1],
            },
          };
    }
    const [origin] = measurementPoints;
    const anchor = measurementPoints.at(-1);
    if (origin === undefined || anchor === undefined) return null;
    let distanceMeters = 0;
    for (let index = 1; index < measurementPoints.length; index += 1) {
      const start = measurementPoints[index - 1];
      const end = measurementPoints[index];
      if (start !== undefined && end !== undefined) {
        distanceMeters += geodesicDistanceMeters(start, end);
      }
    }
    return {
      anchor: { longitude: anchor[0], latitude: anchor[1] },
      measurement: {
        origin: { longitude: origin[0], latitude: origin[1] },
        distanceMeters,
      },
    };
  }, [measurementPoints, routePlanPreviewAnchor]);
  const fitBoundsCommand = useStore(
    mapInteractionStore,
    (state) => state.fitBoundsCommand,
  );
  const pointInspectionCommand = useStore(
    mapInteractionStore,
    (state) => state.pointInspectionCommand,
  );
  const renderBenchmarkStatus = useStore(
    mapInteractionStore,
    (state) => state.renderBenchmark.status,
  );
  const developerMode = useUiStore((state) => state.developerMode);
  const elevationGradeLegendDismissed = useUiStore(
    (state) => state.elevationGradeLegendDismissed,
  );
  const setElevationGradeLegendDismissed = useUiStore(
    (state) => state.setElevationGradeLegendDismissed,
  );
  const mapDebugOptions = useUiStore((state) => state.mapDebugOptions);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setMobileWorkspaceOpen = useUiStore((state) => state.setMobileWorkspaceOpen);
  const setNavigationCollapsed = useUiStore((state) => state.setNavigationCollapsed);
  const copyText = useCallback(
    async (value: string, confirmation: CopyConfirmation) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopyConfirmation(confirmation);
        setCopyError(false);
      } catch {
        setCopyError(true);
      }
    },
    [],
  );
  const openWorkspaceTab = useCallback(
    (tab: WorkspaceTab) => {
      setActiveTab(tab);
      setMobileWorkspaceOpen(true);
      setNavigationCollapsed(false);
      const hash = workspaceHashForTab(tab);
      if (window.location.hash === hash) return;
      const nextUrl = new URL(window.location.href);
      nextUrl.hash = hash;
      window.history.pushState(window.history.state, '', nextUrl);
    },
    [setActiveTab, setMobileWorkspaceOpen, setNavigationCollapsed],
  );
  const cameraPersistence = useMemo(
    () =>
      new SettledCameraPersistence(mapCameraRepository, logger, () => {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Notice code.
        setCameraNotice('camera-save-failed');
      }),
    [logger, mapCameraRepository],
  );
  const facade = useMemo(
    () =>
      suppliedFacade ??
      new MapLibreFacade(
        logger,
        (view) => {
          cameraPersistence.schedule(view);
        },
        mapProviderConfiguration.status === 'valid'
          ? {
              terrain: mapProviderConfiguration.value.terrain,
              sourceLayers: {
                peaks: mapProviderConfiguration.value.vector.sourceLayers.peaks,
                places: mapProviderConfiguration.value.vector.sourceLayers.places,
                pois: mapProviderConfiguration.value.vector.sourceLayers.pois,
                waterNames:
                  mapProviderConfiguration.value.vector.sourceLayers.waterNames,
              },
              requestTimeoutMs: mapProviderConfiguration.value.policy.requestTimeoutMs,
              equivalentErrorWindowMs:
                mapProviderConfiguration.value.policy.equivalentErrorWindowMs,
            }
          : undefined,
        mapDiagnostics,
        mapLayers ?? undefined,
        elevationProvider ?? undefined,
      ),
    [
      cameraPersistence,
      logger,
      mapDiagnostics,
      mapLayers,
      elevationProvider,
      mapProviderConfiguration,
      suppliedFacade,
    ],
  );
  const subscribe = useCallback(
    (listener: () => void) => facade.subscribe(listener),
    [facade],
  );
  const getSnapshot = useCallback(() => facade.getDiagnosticsSnapshot(), [facade]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const getPointInspection = useCallback(() => facade.getPointInspection(), [facade]);
  const pointInspection = useSyncExternalStore(
    subscribe,
    getPointInspection,
    getPointInspection,
  );
  // The touch sheet keeps rendering the last open inspection while it slides out.
  const [sheetInspection, setSheetInspection] = useState<OpenMapPointInspection | null>(
    null,
  );
  const sheetOpen = touchPointer && pointInspection.status === 'open';
  if (sheetOpen && pointInspection !== sheetInspection) {
    setSheetInspection(pointInspection);
  }
  const sheetRef = useRef<HTMLDivElement>(null);
  // A new coordinate object means a new inspection; loading updates keep the object.
  const sheetCoordinate = sheetOpen ? pointInspection.coordinate : null;
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const startupTerrainRequested = restoredView?.terrainMode === 'terrain';
  const terrainState: TerrainControlState =
    terrainCommandState ??
    (mosaicActive
      ? 'flat'
      : startupTerrainRequested &&
          startupTerrainIntentActive &&
          snapshot.lifecycle === 'loading'
        ? 'terrain'
        : snapshot.terrainMode);
  const singleSceneImageryVisible =
    appliedImagery.status === 'preview' || appliedImagery.status === 'ready'
      ? true
      : (appliedImagery.status === 'loading' || appliedImagery.status === 'failed') &&
        appliedImagery.previousSceneKey !== null;
  const mosaicImageryAvailable =
    appliedMosaic.status !== 'empty' && appliedMosaic.sceneKeys.length > 0;
  const satelliteImageryVisible =
    singleSceneImageryVisible || (satelliteImagerySelected && mosaicImageryAvailable);
  let activeLayerPreset: MapLayerPreset | null = null;
  if (
    !googleSatelliteVisible &&
    !bingSatelliteVisible &&
    !esriSatelliteVisible &&
    !naprOrthophotoVisible &&
    !sovietTopographicVisible &&
    !satelliteImageryVisible
  ) {
    /* eslint-disable lingui/no-unlocalized-strings -- Layer preset IDs. */
    activeLayerPreset = 'vector-osm';
  } else if (googleSatelliteVisible) {
    activeLayerPreset = 'google-satellite';
  } else if (bingSatelliteVisible) {
    activeLayerPreset = 'bing-satellite';
  } else if (esriSatelliteVisible) {
    activeLayerPreset = 'esri-satellite';
  } else if (naprOrthophotoVisible) {
    activeLayerPreset = 'napr-orthophoto';
  } else if (sovietTopographicVisible) {
    activeLayerPreset = 'soviet-topographic';
  } else if (satelliteImagerySelected && satelliteImageryVisible) {
    activeLayerPreset = 'sentinel-2';
    /* eslint-enable lingui/no-unlocalized-strings */
  }
  const layerPresetDisabled =
    mapLayers === null ||
    snapshot.lifecycle === 'loading' ||
    snapshot.lifecycle === 'fatal';

  useEffect(() => {
    const basemap = sharedMapView?.basemap ?? null;
    if (
      basemap === null ||
      sharedBasemapRestoreRequested.current ||
      snapshot.lifecycle !== 'ready' ||
      mapLayers === null
    ) {
      return;
    }
    // The shared basemap replaces the stored choice like a quick layer-chooser click, so
    // it waits for stored layer preferences to load first. The controller records a
    // failure as the Layers panel problem.
    sharedBasemapRestoreRequested.current = true;
    void mapLayers.restorePersistedState().then(() => {
      mapLayers.setMapLayerPreset(basemap);
    });
  }, [mapLayers, sharedMapView, snapshot.lifecycle]);

  useEffect(() => {
    if (
      sharedWeatherMap === null ||
      sharedWeatherMapRestoreRequested.current ||
      snapshot.lifecycle !== 'ready' ||
      mapLayers === null
    ) {
      return;
    }
    sharedWeatherMapRestoreRequested.current = true;
    if (sharedWeatherMap.coordinate !== null) {
      requestWeatherForecast(sharedWeatherMap.coordinate);
    }
    const requestedTime =
      sharedWeatherMap.validTime === null
        ? new Date()
        : new Date(sharedWeatherMap.validTime);
    void mapLayers.setWeatherEnabled(true, requestedTime).finally(() => {
      setSharedWeatherMapRestoreComplete(true);
    });
  }, [mapLayers, sharedWeatherMap, snapshot.lifecycle]);

  useEffect(() => {
    if (!sharedWeatherMapRestoreComplete) return;
    const selectedTime =
      weatherMap.selectedTimeIndex === null
        ? (sharedWeatherMap?.validTime ?? null)
        : (weatherMap.validTimes[weatherMap.selectedTimeIndex] ?? null);
    const nextUrl = updateWeatherMapUrl(
      window.location.href,
      weatherMap.enabled
        ? {
            coordinate: selectedWeatherForecastPoint?.coordinate ?? null,
            validTime: selectedTime,
          }
        : null,
    );
    if (nextUrl !== window.location.href) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }, [
    selectedWeatherForecastPoint,
    sharedWeatherMap,
    sharedWeatherMapRestoreComplete,
    weatherMap.enabled,
    weatherMap.selectedTimeIndex,
    weatherMap.validTimes,
  ]);

  useEffect(() => {
    // Viewport changes only when the camera settles; the facade emits one settle when
    // the style is ready, after every moveend, and after terrain transitions. Generic facade
    // notifications (idle, styledata, inspection) must not republish it.
    const publishMovement = (event: MapViewportMovement) => {
      if (event.phase === 'moving') {
        mapViewport.markMoving();
        return;
      }
      mapViewport.update(event.viewport);
      mapViewport.settle(event.viewport);
    };
    mapViewport.update(facade.getViewportSnapshot());
    const unsubscribeMovement = facade.subscribeViewportMovement(publishMovement);
    return () => {
      unsubscribeMovement();
      mapViewport.update(null);
      mapViewport.clearMovement();
    };
  }, [facade, mapViewport]);

  // Declared before the camera effects: in the commit that mounts the sheet for a
  // search, its height must become camera padding before the held move starts.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheetCoordinate === null || sheet === null) return;
    // offsetHeight ignores the Slide transform, so the entering sheet reports its full height.
    facade.revealPointInspection(sheet.offsetHeight);
  }, [facade, sheetCoordinate]);

  // On touch, a search's camera move waits until its inspection sheet has rendered, so
  // one move can land with the point above the sheet instead of panning afterwards.
  const cameraWaitsForSheet = touchPointer && pointInspectionCommand !== null;
  useEffect(() => {
    if (navigationCommand === null || cameraWaitsForSheet) return;
    runThenConsume(
      () => {
        facade.navigateTo(navigationCommand.target, getNavigationPadding?.());
      },
      () => {
        consumeMapNavigationCommand(navigationCommand.id);
      },
    );
  }, [cameraWaitsForSheet, facade, getNavigationPadding, navigationCommand]);
  // A terrain transition ends by jumping back to the camera it started from, so a fit
  // waits for it, including a restored or shared 3D view that has not entered terrain
  // yet. In 3D the fit then also faces along the track. The startup intent only starts
  // on a ready map, so a degraded map fits in 2D instead of waiting.
  const terrainTransitionPending =
    terrainCommandState === 'enabling' ||
    terrainCommandState === 'disabling' ||
    (startupTerrainRequested &&
      startupTerrainIntentActive &&
      !mosaicActive &&
      snapshot.lifecycle === 'ready' &&
      snapshot.terrainMode !== 'terrain');
  useEffect(() => {
    if (
      fitBoundsCommand === null ||
      snapshot.lifecycle === 'loading' ||
      cameraWaitsForSheet ||
      terrainTransitionPending
    ) {
      return;
    }
    runThenConsume(
      () => {
        facade.fitBounds(
          fitBoundsCommand.bounds,
          fitBoundsCommand.maxZoom,
          fitBoundsCommand.padding ?? getNavigationPadding?.(),
          fitBoundsCommand.path,
        );
      },
      () => {
        consumeMapFitBoundsCommand(fitBoundsCommand.id);
      },
    );
  }, [
    cameraWaitsForSheet,
    facade,
    fitBoundsCommand,
    getNavigationPadding,
    snapshot.lifecycle,
    terrainTransitionPending,
  ]);

  useEffect(() => {
    if (pointInspectionCommand === null || snapshot.lifecycle === 'loading') return;
    const currentInspection = facade.getPointInspection();
    if (
      currentInspection.status === 'open' &&
      currentInspection.coordinate.longitude ===
        pointInspectionCommand.coordinate.longitude &&
      currentInspection.coordinate.latitude ===
        pointInspectionCommand.coordinate.latitude
    ) {
      consumeMapPointInspectionCommand(pointInspectionCommand.id);
      return;
    }
    facade.openPointInspection(pointInspectionCommand.coordinate, {
      refreshNearbyPoiOnIdle: pointInspectionCommand.refreshNearbyPoiOnIdle,
    });
    consumeMapPointInspectionCommand(pointInspectionCommand.id);
  }, [facade, pointInspectionCommand, snapshot.lifecycle]);

  useEffect(() => {
    facade.setPointInspectionPopupEnabled(!touchPointer);
    facade.setCursorPreviewEnabled(!touchPointer);
  }, [facade, touchPointer]);

  useEffect(() => {
    const mode: MapInteractionMode =
      markerPlacement !== null
        ? 'marker-placement'
        : weatherOwnsMapClicks
          ? 'weather-point-selection'
          : measurementActive
            ? 'measurement'
            : routePlanningActive
              ? 'route-planning'
              : trackEditingActive
                ? 'track-editing'
                : 'default';
    facade.setInteractionMode(mode);
    if (mode !== 'default' && mode !== 'marker-placement') {
      facade.closePointInspection();
    }
    return () => {
      facade.setInteractionMode('default');
    };
  }, [
    facade,
    markerPlacement,
    measurementActive,
    routePlanningActive,
    trackEditingActive,
    weatherOwnsMapClicks,
  ]);

  useEffect(() => {
    if (
      !routePlanningActive ||
      weatherOwnsMapClicks ||
      measurementActive ||
      placePathPoint === undefined
    ) {
      return undefined;
    }
    return facade.subscribePlanningClicks((coordinate) => {
      placePathPoint([coordinate.longitude, coordinate.latitude]);
    });
  }, [
    facade,
    measurementActive,
    placePathPoint,
    routePlanningActive,
    weatherOwnsMapClicks,
  ]);

  useEffect(() => {
    if (!trackEditingActive || selectPathPointNear === undefined) return undefined;
    return facade.subscribeTrackPointClicks(selectPathPointNear);
  }, [facade, selectPathPointNear, trackEditingActive]);

  useEffect(() => {
    if (!trackEditingActive || hoverPathPointNear === undefined) return undefined;
    const unsubscribe = facade.subscribeTrackPointHover(hoverPathPointNear);
    return () => {
      unsubscribe();
      hoverPathPointNear(null);
    };
  }, [facade, hoverPathPointNear, trackEditingActive]);

  useEffect(() => {
    if (!measurementActive) return undefined;
    return facade.subscribePlanningClicks((coordinate) => {
      setMeasurementPoints((current) =>
        current === null
          ? null
          : [...current, [coordinate.longitude, coordinate.latitude]],
      );
    });
  }, [facade, measurementActive]);

  useEffect(() => {
    if (mapLayers === null || measurementPoints === null) return undefined;
    mapLayers.setPlannedLineGeometry(
      'measurement',
      measurementPoints.length < 2
        ? []
        : [{ kind: 'direct', coordinates: measurementPoints }],
      measurementPoints,
    );
    return () => {
      mapLayers.clearPlannedLineGeometry('measurement');
    };
  }, [mapLayers, measurementPoints]);

  useEffect(() => {
    facade.setPlanningPreview(planningPreview);
    return () => {
      facade.setPlanningPreview(null);
    };
  }, [facade, planningPreview]);

  useEffect(() => {
    return () => {
      cancelMarkerPlacement();
      cancelWeatherPointSelection();
    };
  }, []);

  useEffect(() => {
    if (markerPlacement === null && !weatherPointSelectionActive) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelMarkerPlacement();
      cancelWeatherPointSelection();
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => {
      window.removeEventListener('keydown', cancelOnEscape);
    };
  }, [markerPlacement, weatherPointSelectionActive]);
  const mapStyle = useMemo(() => {
    if (mapProviderConfiguration.status !== 'valid') return unavailableMapStyle;
    return createHikingMapStyle(mapProviderConfiguration.value);
  }, [mapProviderConfiguration]);

  // MapLibre takes its UI strings from the `locale` option when the map is created and
  // writes them into the native controls once. A language switch patches the locale
  // table (read again on later geolocation state changes) and relabels the existing
  // controls in place, so they keep their state, such as the shown user location.
  const nativeMap = useRef<MapLibreMap | null>(null);
  const mapLibreLocale = useMemo(
    () => ({
      'AttributionControl.ToggleAttribution': t`Toggle attribution`,
      'GeolocateControl.FindMyLocation': t`Find my location`,
      'GeolocateControl.LocationNotAvailable': t`Location not available`,
      'Map.Title': t`Map`,
      'NavigationControl.ResetBearing': t`Drag to rotate map, click to reset north`,
      'NavigationControl.ZoomIn': t`Zoom in`,
      'NavigationControl.ZoomOut': t`Zoom out`,
    }),
    [t],
  );
  useEffect(() => {
    const map = nativeMap.current;
    if (map === null) return;
    Object.assign(map._locale, mapLibreLocale);
    /* eslint-disable lingui/no-unlocalized-strings -- DOM attribute names and MapLibre control selectors. */
    map.getCanvas().setAttribute('aria-label', mapLibreLocale['Map.Title']);
    const container = map.getContainer();
    const relabel = (selector: string, label: string) => {
      for (const button of container.querySelectorAll<HTMLElement>(selector)) {
        button.title = label;
        button.setAttribute('aria-label', label);
      }
    };
    relabel('.maplibregl-ctrl-zoom-in', mapLibreLocale['NavigationControl.ZoomIn']);
    relabel('.maplibregl-ctrl-zoom-out', mapLibreLocale['NavigationControl.ZoomOut']);
    relabel(
      '.maplibregl-ctrl-compass',
      mapLibreLocale['NavigationControl.ResetBearing'],
    );
    relabel(
      '.maplibregl-ctrl-attrib-button',
      mapLibreLocale['AttributionControl.ToggleAttribution'],
    );
    relabel(
      '.maplibregl-ctrl-geolocate:not(:disabled)',
      mapLibreLocale['GeolocateControl.FindMyLocation'],
    );
    relabel(
      '.maplibregl-ctrl-geolocate:disabled',
      mapLibreLocale['GeolocateControl.LocationNotAvailable'],
    );
    /* eslint-enable lingui/no-unlocalized-strings */
  }, [mapLibreLocale]);

  const handleMapRef = useCallback(
    (mapRef: MapRef | null) => {
      nativeMap.current = mapRef?.getMap() ?? null;
      if (!(facade instanceof MapLibreFacade)) return;
      if (mapRef === null) {
        facade.detachMap();
        return;
      }
      facade.attach(mapRef.getMap());
    },
    [facade],
  );

  const handleTerrainModeChange = useCallback(
    (mode: 'flat' | 'terrain') => {
      terrainCommandAbort.current?.abort();
      const commandAbort = new AbortController();
      terrainCommandAbort.current = commandAbort;
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Terrain command state.
      setTerrainCommandState(mode === 'terrain' ? 'enabling' : 'disabling');
      const attemptDelays = mode === 'terrain' ? [0, ...retryDelaysMs] : [0];

      const run = async () => {
        for (const delayMs of attemptDelays) {
          if (delayMs > 0) await waitForRetry(delayMs, commandAbort.signal);
          if (terrainCommandAbort.current !== commandAbort) return;
          try {
            const result = await facade.setTerrainMode(mode);
            if (terrainCommandAbort.current !== commandAbort) return;
            if (result.status === 'success') {
              terrainCommandAbort.current = null;
              setTerrainCommandState(null);
              return;
            }
          } catch {
            if (terrainCommandAbort.current !== commandAbort) return;
          }
        }

        terrainCommandAbort.current = null;
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Terrain command state.
        setTerrainCommandState('failed');
      };
      const command = terrainCommandTail.current.then(run, run);
      terrainCommandTail.current = command;
      return command;
    },
    [facade, retryDelaysMs],
  );

  const handleTerrainControlChange = useCallback(
    (mode: 'flat' | 'terrain') => {
      if (mosaicActive && mode === 'terrain') return;
      // A direct user choice supersedes the restored or shared startup view, including
      // while MapLibre is still loading and its diagnostics snapshot remains stale.
      setStartupTerrainIntentActive(false);
      cameraPersistence.setStartupTerrainPending(false);
      void handleTerrainModeChange(mode);
    },
    [cameraPersistence, handleTerrainModeChange, mosaicActive],
  );

  useEffect(() => {
    if (!mosaicActive) return;
    let active = true;
    startupTerrainConsumed.current = true;
    cameraPersistence.setStartupTerrainPending(false);
    queueMicrotask(() => {
      if (!active) return;
      setStartupTerrainIntentActive(false);
      void handleTerrainModeChange('flat');
    });
    return () => {
      active = false;
    };
  }, [cameraPersistence, handleTerrainModeChange, mosaicActive]);

  useEffect(() => {
    if (
      !startupTerrainRequested ||
      mosaicActive ||
      !startupTerrainIntentActive ||
      startupTerrainConsumed.current ||
      snapshot.lifecycle !== 'ready' ||
      snapshot.terrainMode === 'terrain'
    ) {
      return;
    }
    // Keep optional DEM tiles out of MapLibre's initial load gate. Once the base map is
    // usable, consume the restored or shared 3D intent through the normal terrain
    // transition so its timeout, retries, cancellation, and flat-map fallback remain
    // authoritative.
    startupTerrainConsumed.current = true;
    void handleTerrainModeChange('terrain').finally(() => {
      cameraPersistence.setStartupTerrainPending(false);
      // Settled either way; a later 2D fallback must not hold fits as a pending intent.
      setStartupTerrainIntentActive(false);
    });
  }, [
    cameraPersistence,
    mosaicActive,
    handleTerrainModeChange,
    startupTerrainRequested,
    startupTerrainIntentActive,
    snapshot.lifecycle,
    snapshot.terrainMode,
  ]);

  useEffect(
    () => () => {
      terrainCommandAbort.current?.abort();
      terrainCommandAbort.current = null;
    },
    [],
  );

  useEffect(() => {
    facade.setDebugOptions(
      developerMode
        ? mapDebugOptions
        : {
            showCollisionBoxes: false,
            showTileBoundaries: false,
            showRouteSearch: false,
          },
    );
    return () => {
      facade.setDebugOptions({
        showCollisionBoxes: false,
        showTileBoundaries: false,
        showRouteSearch: false,
      });
    };
  }, [developerMode, facade, mapDebugOptions]);

  // The developer drawer only requests the benchmark; the map owns running it. The run
  // outlives this effect because its own status updates re-run the effect, so only the
  // current run may write state and the effect below stops it on unmount.
  const renderBenchmarkRun = useRef<AbortController | null>(null);
  useEffect(() => {
    if (renderBenchmarkStatus !== 'requested') return;
    // A map that failed fatally never becomes runnable; degraded maps still render.
    if (snapshot.lifecycle === 'fatal') {
      setRenderBenchmarkState({
        status: 'failed',
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Developer diagnostics are English-only.
        message: 'The map failed to load, so the benchmark cannot run.',
      });
      return;
    }
    if (snapshot.lifecycle === 'loading') return;
    const run = new AbortController();
    renderBenchmarkRun.current = run;
    const isCurrent = () => renderBenchmarkRun.current === run;
    setRenderBenchmarkState({
      status: 'running',
      step: 'settle',
      stepStartedAt: Date.now(),
    });
    facade
      .runRenderBenchmark((step) => {
        if (!isCurrent()) return;
        setRenderBenchmarkState({ status: 'running', step, stepStartedAt: Date.now() });
      }, run.signal)
      .then(
        (report) => {
          if (isCurrent()) setRenderBenchmarkState({ status: 'complete', report });
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          setRenderBenchmarkState({
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      )
      .finally(() => {
        if (isCurrent()) renderBenchmarkRun.current = null;
      });
  }, [facade, renderBenchmarkStatus, snapshot.lifecycle]);
  useEffect(
    () => () => {
      const run = renderBenchmarkRun.current;
      if (run === null) return;
      renderBenchmarkRun.current = null;
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Developer diagnostics are English-only.
      const message = 'The map closed during the benchmark.';
      run.abort(new Error(message));
      setRenderBenchmarkState({ status: 'failed', message });
    },
    [facade],
  );

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
    };
    const handleOffline = () => {
      setOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    // Storage must not be allowed to keep the primary map behind a loader indefinitely.
    void loadMapViewWithDeadline(() => mapCameraRepository.load(), restoreTimeoutMs)
      .then((view) => {
        if (active) {
          // An explicit share URL owns the startup camera and mode over the local view.
          const requestedView: MapViewState =
            sharedMapView === null
              ? (view ?? { camera: defaultGeorgiaCamera, terrainMode: 'flat' })
              : {
                  camera: applySharedMapView(defaultGeorgiaCamera, sharedMapView),
                  terrainMode:
                    sharedMapView.orientation.mode === '3d' ? 'terrain' : 'flat',
                };
          // Mosaic started before storage resolved has already superseded the 3D intent.
          const startupView: MapViewState = startupTerrainConsumed.current
            ? {
                camera: { ...requestedView.camera, bearing: 0, pitch: 0 },
                terrainMode: 'flat',
              }
            : requestedView;
          cameraPersistence.setStartupTerrainPending(
            startupView.terrainMode === 'terrain',
          );
          setRestoredView(startupView);
        }
      })
      .catch(() => {
        if (active) {
          logger.log({ level: 'warn', name: 'storage.map-camera.load-failed' });
          // eslint-disable-next-line lingui/no-unlocalized-strings -- Notice code.
          setCameraNotice('camera-restore-failed');
          setRestoredView({ camera: defaultGeorgiaCamera, terrainMode: 'flat' });
        }
      });

    return () => {
      active = false;
    };
  }, [cameraPersistence, logger, mapCameraRepository, restoreTimeoutMs, sharedMapView]);

  useEffect(() => {
    const shared = sharedMapView;
    // A track link with a scene still opens Tracks to show the shared track.
    if (
      shared?.sceneKey !== null &&
      shared !== null &&
      parseTrackShareLocation(window.location.hash).kind === 'none'
    ) {
      setActiveTab('satellite');
      setNavigationCollapsed(false);
    }
  }, [setActiveTab, setNavigationCollapsed, sharedMapView]);

  useEffect(() => {
    const shared = sharedMapView;
    if (mosaicActive) {
      sharedSceneRestorationCancelled.current = true;
      return;
    }
    if (
      sharedSceneRestorationCancelled.current ||
      shared?.sceneKey === null ||
      shared === null ||
      mapLayers === null ||
      satelliteCatalogGateway?.getScene === undefined
    ) {
      return;
    }
    const separator = shared.sceneKey.indexOf(':');
    const collection = shared.sceneKey.slice(0, separator);
    const sceneId = shared.sceneKey.slice(separator + 1);
    const controller = new AbortController();
    void satelliteCatalogGateway
      .getScene(collection, sceneId, {
        operationId: idGenerator.generate(),
        signal: controller.signal,
      })
      .then((scene) => {
        if (controller.signal.aborted) return;
        if (scene === null) {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- Notice code.
          setCameraNotice('shared-scene-restore-failed');
          return;
        }
        mapLayers.selectScene(scene);
        setSharedSceneToApply(scene);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Notice code.
        setCameraNotice('shared-scene-restore-failed');
      });
    return () => {
      controller.abort();
    };
  }, [idGenerator, mapLayers, mosaicActive, satelliteCatalogGateway, sharedMapView]);

  // A comparison link opens Satellite with the grid once its images resolve; any two
  // resolved images are enough. Phones keep the plain shared camera.
  useEffect(() => {
    if (
      sharedMapView === null ||
      sharedComparison.length === 0 ||
      smartphoneViewport ||
      parseTrackShareLocation(window.location.hash).kind !== 'none'
    ) {
      return;
    }
    const getScene = satelliteCatalogGateway?.getScene?.bind(satelliteCatalogGateway);
    setActiveTab('satellite');
    setNavigationCollapsed(false);
    const controller = new AbortController();
    // A failed or missing scene only drops that scene; any two resolved images still
    // open. Basemap IDs need no lookup.
    void Promise.allSettled(
      sharedComparison.map((imageKey) => {
        const basemap = satelliteBasemaps.find((id) => id === imageKey);
        if (basemap !== undefined) return Promise.resolve(basemap);
        if (getScene === undefined) return Promise.resolve(null);
        const separator = imageKey.indexOf(':');
        return getScene(imageKey.slice(0, separator), imageKey.slice(separator + 1), {
          operationId: idGenerator.generate(),
          signal: controller.signal,
        });
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const resolved = results.flatMap((result) =>
        result.status === 'fulfilled' && result.value !== null ? [result.value] : [],
      );
      if (resolved.length < minimumComparedScenes) {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Notice code.
        setCameraNotice('shared-comparison-restore-failed');
        return;
      }
      openSharedComparison(resolved, {
        center: sharedMapView.center,
        zoom: sharedMapView.zoom,
      });
    });
    return () => {
      controller.abort();
    };
  }, [
    idGenerator,
    satelliteCatalogGateway,
    setActiveTab,
    setNavigationCollapsed,
    sharedComparison,
    sharedMapView,
    smartphoneViewport,
  ]);

  useEffect(() => {
    if (mosaicActive || sharedSceneRestorationCancelled.current) return;
    if (
      sharedSceneToApply === null ||
      snapshot.lifecycle !== 'ready' ||
      mapLayers === null
    ) {
      return;
    }
    const controller = new AbortController();
    sharedSceneApplyController.current = controller;
    void mapLayers.applyScene(sharedSceneToApply, controller.signal).then((result) => {
      if (sharedSceneApplyController.current !== controller) return;
      sharedSceneApplyController.current = null;
      setSharedSceneToApply(null);
      if (result.status === 'failed') {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Notice code.
        setCameraNotice('shared-scene-restore-failed');
      }
    });
    return () => {
      if (sharedSceneApplyController.current === controller) {
        sharedSceneApplyController.current = null;
        controller.abort();
      }
    };
  }, [mapLayers, mosaicActive, sharedSceneToApply, snapshot.lifecycle]);

  useEffect(() => {
    return () => {
      cameraPersistence.destroy();
      // The native MapLibre ref owns real-facade detach/reattach. Destroying it here
      // breaks React Strict Mode's development cleanup replay by clearing subscribers.
      if (!(facade instanceof MapLibreFacade)) facade.destroy();
    };
  }, [cameraPersistence, facade]);

  const resolvedMapCanvas: ReactNode =
    restoredView !== null && typeof mapCanvas === 'function'
      ? mapCanvas(restoredView.camera)
      : typeof mapCanvas === 'function'
        ? null
        : mapCanvas;

  const closeContextMenu = () => {
    setContextMenu(null);
  };
  const handleContextMenu = (event: MapLayerMouseEvent) => {
    event.originalEvent.preventDefault();
    if (markerPlacement !== null) {
      cancelMarkerPlacement();
      return;
    }
    if (weatherPointSelectionActive) {
      cancelWeatherPointSelection();
      return;
    }
    setContextMenu({
      mouseX: event.originalEvent.clientX,
      mouseY: event.originalEvent.clientY,
      coordinate: { longitude: event.lngLat.lng, latitude: event.lngLat.lat },
    });
  };

  /** Names a nearby feature for a weather point only when it is close enough to label it. */
  const nearbyPlaceLabel = (coordinate: MapCoordinate): string | undefined => {
    const nearestPoi = facade.getNearestPoi(coordinate);
    return nearestPoi !== null &&
      nearestPoi.name !== null &&
      nearestPoi.distanceMeters <= 500
      ? nearestPoi.name
      : undefined;
  };

  const handleMapClick = (event: MapLayerMouseEvent) => {
    const coordinate = {
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    };
    if (markerPlacement !== null) {
      event.originalEvent.preventDefault();
      completeMarkerPlacement(
        coordinate,
        facade.getNearestPoi(coordinate)?.name ?? undefined,
      );
      return;
    }
    if (event.originalEvent.button !== 0 || !weatherOwnsMapClicks) return;
    event.originalEvent.preventDefault();
    const placeLabel = nearbyPlaceLabel(coordinate);
    if (weatherMap.enabled) {
      requestWeatherForecast(coordinate, placeLabel);
      openWorkspaceTab('weather');
      return;
    }
    completeWeatherPointSelection(coordinate, placeLabel);
    setMobileWorkspaceOpen(true);
  };

  /** Copies a link to the clicked point with the browser's map share preferences. */
  const copyPointLink = async (coordinate: MapCoordinate) => {
    const preferences = await database
      .loadMapSharePreferences()
      .catch((): MapSharePreferences => {
        logger.log({ level: 'warn', name: 'storage.settings.load-failed' });
        return defaultMapSharePreferences;
      });
    const state = readShareableMapState(
      facade.getDiagnosticsSnapshot(),
      mapLayerStore.getState(),
    );
    await copyText(
      createMapShareUrl(
        window.location.href,
        selectMapShareView(state, preferences, coordinate),
      ),
      'link',
    );
  };

  /** Runs one action from the context menu or the touch popup; links navigate natively. */
  const runPointAction = (action: MapPointAction, coordinate: MapCoordinate) => {
    switch (action) {
      case 'copy-coordinates':
        void copyText(
          `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`,
          'coordinates',
        );
        return;
      case 'copy-point-link':
        void copyPointLink(coordinate);
        return;
      case 'share-point':
        openMapShare(window.location.href, coordinate);
        return;
      case 'create-marker':
        requestMarkerCreationAt(
          coordinate,
          facade.getNearestPoi(coordinate)?.name ?? undefined,
        );
        return;
      case 'search-satellite':
        requestSatelliteSearch(coordinate);
        openWorkspaceTab('satellite');
        return;
      case 'show-weather':
        requestWeatherForecast(coordinate, nearbyPlaceLabel(coordinate));
        openWorkspaceTab('weather');
        return;
      case 'copy-weather-link': {
        // The link enables the weather map on this point and keeps a visible map time.
        const selectedTime =
          weatherMap.enabled && weatherMap.selectedTimeIndex !== null
            ? (weatherMap.validTimes[weatherMap.selectedTimeIndex] ?? null)
            : null;
        const url = new URL(
          updateWeatherMapUrl(
            createMapShareUrl(window.location.href, {
              center: coordinate,
              zoom: snapshot.camera.zoom,
              orientation: { mode: '2d' },
              basemap: null,
              sceneKey: null,
            }),
            {
              coordinate,
              validTime: selectedTime,
            },
          ),
        );
        url.hash = workspaceHashForTab('weather');
        void copyText(url.toString(), 'weather-link');
        return;
      }
      case 'open-meteoblue':
      case 'open-windy':
        return;
    }
  };
  const handleLayerPresetChange = useCallback(
    (preset: MapLayerPreset): 'map' | 'navigated' => {
      if (mapLayers === null) return 'map';
      if (
        preset === 'sentinel-2' &&
        mapLayers.getAppliedScene() === null &&
        !mosaicImageryAvailable
      ) {
        openWorkspaceTab('satellite');
        return 'navigated';
      }
      const result = mapLayers.setMapLayerPreset(preset);
      if (result.status === 'failed') setLayerChangeFailed(true);
      return 'map';
    },
    [mapLayers, mosaicImageryAvailable, openWorkspaceTab],
  );
  const handleHybridOverlayChange = useCallback(
    (enabled: boolean) => {
      if (mapLayers === null) return;
      const result = mapLayers.setOpenStreetMapOpacity(enabled ? 1 : 0);
      if (result.status === 'failed') setLayerChangeFailed(true);
    },
    [mapLayers],
  );
  const handleWeatherMapChange = useCallback(
    (enabled: boolean) => {
      void mapLayers?.setWeatherEnabled(enabled);
    },
    [mapLayers],
  );
  const handleOpenLayersTab = useCallback(() => {
    openWorkspaceTab('layers');
  }, [openWorkspaceTab]);
  // The comparison layout stored in the browser is known before any Compare control is
  // used: this map control, the Satellite header shortcut, the tray, or the URL hash.
  const [comparisonLayoutLoaded, setComparisonLayoutLoaded] = useState(false);
  useEffect(() => {
    void database
      .loadComparisonLayout()
      .then(
        (layout) => {
          if (layout !== null) restorePreferredComparisonLayout(layout);
        },
        () => undefined,
      )
      .finally(() => {
        setComparisonLayoutLoaded(true);
      });
  }, [database]);
  // Opens like the Satellite header shortcut. The tab switch comes first in the same
  // event, so the shell's leave-Satellite cleanup never sees the grid open elsewhere.
  const handleOpenComparison = useCallback(() => {
    openWorkspaceTab('satellite');
    openComparison(
      mapDiagnostics.getSnapshot()?.camera,
      mapViewport.getViewportSnapshot(),
      maximumComparedScenes,
    );
  }, [mapDiagnostics, mapViewport, openWorkspaceTab]);

  // The comparison grid and the URL hash follow each other, as the workspace tabs do:
  // opening the grid pushes `#satellite/compare` and closing it pushes `#satellite`.
  // Only changes count, so a page that loads on the comparison hash keeps it until the
  // grid opens below.
  const comparisonOpen = useStore(satelliteCompareStore, isComparisonOpen);
  const previousComparisonOpen = useRef(comparisonOpen);
  useEffect(() => {
    if (previousComparisonOpen.current === comparisonOpen) return;
    previousComparisonOpen.current = comparisonOpen;
    if (isComparisonHash(window.location.hash) === comparisonOpen) return;
    // A grid closed by leaving Satellite already has that section's hash.
    if (!comparisonOpen && workspaceTabFromHash(window.location.hash) !== 'satellite') {
      return;
    }
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = comparisonOpen ? comparisonHash : workspaceHashForTab('satellite');
    window.history.pushState(window.history.state, '', nextUrl);
  }, [comparisonOpen]);

  // Loading, Back, Forward, or a typed hash open or close the grid. It opens over the
  // ready main map in the stored layout: as it was closed, else as from the Satellite
  // header.
  const mapReady = snapshot.lifecycle === 'ready';
  useEffect(() => {
    if (!mapReady || !comparisonLayoutLoaded || smartphoneViewport) return undefined;
    const followHash = () => {
      const { hash } = window.location;
      const open = isComparisonOpen(satelliteCompareStore.getState());
      if (isComparisonHash(hash) && !open) {
        reopenComparison(
          mapDiagnostics.getSnapshot()?.camera,
          mapViewport.getViewportSnapshot(),
          maximumComparedScenes,
        );
      } else if (
        !isComparisonHash(hash) &&
        open &&
        workspaceTabFromHash(hash) === 'satellite'
      ) {
        closeComparison();
      }
    };
    followHash();
    window.addEventListener('hashchange', followHash);
    window.addEventListener('popstate', followHash);
    return () => {
      window.removeEventListener('hashchange', followHash);
      window.removeEventListener('popstate', followHash);
    };
  }, [
    comparisonLayoutLoaded,
    mapDiagnostics,
    mapReady,
    mapViewport,
    smartphoneViewport,
  ]);
  const handleMeasurementActiveChange = useCallback((active: boolean) => {
    setMeasurementPoints(active ? [] : null);
  }, []);

  let cameraNoticeText: string | null = null;
  if (cameraNotice === 'camera-save-failed') {
    cameraNoticeText = t`The current camera could not be saved. Map interaction is still available.`;
  } else if (cameraNotice === 'camera-restore-failed') {
    cameraNoticeText = t`The saved camera could not be restored. The Georgia overview is shown instead.`;
  } else if (cameraNotice === 'shared-scene-restore-failed') {
    cameraNoticeText = t`The shared satellite image could not be restored. The shared map location is still available.`;
  } else if (cameraNotice === 'shared-comparison-restore-failed') {
    cameraNoticeText = t`The shared image comparison could not be opened. The shared map location is still available.`;
  }
  let copyConfirmationText: string | null = null;
  if (copyConfirmation === 'coordinates') {
    copyConfirmationText = t`Coordinates copied`;
  } else if (copyConfirmation === 'link') {
    copyConfirmationText = t`Link copied`;
  } else if (copyConfirmation === 'weather-link') {
    copyConfirmationText = t`Weather map link copied`;
  }

  return (
    <Box
      aria-label={t`Map workspace`}
      data-testid="map-workspace"
      data-map-state={
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Test-facing lifecycle token.
        mapProviderConfiguration.status === 'invalid' ? 'fatal' : snapshot.lifecycle
      }
      data-terrain-compute-status={terrainComputeStatus}
      sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 240 }}
    >
      {mapProviderConfiguration.status === 'invalid' ? (
        <Alert severity="error" sx={{ m: 2 }}>
          {t`The map provider configuration is invalid. The basemap was not started. Check the deployment configuration or open developer diagnostics.`}
        </Alert>
      ) : restoredView === null ? null : (
        (resolvedMapCanvas ?? (
          <Map
            ref={handleMapRef}
            locale={mapLibreLocale}
            initialViewState={restoredView.camera}
            mapStyle={mapStyle}
            maxPitch={75}
            onContextMenu={handleContextMenu}
            onClick={handleMapClick}
            boxZoom={false}
            doubleClickZoom
            dragPan={dragPanInertia}
            dragRotate={false}
            attributionControl={smartphoneViewport ? false : { compact: false }}
            keyboard
            reuseMaps={false}
            scrollZoom
            style={{ width: '100%', height: '100%' }}
            touchPitch
            touchZoomRotate
          >
            <NavigationControl
              position="top-right"
              showCompass
              showZoom
              visualizePitch
            />
            <GeolocateControl
              position="top-right"
              fitBoundsOptions={{ duration: 650, linear: true, maxZoom: 15 }}
              positionOptions={{ enableHighAccuracy: true }}
              showAccuracyCircle
              showUserLocation
              trackUserLocation={false}
            />
            <MapViewControlsControl
              activeLayerPreset={activeLayerPreset}
              hybridOverlayDisabled={
                activeLayerPreset === null || activeLayerPreset === 'vector-osm'
              }
              hybridOverlayEnabled={openStreetMapOpacity > 0}
              terrainDisabled={mosaicActive}
              layerPresetDisabled={layerPresetDisabled}
              onLayerPresetChange={handleLayerPresetChange}
              onHybridOverlayChange={handleHybridOverlayChange}
              onOpenLayersTab={handleOpenLayersTab}
              onOpenComparison={smartphoneViewport ? null : handleOpenComparison}
              onWeatherMapChange={handleWeatherMapChange}
              onTerrainModeChange={handleTerrainControlChange}
              terrainState={terrainState}
              weatherMapDisabled={mapLayers === null || weatherMap.status === 'loading'}
              weatherMapEnabled={weatherMap.enabled}
              measurementActive={measurementActive}
              onMeasurementActiveChange={handleMeasurementActiveChange}
            />
            {activeTab === 'weather' && weatherMapForecastMarker !== null ? (
              <WeatherForecastMapMarker marker={weatherMapForecastMarker} />
            ) : null}
            {activeTab === 'markers' && markersWorkspace?.weatherPreferences.showOnMap
              ? markersWorkspace.markers.map((marker) => {
                  const weather = markersWorkspace.weatherByMarkerId.get(marker.id);
                  if (weather?.status !== 'ready') return null;
                  return (
                    <Marker
                      key={`weather:${marker.id}`}
                      longitude={marker.coordinate[0]}
                      latitude={marker.coordinate[1]}
                      anchor="bottom"
                      offset={[0, -4]}
                    >
                      <Paper
                        data-marker-weather-anchor
                        elevation={3}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns:
                            weather.selection.periods.length === 1
                              ? '98px'
                              : 'repeat(2, 56px)',
                          overflow: 'hidden',
                          borderRadius: 1.25,
                          bgcolor: 'rgba(255, 255, 255, 0.96)',
                          '& > button:first-of-type': { borderLeft: 0 },
                        }}
                      >
                        <Typography
                          variant="caption"
                          title={marker.name}
                          sx={{
                            gridColumn: '1 / -1',
                            minWidth: 0,
                            px: 0.75,
                            py: 0.375,
                            borderBottom: 1,
                            borderColor: 'divider',
                            color: 'grey.900',
                            fontSize: '0.625rem',
                            fontWeight: 700,
                            lineHeight: 1.1,
                            overflow: 'hidden',
                            textAlign: 'center',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {marker.name}
                        </Typography>
                        {weather.selection.periods.map((selected) => (
                          <MarkerWeatherSummaryButton
                            key={selected.date}
                            map
                            markerName={marker.name}
                            selected={selected}
                            onOpen={(triggerElement) => {
                              markersWorkspace.openWeatherPreview(
                                marker.id,
                                selected.date,
                                triggerElement,
                              );
                            }}
                          />
                        ))}
                      </Paper>
                    </Marker>
                  );
                })
              : null}
          </Map>
        ))
      )}
      {mapProviderConfiguration.status === 'valid' ? <WeatherTimeControl /> : null}
      {cameraNoticeText !== null && mapProviderConfiguration.status === 'valid' ? (
        <Alert
          severity="warning"
          onClose={() => {
            setCameraNotice(null);
          }}
          sx={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}
        >
          {cameraNoticeText}
        </Alert>
      ) : null}
      {restoredView !== null &&
      mapProviderConfiguration.status === 'valid' &&
      resolvedMapCanvas !== null &&
      resolvedMapCanvas !== undefined ? (
        <MapViewControls
          activeLayerPreset={activeLayerPreset}
          hybridOverlayDisabled={
            activeLayerPreset === null || activeLayerPreset === 'vector-osm'
          }
          hybridOverlayEnabled={openStreetMapOpacity > 0}
          terrainDisabled={mosaicActive}
          layerPresetDisabled={layerPresetDisabled}
          onLayerPresetChange={handleLayerPresetChange}
          onHybridOverlayChange={handleHybridOverlayChange}
          onOpenLayersTab={handleOpenLayersTab}
          onOpenComparison={smartphoneViewport ? null : handleOpenComparison}
          onWeatherMapChange={handleWeatherMapChange}
          onTerrainModeChange={handleTerrainControlChange}
          terrainState={terrainState}
          weatherMapDisabled={mapLayers === null || weatherMap.status === 'loading'}
          weatherMapEnabled={weatherMap.enabled}
          measurementActive={measurementActive}
          onMeasurementActiveChange={handleMeasurementActiveChange}
        />
      ) : null}
      <ElevationGradeLegend
        dismissed={elevationGradeLegendDismissed}
        onDismissedChange={(dismissed) => {
          if (onElevationGradeLegendDismissedChange === undefined) {
            setElevationGradeLegendDismissed(dismissed);
            return;
          }
          onElevationGradeLegendDismissedChange(dismissed);
        }}
        profile={activeProfile}
        visible={
          !smartphoneViewport &&
          mapProviderConfiguration.status === 'valid' &&
          elevationGradientVisible
        }
      />
      {!online && mapProviderConfiguration.status === 'valid' ? (
        <Alert
          severity="info"
          sx={{ position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 1 }}
        >
          {t`You are offline. Areas already rendered may remain visible, but new map data is unavailable until the connection returns.`}
        </Alert>
      ) : null}
      <Popover
        open={contextMenu !== null}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu === null
            ? undefined
            : { top: contextMenu.mouseY, left: contextMenu.mouseX }
        }
      >
        {contextMenu === null ? null : (
          <MapPointActionList
            coordinate={contextMenu.coordinate}
            touch={false}
            onSelect={(action) => {
              closeContextMenu();
              runPointAction(action, contextMenu.coordinate);
            }}
          />
        )}
      </Popover>
      {pointInspection.status === 'open' && !touchPointer
        ? createPortal(
            <MapPointInspectorContent
              inspection={pointInspection}
              actions={null}
              onClose={() => {
                facade.closePointInspection();
              }}
            />,
            facade.getPointInspectionContent(),
          )
        : null}
      <Slide
        direction="up"
        in={sheetOpen}
        mountOnEnter
        unmountOnExit
        timeout={reducedMotion ? 0 : { enter: 225, exit: 195 }}
        onExited={() => {
          setSheetInspection(null);
        }}
      >
        <Paper
          ref={sheetRef}
          role="dialog"
          aria-labelledby="map-point-inspector-title"
          elevation={8}
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            // Above the shell's mobile track summary (z-index 5) that shares the bottom edge.
            zIndex: 6,
            // The sheet grows to its content; it scrolls only when taller than the map.
            maxHeight: '100%',
            overflowY: 'auto',
            px: 2,
            pt: 1.5,
            // With the last row's 10 px padding this mirrors the 12 px top inset.
            pb: 'max(4px, env(safe-area-inset-bottom))',
            borderRadius: '12px 12px 0 0',
          }}
        >
          {sheetInspection === null ? null : (
            <MapPointInspectorContent
              inspection={sheetInspection}
              onClose={() => {
                facade.closePointInspection();
              }}
              actions={
                <MapPointActionList
                  coordinate={sheetInspection.coordinate}
                  touch
                  onSelect={(action) => {
                    runPointAction(action, sheetInspection.coordinate);
                    // Unmounting waits for the Slide exit (a timer even at 0 ms), so a
                    // clicked external link stays connected while the browser follows it.
                    facade.closePointInspection();
                  }}
                />
              }
            />
          )}
        </Paper>
      </Slide>
      <Snackbar
        open={copyConfirmationText !== null}
        autoHideDuration={2_500}
        message={copyConfirmationText}
        onClose={() => {
          setCopyConfirmation(null);
        }}
      />
      <Snackbar
        open={markerPlacement !== null}
        message={t`Click the map to place the marker`}
        action={
          <Button color="inherit" size="small" onClick={cancelMarkerPlacement}>
            {t`Cancel`}
          </Button>
        }
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') cancelMarkerPlacement();
        }}
      />
      <Snackbar
        open={copyError}
        autoHideDuration={4_000}
        message={t`Clipboard access failed. Try again or use the Share dialog.`}
        onClose={() => {
          setCopyError(false);
        }}
      />
      <Snackbar
        autoHideDuration={4_000}
        message={t`The map layer could not be changed. Try again.`}
        onClose={() => {
          setLayerChangeFailed(false);
        }}
        open={layerChangeFailed}
      />
    </Box>
  );
}
