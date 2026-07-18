import { Alert, Box } from '@mui/material';
import type { StyleSpecification } from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Map, { NavigationControl, type MapRef } from 'react-map-gl/maplibre';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import type { MapFacade } from '@/presentation/map/MapFacade';
import { MapLibreFacade } from '@/presentation/map/MapLibreFacade';
import { MapStatusOverlay } from '@/presentation/map/MapStatusOverlay';
import { createHikingMapStyle } from '@/presentation/map/mapStyleFactory';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';

interface MapWorkspaceProps {
  readonly facade?: MapFacade;
  readonly mapCanvas?: ReactNode;
}

const unavailableMapStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

export function MapWorkspace({ facade: suppliedFacade, mapCanvas }: MapWorkspaceProps) {
  const { logger, mapProviderConfiguration } = useRuntimeServices();
  const facade = useMemo(
    () => suppliedFacade ?? new MapLibreFacade(logger),
    [logger, suppliedFacade],
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

  useEffect(() => {
    return () => {
      facade.destroy();
    };
  }, [facade]);

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
      ) : (
        (mapCanvas ?? (
          <Map
            ref={handleMapRef}
            attributionControl={{ compact: false }}
            initialViewState={defaultGeorgiaCamera}
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
      {mapProviderConfiguration.status === 'valid' ? (
        <MapStatusOverlay snapshot={snapshot} />
      ) : null}
    </Box>
  );
}
