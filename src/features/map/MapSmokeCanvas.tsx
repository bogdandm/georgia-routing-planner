import { Alert, Box, CircularProgress } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import Map, { type ErrorEvent, type MapRef } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';

import { useApplicationServices } from '@/app/bootstrap/useApplicationServices';

const networkFreeStyle: StyleSpecification = {
  version: 8,
  name: 'Phase 0 network-free smoke style',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#dbe3d5' },
    },
  ],
};

export function MapSmokeCanvas() {
  const { logger } = useApplicationServices();
  const mapRef = useRef<MapRef>(null);
  const cleanupContextListener = useRef<() => void>(() => undefined);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const handleContextLost = useCallback(
    (event: Event) => {
      event.preventDefault();
      setState('error');
      setErrorMessage('The browser lost the WebGL context.');
      logger.log({ level: 'error', name: 'map.webgl.context-lost' });
    },
    [logger],
  );

  const handleLoad = useCallback(() => {
    const map = mapRef.current;
    const canvas = map?.getCanvas();
    cleanupContextListener.current();
    if (canvas !== undefined) {
      canvas.addEventListener('webglcontextlost', handleContextLost);
      cleanupContextListener.current = () => {
        canvas.removeEventListener('webglcontextlost', handleContextLost);
      };
    }
    setState('ready');
    logger.log({
      level: 'info',
      name: 'map.smoke.ready',
      data: {
        ready: true,
        cameraZoom: map?.getZoom() ?? 0,
      },
    });
  }, [handleContextLost, logger]);

  const handleError = useCallback(
    (event: ErrorEvent) => {
      setState('error');
      setErrorMessage('MapLibre could not initialize the local smoke canvas.');
      logger.log({
        level: 'error',
        name: 'map.smoke.failed',
        message: event.error.message,
      });
    },
    [logger],
  );

  useEffect(() => {
    return () => {
      cleanupContextListener.current();
      logger.log({ level: 'debug', name: 'map.smoke.unmounted' });
    };
  }, [logger]);

  return (
    <Box
      aria-label="Map workspace"
      data-testid="map-smoke-canvas"
      sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 240 }}
    >
      <Map
        ref={mapRef}
        attributionControl={false}
        initialViewState={{ longitude: 43.4, latitude: 42.1, zoom: 5.8 }}
        mapStyle={networkFreeStyle}
        onError={handleError}
        onLoad={handleLoad}
        reuseMaps={false}
        style={{ width: '100%', height: '100%' }}
      />
      {state === 'loading' ? (
        <Box
          role="status"
          sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}
        >
          <CircularProgress aria-label="Loading local map canvas" />
        </Box>
      ) : null}
      {state === 'error' ? (
        <Alert
          severity="error"
          sx={{ position: 'absolute', inset: 16, height: 'fit-content' }}
        >
          {errorMessage}
        </Alert>
      ) : null}
    </Box>
  );
}
