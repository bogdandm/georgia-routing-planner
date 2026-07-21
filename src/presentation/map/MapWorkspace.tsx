import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import SatelliteAltOutlinedIcon from '@mui/icons-material/SatelliteAltOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import {
  Alert,
  Box,
  Button,
  ListItemIcon,
  Menu,
  MenuItem,
  Snackbar,
} from '@mui/material';
import type { MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Map, {
  GeolocateControl,
  NavigationControl,
  type MapRef,
} from 'react-map-gl/maplibre';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import type { MapViewState } from '@/application/ports/MapCameraRepository';
import type { MapFacade } from '@/presentation/map/MapFacade';
import { MapLibreFacade } from '@/presentation/map/MapLibreFacade';
import { SettledCameraPersistence } from '@/presentation/map/SettledCameraPersistence';
import {
  TerrainModeControl,
  type TerrainControlState,
} from '@/presentation/map/TerrainModeControl';
import { createHikingMapStyle } from '@/presentation/map/mapStyleFactory';
import { defaultGeorgiaCamera, type MapCamera } from '@/presentation/map/mapTypes';
import { satelliteSceneKey } from '@/domain/satellite/SatelliteScene';
import {
  consumeMapFitBoundsCommand,
  consumeMapNavigationCommand,
  mapInteractionStore,
  requestSatelliteSearch,
} from '@/presentation/map/mapInteractionStore';
import {
  applySharedMapView,
  createMapShareUrl,
  parseSharedMapView,
} from '@/presentation/map/mapShareUrl';
import { useUiStore } from '@/presentation/shell/uiStore';
import { workspaceHashForTab } from '@/presentation/shell/workspaceTabLocation';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';

interface MapWorkspaceProps {
  readonly facade?: MapFacade;
  readonly mapCanvas?: ReactNode | ((initialCamera: MapCamera) => ReactNode);
  readonly cameraRestoreTimeoutMs?: number;
}

const unavailableMapStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

const cameraRestoreTimeoutMs = 2_000;

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

/**
 * Coordinates React-visible map states while delegating all native MapLibre lifecycle
 * work to `MapFacade`. The map mounts only after camera restoration settles or expires.
 */
export function MapWorkspace({
  facade: suppliedFacade,
  mapCanvas,
  cameraRestoreTimeoutMs: restoreTimeoutMs = cameraRestoreTimeoutMs,
}: MapWorkspaceProps) {
  const {
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
  const [restoredView, setRestoredView] = useState<MapViewState | null>(null);
  const terrainRestoreAttempted = useRef(false);
  const sharedSceneRestoreAttempted = useRef(false);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [terrainCommandState, setTerrainCommandState] = useState<Exclude<
    TerrainControlState,
    'flat' | 'terrain'
  > | null>(null);
  const [terrainMessage, setTerrainMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [contextMenu, setContextMenu] = useState<{
    readonly mouseX: number;
    readonly mouseY: number;
    readonly longitude: number;
    readonly latitude: number;
  } | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const navigationCommand = useStore(
    mapInteractionStore,
    (state) => state.navigationCommand,
  );
  const terrainComputeStatus = useStore(
    mapLayerStore,
    (state) => state.terrainComputeStatus,
  );
  const fitBoundsCommand = useStore(
    mapInteractionStore,
    (state) => state.fitBoundsCommand,
  );
  const developerMode = useUiStore((state) => state.developerMode);
  const mapDebugOptions = useUiStore((state) => state.mapDebugOptions);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setNavigationCollapsed = useUiStore((state) => state.setNavigationCollapsed);
  const cameraPersistence = useMemo(
    () =>
      new SettledCameraPersistence(mapCameraRepository, logger, () => {
        setCameraMessage(
          'The current camera could not be saved. Map interaction is still available.',
        );
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
                pois: mapProviderConfiguration.value.vector.sourceLayers.pois,
              },
              demTileUrl: mapLayers?.createDemTileUrl() ?? '',
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
  const terrainState: TerrainControlState = terrainCommandState ?? snapshot.terrainMode;

  useEffect(() => {
    const publishViewport = () => {
      mapViewport.update(facade.getViewportSnapshot());
    };
    publishViewport();
    const unsubscribe = facade.subscribe(publishViewport);
    return () => {
      unsubscribe();
      mapViewport.update(null);
    };
  }, [facade, mapViewport]);

  useEffect(() => {
    if (navigationCommand === null) return;
    try {
      facade.navigateTo(navigationCommand.target);
    } finally {
      consumeMapNavigationCommand(navigationCommand.id);
    }
  }, [facade, navigationCommand]);
  useEffect(() => {
    if (fitBoundsCommand === null) return;
    try {
      facade.fitBounds(fitBoundsCommand.bounds, fitBoundsCommand.maxZoom);
    } finally {
      consumeMapFitBoundsCommand(fitBoundsCommand.id);
    }
  }, [facade, fitBoundsCommand]);
  const mapStyle = useMemo(
    () =>
      mapProviderConfiguration.status === 'valid'
        ? createHikingMapStyle(mapProviderConfiguration.value)
        : unavailableMapStyle,
    [mapProviderConfiguration],
  );

  const handleMapRef = useCallback(
    (mapRef: MapRef | null) => {
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
    async (mode: 'flat' | 'terrain') => {
      setTerrainCommandState(mode === 'terrain' ? 'enabling' : 'disabling');
      setTerrainMessage(null);
      try {
        const result = await facade.setTerrainMode(mode);
        if (result.status === 'success') {
          setTerrainCommandState(null);
          return;
        }
        setTerrainCommandState('failed');
        setTerrainMessage(result.reason);
      } catch {
        setTerrainCommandState('failed');
        setTerrainMessage(
          'Terrain could not be enabled. The flat map remains available.',
        );
      }
    },
    [facade],
  );

  useEffect(() => {
    facade.setDebugOptions(
      developerMode
        ? mapDebugOptions
        : { showCollisionBoxes: false, showTileBoundaries: false },
    );
    return () => {
      facade.setDebugOptions({
        showCollisionBoxes: false,
        showTileBoundaries: false,
      });
    };
  }, [developerMode, facade, mapDebugOptions]);

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
          const fallback = view ?? {
            camera: defaultGeorgiaCamera,
            terrainMode: 'flat' as const,
          };
          setRestoredView({
            ...fallback,
            camera: applySharedMapView(
              fallback.camera,
              parseSharedMapView(window.location.search),
            ),
          });
        }
      })
      .catch(() => {
        if (active) {
          logger.log({ level: 'warn', name: 'storage.map-camera.load-failed' });
          setCameraMessage(
            'The saved camera could not be restored. The Georgia overview is shown instead.',
          );
          setRestoredView({ camera: defaultGeorgiaCamera, terrainMode: 'flat' });
        }
      });

    return () => {
      active = false;
    };
  }, [logger, mapCameraRepository, restoreTimeoutMs]);

  useEffect(() => {
    if (
      restoredView?.terrainMode !== 'terrain' ||
      snapshot.lifecycle !== 'ready' ||
      snapshot.terrainMode === 'terrain' ||
      terrainRestoreAttempted.current
    ) {
      return;
    }
    terrainRestoreAttempted.current = true;
    void handleTerrainModeChange('terrain');
  }, [handleTerrainModeChange, restoredView, snapshot.lifecycle, snapshot.terrainMode]);

  useEffect(() => {
    const shared = parseSharedMapView(window.location.search);
    if (
      shared?.sceneKey === null ||
      shared === null ||
      snapshot.lifecycle !== 'ready' ||
      sharedSceneRestoreAttempted.current ||
      mapLayers === null ||
      satelliteCatalogGateway?.getScene === undefined
    ) {
      return;
    }
    sharedSceneRestoreAttempted.current = true;
    const separator = shared.sceneKey.indexOf(':');
    const collection = shared.sceneKey.slice(0, separator);
    const sceneId = shared.sceneKey.slice(separator + 1);
    const currentScene = mapLayers.getAppliedScene();
    if (currentScene !== null && satelliteSceneKey(currentScene) === shared.sceneKey) {
      return;
    }
    const controller = new AbortController();
    void satelliteCatalogGateway
      .getScene(collection, sceneId, {
        operationId: idGenerator.generate(),
        signal: controller.signal,
      })
      .then(async (scene) => {
        if (scene === null || controller.signal.aborted) return;
        const result = await mapLayers.applyScene(scene, controller.signal);
        if (result.status === 'failed') {
          setCameraMessage(
            'The shared satellite image could not be restored. The shared map location is still available.',
          );
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }
        setCameraMessage(
          'The shared satellite image could not be restored. The shared map location is still available.',
        );
      });
    return () => {
      controller.abort();
    };
  }, [idGenerator, mapLayers, satelliteCatalogGateway, snapshot.lifecycle]);

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
    setContextMenu({
      mouseX: event.originalEvent.clientX,
      mouseY: event.originalEvent.clientY,
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    });
  };

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(message);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };

  const copyCoordinates = () => {
    if (contextMenu === null) return;
    const value = `${contextMenu.latitude.toFixed(5)}, ${contextMenu.longitude.toFixed(5)}`;
    closeContextMenu();
    void copyText(value, 'Coordinates copied');
  };

  const copyPointLink = () => {
    if (contextMenu === null) return;
    const scene = mapLayers?.getAppliedScene() ?? null;
    const url = createMapShareUrl(
      window.location.href,
      {
        latitude: contextMenu.latitude,
        longitude: contextMenu.longitude,
        zoom: snapshot.camera.zoom,
      },
      scene === null ? null : satelliteSceneKey(scene),
    );
    closeContextMenu();
    void copyText(url, 'Point link copied');
  };

  const searchSatelliteAtPoint = () => {
    if (contextMenu === null) return;
    requestSatelliteSearch(contextMenu);
    setActiveTab('satellite');
    setNavigationCollapsed(false);
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = workspaceHashForTab('satellite');
    window.history.pushState(window.history.state, '', nextUrl);
    closeContextMenu();
  };

  return (
    <Box
      aria-label="Map workspace"
      data-testid="map-workspace"
      data-map-state={
        mapProviderConfiguration.status === 'invalid' ? 'fatal' : snapshot.lifecycle
      }
      data-terrain-compute-status={terrainComputeStatus}
      sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 240 }}
    >
      {mapProviderConfiguration.status === 'invalid' ? (
        <Alert severity="error" sx={{ m: 2 }}>
          {mapProviderConfiguration.message} The basemap was not started. Check the
          deployment configuration or open developer diagnostics.
        </Alert>
      ) : restoredView === null ? null : (
        (resolvedMapCanvas ?? (
          <Map
            ref={handleMapRef}
            attributionControl={{ compact: false }}
            initialViewState={restoredView.camera}
            mapStyle={mapStyle}
            onContextMenu={handleContextMenu}
            boxZoom
            doubleClickZoom
            dragPan
            dragRotate
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
              positionOptions={{ enableHighAccuracy: true }}
              showAccuracyCircle
              showUserLocation
              trackUserLocation={false}
            />
          </Map>
        ))
      )}
      {cameraMessage !== null && mapProviderConfiguration.status === 'valid' ? (
        <Alert
          severity="warning"
          onClose={() => {
            setCameraMessage(null);
          }}
          sx={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}
        >
          {cameraMessage}
        </Alert>
      ) : null}
      {restoredView !== null && mapProviderConfiguration.status === 'valid' ? (
        <TerrainModeControl
          state={terrainState}
          onModeChange={(mode) => {
            void handleTerrainModeChange(mode);
          }}
        />
      ) : null}
      {terrainMessage !== null && mapProviderConfiguration.status === 'valid' ? (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                void handleTerrainModeChange('terrain');
              }}
            >
              Retry 3D
            </Button>
          }
          sx={{ position: 'absolute', top: 72, left: 12, right: 12, zIndex: 1 }}
        >
          {terrainMessage} The 2D basemap is still available.
        </Alert>
      ) : null}
      {!online && mapProviderConfiguration.status === 'valid' ? (
        <Alert
          severity="info"
          sx={{ position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 1 }}
        >
          You are offline. Areas already rendered may remain visible, but new map data
          is unavailable until the connection returns.
        </Alert>
      ) : null}
      <Menu
        open={contextMenu !== null}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu === null
            ? undefined
            : { top: contextMenu.mouseY, left: contextMenu.mouseX }
        }
        slotProps={{
          list: { 'aria-label': 'Map point actions', autoFocusItem: false },
        }}
      >
        <MenuItem onClick={copyCoordinates}>
          <ListItemIcon>
            <ContentCopyOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Copy coordinates
        </MenuItem>
        <MenuItem onClick={copyPointLink}>
          <ListItemIcon>
            <ShareOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Copy link to this point
        </MenuItem>
        <MenuItem onClick={searchSatelliteAtPoint}>
          <ListItemIcon>
            <SatelliteAltOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Search satellite scenes here
        </MenuItem>
      </Menu>
      <Snackbar
        open={copyMessage !== null}
        autoHideDuration={2_500}
        message={copyMessage}
        onClose={() => {
          setCopyMessage(null);
        }}
      />
      <Snackbar
        open={copyError}
        autoHideDuration={4_000}
        message="Clipboard access failed. Try again or use the Share dialog."
        onClose={() => {
          setCopyError(false);
        }}
      />
    </Box>
  );
}
