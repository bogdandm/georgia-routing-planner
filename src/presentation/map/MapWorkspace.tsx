import { Alert, Box, Button } from '@mui/material';
import type { StyleSpecification } from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Map, { NavigationControl, type MapRef } from 'react-map-gl/maplibre';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import type { MapFacade } from '@/presentation/map/MapFacade';
import { MapLibreFacade } from '@/presentation/map/MapLibreFacade';
import { MapStatusOverlay } from '@/presentation/map/MapStatusOverlay';
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
}

const unavailableMapStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

export function MapWorkspace({ facade: suppliedFacade, mapCanvas }: MapWorkspaceProps) {
  const { logger, mapCameraRepository, mapDiagnostics, mapProviderConfiguration } =
    useRuntimeServices();
  const [restoredCamera, setRestoredCamera] = useState<MapCamera | null>(null);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [terrainState, setTerrainState] = useState<TerrainControlState>('flat');
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
        (camera) => {
          cameraPersistence.schedule(camera);
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
      ),
    [
      cameraPersistence,
      logger,
      mapDiagnostics,
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
  const mapStyle = useMemo(
    () =>
      mapProviderConfiguration.status === 'valid'
        ? createHikingMapStyle(mapProviderConfiguration.value)
        : unavailableMapStyle,
    [mapProviderConfiguration],
  );

  const handleMapRef = useCallback(
    (mapRef: MapRef | null) => {
      if (facade instanceof MapLibreFacade && mapRef !== null) {
        facade.attach(mapRef.getMap());
      }
    },
    [facade],
  );

  const handleTerrainModeChange = useCallback(
    async (mode: 'flat' | 'terrain') => {
      setTerrainState(mode === 'terrain' ? 'enabling' : 'disabling');
      setTerrainMessage(null);
      try {
        const result = await facade.setTerrainMode(mode);
        if (result.status === 'success') {
          setTerrainState(result.mode);
          return;
        }
        setTerrainState('failed');
        setTerrainMessage(result.reason);
      } catch {
        setTerrainState('failed');
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
    void mapCameraRepository
      .load()
      .then((camera) => {
        if (active) {
          setRestoredCamera(camera ?? defaultGeorgiaCamera);
        }
      })
      .catch(() => {
        if (active) {
          logger.log({ level: 'warn', name: 'storage.map-camera.load-failed' });
          setCameraMessage(
            'The saved camera could not be restored. The Georgia overview is shown instead.',
          );
          setRestoredCamera(defaultGeorgiaCamera);
        }
      });

    return () => {
      active = false;
    };
  }, [logger, mapCameraRepository]);

  useEffect(() => {
    return () => {
      facade.destroy();
      cameraPersistence.destroy();
    };
  }, [cameraPersistence, facade]);

  const resolvedMapCanvas: ReactNode =
    restoredCamera !== null && typeof mapCanvas === 'function'
      ? mapCanvas(restoredCamera)
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
      ) : restoredCamera === null ? null : (
        (resolvedMapCanvas ?? (
          <Map
            ref={handleMapRef}
            attributionControl={{ compact: false }}
            initialViewState={restoredCamera}
            mapStyle={mapStyle}
            reuseMaps={false}
            style={{ width: '100%', height: '100%' }}
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
      {restoredCamera !== null && mapProviderConfiguration.status === 'valid' ? (
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
      {mapProviderConfiguration.status === 'valid' ? (
        <MapStatusOverlay
          snapshot={snapshot}
          onRetry={() => {
            facade.retryRecoverableFailures();
          }}
        />
      ) : null}
    </Box>
  );
}
