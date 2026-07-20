import { Alert, Box, Button } from '@mui/material';
import type { StyleSpecification } from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Map, { NavigationControl, type MapRef } from 'react-map-gl/maplibre';

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
import { useUiStore } from '@/presentation/shell/uiStore';

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
    mapCameraRepository,
    mapDiagnostics,
    mapLayers,
    mapProviderConfiguration,
    mapViewport,
  } = useRuntimeServices();
  const [restoredView, setRestoredView] = useState<MapViewState | null>(null);
  const terrainRestoreAttempted = useRef(false);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [terrainCommandState, setTerrainCommandState] = useState<Exclude<
    TerrainControlState,
    'flat' | 'terrain'
  > | null>(null);
  const [terrainMessage, setTerrainMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const developerMode = useUiStore((state) => state.developerMode);
  const mapDebugOptions = useUiStore((state) => state.mapDebugOptions);
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
              requestTimeoutMs: mapProviderConfiguration.value.policy.requestTimeoutMs,
              equivalentErrorWindowMs:
                mapProviderConfiguration.value.policy.equivalentErrorWindowMs,
            }
          : undefined,
        mapDiagnostics,
        mapLayers ?? undefined,
      ),
    [
      cameraPersistence,
      logger,
      mapDiagnostics,
      mapLayers,
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
          setRestoredView(
            view ?? { camera: defaultGeorgiaCamera, terrainMode: 'flat' },
          );
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

  return (
    <Box
      aria-label="Map workspace"
      data-testid="map-workspace"
      data-map-state={
        mapProviderConfiguration.status === 'invalid' ? 'fatal' : snapshot.lifecycle
      }
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
    </Box>
  );
}
