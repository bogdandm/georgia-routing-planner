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

export type SatelliteMode = 'scene' | 'mosaic';

interface SatelliteMosaicContextValue {
  readonly satelliteMode: SatelliteMode;
  readonly draftDate: string | null;
  readonly activeDate: string | null;
  readonly shown: boolean;
  readonly requestActive: boolean;
  readonly showDisabledReason: string | null;
  readonly toggleMosaicMode: () => void;
  readonly setDraftDate: (date: string) => void;
  readonly setRenderModePending: (pending: boolean) => void;
  readonly showMosaic: () => void;
}

const SatelliteMosaicContext = createContext<SatelliteMosaicContextValue | null>(null);

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

  const movementSnapshot = useSyncExternalStore(
    useCallback((listener) => mapViewport.subscribeMovement(listener), [mapViewport]),
    useCallback(() => mapViewport.getMovementSnapshot(), [mapViewport]),
    useCallback(() => mapViewport.getMovementSnapshot(), [mapViewport]),
  );
  const diagnosticsSnapshot = useSyncExternalStore(
    useCallback((listener) => mapDiagnostics.subscribe(listener), [mapDiagnostics]),
    useCallback(() => mapDiagnostics.getSnapshot(), [mapDiagnostics]),
    useCallback(() => mapDiagnostics.getSnapshot(), [mapDiagnostics]),
  );

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

  const lastMovement = useRef<string | null>(null);
  useEffect(() => {
    const movementKey =
      movementSnapshot.phase === 'settled'
        ? `settled-${String(movementSnapshot.revision)}`
        : movementSnapshot.phase;
    if (lastMovement.current === movementKey) return;
    lastMovement.current = movementKey;

    if (movementSnapshot.phase !== 'settled') {
      if (movementSnapshot.phase === 'moving') {
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
      runMosaic(current.activeDate, movementSnapshot.viewport);
      return;
    }
    mapLayers?.pruneMosaic(movementSnapshot.viewport);
  }, [cancelRequest, mapLayers, movementSnapshot, runMosaic]);

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
    if (
      satelliteMode !== 'mosaic' ||
      draftDate === null ||
      movementSnapshot.phase !== 'settled' ||
      mapLayers === null ||
      searchSatelliteMosaic === null ||
      diagnosticsSnapshot?.terrainMode !== 'flat' ||
      requestActive ||
      renderModePending
    ) {
      return;
    }
    setActiveDate(draftDate);
    setShown(true);
    runMosaic(draftDate, movementSnapshot.viewport);
  }, [
    diagnosticsSnapshot,
    draftDate,
    mapLayers,
    movementSnapshot,
    renderModePending,
    requestActive,
    runMosaic,
    satelliteMode,
    searchSatelliteMosaic,
  ]);

  let showDisabledReason: string | null = null;
  if (draftDate === null) {
    showDisabledReason = 'Choose the last date to include in the Mosaic.';
  } else if (movementSnapshot.phase === 'moving') {
    showDisabledReason = 'Wait for the map to stop moving.';
  } else if (movementSnapshot.phase === 'unavailable' || mapLayers === null) {
    showDisabledReason = 'Wait for the map to become available.';
  } else if (searchSatelliteMosaic === null) {
    showDisabledReason = 'Sentinel Mosaic search is unavailable.';
  } else if (diagnosticsSnapshot?.terrainMode !== 'flat') {
    showDisabledReason = 'Wait for the map to enter 2D mode.';
  } else if (requestActive) {
    showDisabledReason = 'A Mosaic request is already in progress.';
  } else if (renderModePending) {
    showDisabledReason = 'Wait for the satellite renderer change to finish.';
  }
  const value = useMemo<SatelliteMosaicContextValue>(
    () => ({
      satelliteMode,
      draftDate,
      activeDate,
      shown,
      requestActive,
      showDisabledReason,
      toggleMosaicMode,
      setDraftDate,
      setRenderModePending,
      showMosaic,
    }),
    [
      activeDate,
      draftDate,
      requestActive,
      satelliteMode,
      setDraftDate,
      showDisabledReason,
      showMosaic,
      shown,
      toggleMosaicMode,
    ],
  );

  return (
    <SatelliteMosaicContext.Provider value={value}>
      {children}
    </SatelliteMosaicContext.Provider>
  );
}

// Fast Refresh owns the provider; consumers remain colocated with its context contract.
// eslint-disable-next-line react-refresh/only-export-components
export function useSatelliteMode(): SatelliteMode {
  return useContext(SatelliteMosaicContext)?.satelliteMode ?? 'scene';
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSatelliteMosaic(): SatelliteMosaicContextValue {
  const context = useContext(SatelliteMosaicContext);
  if (context === null) {
    throw new Error('Satellite Mosaic must be used inside SatelliteMosaicProvider.');
  }
  return context;
}
