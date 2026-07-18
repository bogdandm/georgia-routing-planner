import { Box } from '@mui/material';
import type { StyleSpecification } from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Map, { type MapRef } from 'react-map-gl/maplibre';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import type { MapFacade } from '@/presentation/map/MapFacade';
import { MapLibreFacade } from '@/presentation/map/MapLibreFacade';
import { MapStatusOverlay } from '@/presentation/map/MapStatusOverlay';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';

const networkFreeStyle: StyleSpecification = {
  version: 8,
  name: 'phase-0-network-free',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#dbe3d5' },
    },
  ],
};

interface MapWorkspaceProps {
  readonly facade?: MapFacade;
  readonly mapCanvas?: ReactNode;
}

export function MapWorkspace({ facade: suppliedFacade, mapCanvas }: MapWorkspaceProps) {
  const { logger } = useRuntimeServices();
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
      sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 240 }}
    >
      {mapCanvas ?? (
        <Map
          ref={handleMapRef}
          attributionControl={false}
          initialViewState={defaultGeorgiaCamera}
          mapStyle={networkFreeStyle}
          reuseMaps={false}
          style={{ width: '100%', height: '100%' }}
        />
      )}
      <MapStatusOverlay snapshot={snapshot} />
    </Box>
  );
}
