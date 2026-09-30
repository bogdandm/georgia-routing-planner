import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';
import type { MapViewportMovementSnapshot } from '@/presentation/map/MapViewportSnapshotStore';
import type { TerrainMode } from '@/presentation/map/mapTypes';

export type SatelliteMode = 'scene' | 'mosaic';

interface SatelliteMosaicContextValue {
  readonly draftDate: string | null;
  readonly activeDate: string | null;
  readonly shown: boolean;
  readonly requestActive: boolean;
  readonly renderModePending: boolean;
  readonly toggleMosaicMode: () => void;
  readonly setDraftDate: (date: string) => void;
  readonly setRenderModePending: (pending: boolean) => void;
  readonly showMosaic: () => void;
}

const SatelliteMosaicContext = createContext<SatelliteMosaicContextValue | null>(null);
// Map-wide consumers only need the mode; a separate context keeps Mosaic workflow
// changes from re-rendering them.
const SatelliteModeContext = createContext<SatelliteMode>('scene');

const unexpectedSearchMessage = 'Sentinel imagery could not be loaded. Try again.';

export function SatelliteMosaicProvider({ children }: PropsWithChildren) {
  const { mapDiagnostics, mapLayers, mapViewport, searchSatelliteMosaic } =
    useRuntimeServices();
  const [satelliteMode, setSatelliteMode] = useState<SatelliteMode>('scene');
  const [draftDate, setDraftDateState] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [requestActive, setRequestActive] = useState(false);
  const [renderModePending, setRenderModePending] = useState(false);
  const currentRequest = useRef<{
    readonly id: number;
    readonly controller: AbortController;
  } | null>(null);
  const nextRequestId = useRef(0);
  const workflow = useRef({ satelliteMode, activeDate, shown });
  useEffect(() => {
    workflow.current = { satelliteMode, activeDate, shown };
  }, [activeDate, satelliteMode, shown]);

  const cancelRequest = useCallback(() => {
    currentRequest.current?.controller.abort();
    currentRequest.current = null;
    setRequestActive(false);
  }, []);

  const runMosaic = useCallback(
    (selectedDate: string, viewport: SatelliteSearchViewport) => {
      if (mapLayers === null || searchSatelliteMosaic === null) return;
      cancelRequest();
      const beginResult = mapLayers.beginMosaic(selectedDate, viewport);
      if (beginResult.status === 'failed') return;

      const request = {
        id: (nextRequestId.current += 1),
        controller: new AbortController(),
      };
      currentRequest.current = request;
      setRequestActive(true);
      void searchSatelliteMosaic
        .execute(
          { viewport, selectedDate, productLevel: 'L2A' },
          request.controller.signal,
        )
        .then(async (result) => {
          if (currentRequest.current?.id !== request.id) return;
          await mapLayers.applyMosaic(
            result.scenes,
            viewport,
            selectedDate,
            request.controller.signal,
          );
        })
        .catch((error: unknown) => {
          if (
            currentRequest.current?.id !== request.id ||
            request.controller.signal.aborted
          ) {
            return;
          }
          const message =
            error instanceof SatelliteSearchError
              ? error.message
              : unexpectedSearchMessage;
          mapLayers.failMosaic(selectedDate, viewport, message);
        })
        .finally(() => {
          if (currentRequest.current?.id !== request.id) return;
          currentRequest.current = null;
          setRequestActive(false);
        });
    },
    [cancelRequest, mapLayers, searchSatelliteMosaic],
  );

  // Movement is read from the store inside a direct subscription; subscribing through
  // React state would re-render every context consumer on each movestart/moveend.
  const lastMovement = useRef<string | null>(null);
  useEffect(() => {
    const handleMovement = () => {
      const movement = mapViewport.getMovementSnapshot();
      const movementKey =
        movement.phase === 'settled'
          ? `settled-${String(movement.revision)}`
          : movement.phase;
      if (lastMovement.current === movementKey) return;
      lastMovement.current = movementKey;

      if (movement.phase !== 'settled') {
        if (movement.phase === 'moving') {
          currentRequest.current?.controller.abort();
        }
        return;
      }

      const current = workflow.current;
      if (
        current.satelliteMode === 'mosaic' &&
        current.shown &&
        current.activeDate !== null
      ) {
        runMosaic(current.activeDate, movement.viewport);
        return;
      }
      mapLayers?.pruneMosaic(movement.viewport);
    };
    handleMovement();
    return mapViewport.subscribeMovement(handleMovement);
  }, [mapLayers, mapViewport, runMosaic]);

  useEffect(
    () => () => {
      currentRequest.current?.controller.abort();
    },
    [],
  );

  const toggleMosaicMode = useCallback(() => {
    if (satelliteMode === 'mosaic') {
      cancelRequest();
      mapLayers?.clearMosaic();
      setDraftDateState(null);
      setActiveDate(null);
      setShown(false);
      setRenderModePending(false);
      setSatelliteMode('scene');
      return;
    }

    mapLayers?.clearScene();
    setSatelliteMode('mosaic');
  }, [cancelRequest, mapLayers, satelliteMode]);

  const setDraftDate = useCallback(
    (date: string) => {
      setDraftDateState(date);
      if (activeDate === null || date === activeDate) return;
      cancelRequest();
      mapLayers?.clearMosaic();
      setActiveDate(null);
      setShown(false);
    },
    [activeDate, cancelRequest, mapLayers],
  );

  const showMosaic = useCallback(() => {
    const movement = mapViewport.getMovementSnapshot();
    if (
      satelliteMode !== 'mosaic' ||
      draftDate === null ||
      movement.phase !== 'settled' ||
      resolveShowDisabledReason({
        draftDate,
        movementPhase: movement.phase,
        mapLayersAvailable: mapLayers !== null,
        searchAvailable: searchSatelliteMosaic !== null,
        terrainMode: mapDiagnostics.getSnapshot()?.terrainMode ?? null,
        requestActive,
        renderModePending,
      }) !== null
    ) {
      return;
    }
    setActiveDate(draftDate);
    setShown(true);
    runMosaic(draftDate, movement.viewport);
  }, [
    draftDate,
    mapDiagnostics,
    mapLayers,
    mapViewport,
    renderModePending,
    requestActive,
    runMosaic,
    satelliteMode,
    searchSatelliteMosaic,
  ]);

  const value = useMemo<SatelliteMosaicContextValue>(
    () => ({
      draftDate,
      activeDate,
      shown,
      requestActive,
      renderModePending,
      toggleMosaicMode,
      setDraftDate,
      setRenderModePending,
      showMosaic,
    }),
    [
      activeDate,
      draftDate,
      renderModePending,
      requestActive,
      setDraftDate,
      showMosaic,
      shown,
      toggleMosaicMode,
    ],
  );

  return (
    <SatelliteModeContext.Provider value={satelliteMode}>
      <SatelliteMosaicContext.Provider value={value}>
        {children}
      </SatelliteMosaicContext.Provider>
    </SatelliteModeContext.Provider>
  );
}

function resolveShowDisabledReason(state: {
  readonly draftDate: string | null;
  readonly movementPhase: MapViewportMovementSnapshot['phase'];
  readonly mapLayersAvailable: boolean;
  readonly searchAvailable: boolean;
  readonly terrainMode: TerrainMode | null;
  readonly requestActive: boolean;
  readonly renderModePending: boolean;
}): string | null {
  if (state.draftDate === null) return 'Choose the last date to include in the Mosaic.';
  if (state.movementPhase === 'moving') return 'Wait for the map to stop moving.';
  if (state.movementPhase === 'unavailable' || !state.mapLayersAvailable) {
    return 'Wait for the map to become available.';
  }
  if (!state.searchAvailable) return 'Sentinel Mosaic search is unavailable.';
  if (state.terrainMode !== 'flat') return 'Wait for the map to enter 2D mode.';
  if (state.requestActive) return 'A Mosaic request is already in progress.';
  if (state.renderModePending) {
    return 'Wait for the satellite renderer change to finish.';
  }
  return null;
}

// Fast Refresh owns the provider; consumers remain colocated with its context contract.
// eslint-disable-next-line react-refresh/only-export-components
export function useSatelliteMode(): SatelliteMode {
  return useContext(SatelliteModeContext);
}

/**
 * Subscribes only the rendering control to primitive movement and terrain values so
 * map movement does not change the shared Mosaic context.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSatelliteMosaicShowDisabledReason(): string | null {
  const { mapDiagnostics, mapLayers, mapViewport, searchSatelliteMosaic } =
    useRuntimeServices();
  const { draftDate, renderModePending, requestActive } = useSatelliteMosaic();
  const readMovementPhase = useCallback(
    () => mapViewport.getMovementSnapshot().phase,
    [mapViewport],
  );
  const movementPhase = useSyncExternalStore(
    useCallback((listener) => mapViewport.subscribeMovement(listener), [mapViewport]),
    readMovementPhase,
    readMovementPhase,
  );
  const readTerrainMode = useCallback(
    () => mapDiagnostics.getSnapshot()?.terrainMode ?? null,
    [mapDiagnostics],
  );
  const terrainMode = useSyncExternalStore(
    useCallback((listener) => mapDiagnostics.subscribe(listener), [mapDiagnostics]),
    readTerrainMode,
    readTerrainMode,
  );
  return resolveShowDisabledReason({
    draftDate,
    movementPhase,
    mapLayersAvailable: mapLayers !== null,
    searchAvailable: searchSatelliteMosaic !== null,
    terrainMode,
    requestActive,
    renderModePending,
  });
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSatelliteMosaic(): SatelliteMosaicContextValue {
  const context = useContext(SatelliteMosaicContext);
  if (context === null) {
    throw new Error('Satellite Mosaic must be used inside SatelliteMosaicProvider.');
  }
  return context;
}
