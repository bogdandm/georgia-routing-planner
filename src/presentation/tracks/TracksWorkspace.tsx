import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SortIcon from '@mui/icons-material/Sort';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  ClickAwayListener,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';

import type { PlaceSearchResult } from '@/application/ports/PlaceSearchGateway';
import {
  prepareImportedTrack,
  type TrackElevationPreparationProgress,
} from '@/application/tracks/prepareImportedTrack';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  normalizeMarkerName,
  type NormalizedMarkerName,
} from '@/domain/markers/savedMarker';
import { geodesicDistanceKm } from '@/application/map/expandPlaceSearchBounds';
import {
  GPX_PARSER_VERSION,
  type ParsedGpx,
  type TrackCoordinate,
  type TrackPoint,
  type TrackSegment,
} from '@/domain/tracks/gpx';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  MAXIMUM_TRACK_MARKERS,
  localTrackSegments,
  normalizeLocalTrackName,
  type LocalTrackContent,
  type LocalTrackSummary,
  type TrackMarker,
  type TrackSort,
} from '@/domain/tracks/localTrack';
import {
  calculateTrackMetrics,
  findDominantSummit,
  formatGeneratedPoiLabel,
  generateEnglishTrackName,
  isLoop,
  pointNearestFraction,
  type PoiCandidate,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';
import {
  parseTrackFile,
  trackSourceFormat,
  type TrackSourceFormat,
} from '@/domain/tracks/trackImport';
import {
  exportTrackAsGpx,
  exportTrackAsKml,
  exportTracksAsZip,
  safeTrackFilename,
} from '@/domain/tracks/trackExport';
import {
  calculateElevationProfile,
  medianFilterElevationSamples,
  type ElevationProfile,
  type ElevationProfileInputPoint,
} from '@/domain/tracks/elevationProfile';
import { formatDateTime } from '@/presentation/formatDateTime';
import {
  ElevationPreparationChart,
  ElevationProfileChart,
} from '@/presentation/tracks/ElevationProfileChart';
import { RoutePlanControls } from '@/presentation/tracks/RoutePlanControls';
import { TrackShareError } from '@/application/tracks/TrackShareService';
import {
  createTrackShareUrl,
  parseTrackShareLocation,
} from '@/presentation/tracks/trackShareUrl';
import {
  formatTrackDuration,
  TrackStat,
  TrackStats,
  type TrackStatsMetrics,
} from '@/presentation/tracks/TrackSummary';
import { MarkerEditorDialog } from '@/presentation/markers/MarkerEditorDialog';
import { ClimbsDescentsSection } from '@/presentation/tracks/ClimbsDescentsSection';
import { TrackMarkersSection } from '@/presentation/tracks/TrackMarkersSection';
import {
  formatTrackDistance,
  formatTrackElevation,
} from '@/presentation/tracks/trackFormatters';
import {
  beginRoutePlanElevation,
  canSaveRoutePlan,
  clearRoutePlan as clearRoutePlanDraft,
  completeRoutePlanPoint,
  enqueueRoutePlanPoint,
  setNextSegmentMode as setRoutePlanSegmentMode,
  finishRoutePlanElevation,
  setRoutePlanName,
  startRoutePlan as createRoutePlanDraft,
  undoLastRoutePlanPoint as undoRoutePlanPoint,
  updateRoutePlanProgress,
  type RoutePlanDraft,
  type RoutePlanSegmentMode,
} from '@/presentation/tracks/routePlan';
import {
  cancelMarkerPlacement,
  consumeMarkerCreationCommand,
  mapInteractionStore,
  requestMapFitBounds,
  requestMapNavigation,
  requestMarkerPlacement,
} from '@/presentation/map/mapInteractionStore';
import type { MapCoordinate } from '@/presentation/map/mapTypes';
import { appColors } from '@/presentation/theme/appColors';
import { useUiStore } from '@/presentation/shell/uiStore';

const EMPTY_TRACK_MARKERS: readonly TrackMarker[] = [];

interface PreviewTrackBase {
  readonly kind: 'preview';
  readonly id: string;
  readonly file: File;
  readonly parsed: ParsedGpx;
  readonly sourceFormat: TrackSourceFormat;
  readonly name: string;
  readonly markers: readonly TrackMarker[];
}

interface PreparingPreviewTrack extends PreviewTrackBase {
  readonly preparationStatus: 'preparing';
}

interface FailedPreviewTrack extends PreviewTrackBase {
  readonly preparationStatus: 'failed';
  readonly preparationError: string;
}

interface PreparedPreviewTrack extends PreviewTrackBase {
  readonly preparationStatus: 'ready';
  readonly sourceSegments: readonly TrackSegment[];
  readonly sourceProfile: ElevationProfile | null;
  readonly sourceMetrics: TrackMetrics;
  readonly calculatedSegments: readonly TrackSegment[] | null;
  readonly calculatedProfile: ElevationProfile | null;
  readonly calculatedMetrics: TrackMetrics | null;
  readonly namingStatus: 'loading' | 'ready' | 'unavailable';
  readonly generatedName?: string;
  readonly middleAnchorKind?: 'distance-midpoint' | 'dominant-summit';
  readonly startPoi?: PoiCandidate;
  readonly middlePoi?: PoiCandidate;
  readonly endPoi?: PoiCandidate;
  readonly fallbackPoi?: PoiCandidate;
}

interface SharedTrackSelection extends Omit<PreparedPreviewTrack, 'kind'> {
  readonly kind: 'shared';
}

type PreviewTrack = PreparingPreviewTrack | FailedPreviewTrack | PreparedPreviewTrack;

interface SavedTrackSelection {
  readonly kind: 'saved';
  readonly summary: LocalTrackSummary;
  readonly content: LocalTrackContent;
  readonly draftName: string;
}

interface TrackMarkerEditorDraft {
  readonly trackId: string;
  readonly coordinate: TrackCoordinate;
  readonly initialName: string;
}

type ActiveTrack =
  PreviewTrack | SharedTrackSelection | SavedTrackSelection | RoutePlanDraft;
type MultiTrackSelection =
  | {
      readonly status: 'loading';
      readonly requestId: number;
      readonly summary: LocalTrackSummary;
    }
  | {
      readonly status: 'ready';
      readonly requestId: number;
      readonly summary: LocalTrackSummary;
      readonly content: LocalTrackContent;
      readonly profile: ElevationProfile | null;
    };

type ReadyMultiTrackSelection = Extract<
  MultiTrackSelection,
  { readonly status: 'ready' }
>;

interface TracksWorkspaceValue {
  readonly active: ActiveTrack | null;
  readonly activeProfile: ElevationProfile | null;
  readonly elevationProgress: TrackElevationPreparationProgress | null;
  readonly error: string | null;
  readonly filteredSummaries: readonly LocalTrackSummary[];
  readonly importError: string | null;
  readonly importFiles: (files: FileList | readonly File[]) => Promise<void>;
  readonly multiTrackMode: boolean;
  readonly multiTrackSelections: readonly MultiTrackSelection[];
  readonly multiTrackStatsMetrics: TrackStatsMetrics | null;
  readonly toggleMultiTrackMode: () => Promise<void>;
  readonly toggleMultiTrackSelection: (summary: LocalTrackSummary) => Promise<void>;
  readonly addRoutePlanPoint: (coordinate: TrackCoordinate) => void;
  readonly clearRoutePlan: () => void;
  readonly importState: 'idle' | 'preparing';
  readonly recalculationState: 'idle' | 'recalculating';
  readonly query: string;
  readonly summaries: readonly LocalTrackSummary[];
  readonly applyGeneratedName: () => void;
  readonly closeActive: () => Promise<boolean>;
  readonly deleteSaved: (summary: LocalTrackSummary) => Promise<void>;
  readonly discardPreview: () => void;
  readonly discardRoutePlan: () => void;
  readonly startTrackMarkerPlacement: () => void;
  readonly renameTrackMarker: (markerId: string, name: string) => Promise<void>;
  readonly deleteTrackMarker: (markerId: string) => Promise<void>;
  readonly recalculateElevation: () => Promise<void>;
  readonly savePreview: () => Promise<void>;
  readonly saveRoutePlan: () => Promise<void>;
  readonly selectSaved: (summary: LocalTrackSummary) => Promise<void>;
  readonly setNextSegmentMode: (mode: RoutePlanSegmentMode) => void;
  readonly startRoutePlan: () => void;
  readonly setActiveName: (name: string) => void;
  readonly setQuery: (query: string) => void;
  readonly undoLastRoutePlanPoint: () => void;
  readonly renameActive: () => Promise<boolean>;
  readonly toggleFavorite: (summary: LocalTrackSummary) => Promise<void>;
}

interface GeneratedNameInput {
  loop: boolean;
  multipleSegments: boolean;
  startPoi?: PoiCandidate;
  middlePoi?: PoiCandidate;
  endPoi?: PoiCandidate;
  fallbackPoi?: PoiCandidate;
}

const TracksWorkspaceContext = createContext<TracksWorkspaceValue | null>(null);

function sortTracks(
  summaries: readonly LocalTrackSummary[],
  sort: TrackSort,
  mapCenter: MapCoordinate | null,
): readonly LocalTrackSummary[] {
  return [...summaries].sort((left, right) => {
    const byFavorite = Number(right.favorite) - Number(left.favorite);
    if (byFavorite !== 0) return byFavorite;

    const byNewest = right.savedAt.localeCompare(left.savedAt, 'en');
    if (sort === 'created') {
      return byNewest === 0 ? left.id.localeCompare(right.id, 'en') : byNewest;
    }
    if (sort === 'oldest') {
      const byOldest = left.savedAt.localeCompare(right.savedAt, 'en');
      return byOldest === 0 ? left.id.localeCompare(right.id, 'en') : byOldest;
    }
    const byName = left.normalizedName.localeCompare(right.normalizedName, 'en');
    if (sort === 'name') {
      if (byName !== 0) return byName;
      return byNewest === 0 ? left.id.localeCompare(right.id, 'en') : byNewest;
    }
    if (mapCenter === null) {
      return byNewest === 0 ? left.id.localeCompare(right.id, 'en') : byNewest;
    }

    const leftDistance = geodesicDistanceKm(
      mapCenter.latitude,
      mapCenter.longitude,
      left.metrics.center[1],
      left.metrics.center[0],
    );
    const rightDistance = geodesicDistanceKm(
      mapCenter.latitude,
      mapCenter.longitude,
      right.metrics.center[1],
      right.metrics.center[0],
    );
    const byDistance = leftDistance - rightDistance;
    if (byDistance !== 0) return byDistance;
    return byName === 0 ? left.id.localeCompare(right.id, 'en') : byName;
  });
}

interface ImportErrorNotice {
  readonly message: string;
  readonly occurrence: number;
}

type PreparedPreviewTrackBuilder = {
  -readonly [Key in keyof PreparedPreviewTrack]: PreparedPreviewTrack[Key];
};
type LocalTrackSummaryBuilder = {
  -readonly [Key in keyof LocalTrackSummary]: LocalTrackSummary[Key];
};

function useTracksWorkspace(): TracksWorkspaceValue {
  const value = use(TracksWorkspaceContext);
  if (value === null) throw new Error('Tracks workspace is unavailable.');
  return value;
}

function useOptionalTracksWorkspace(): TracksWorkspaceValue | null {
  return use(TracksWorkspaceContext);
}

function initialTrackName(file: File, parsed: ParsedGpx): string {
  const embeddedName = parsed.metadata.selectedName ?? parsed.metadata.name;
  if (embeddedName !== undefined && embeddedName.trim().length > 0) {
    return embeddedName.trim();
  }
  const filenameStem = file.name.replace(/\.(gpx|fit|kml)$/iu, '').trim();
  return filenameStem.length > 0 ? filenameStem : 'New track';
}

function toPoiCandidate(
  result: PlaceSearchResult | null,
  coordinate: readonly [number, number],
  lookedUpAt: string,
): PoiCandidate | undefined {
  if (result === null) return undefined;
  const shortLabel = result.label.split(',')[0]?.trim();
  if (shortLabel === undefined || shortLabel.length === 0) return undefined;
  const label = formatGeneratedPoiLabel(shortLabel, result.category);
  return {
    label,
    kind: result.kind,
    matchedCoordinate: coordinate,
    lookedUpAt,
  };
}

function candidateRank(candidate: PoiCandidate): number {
  if (candidate.kind === 'mountain') return 4;
  if (candidate.kind === 'settlement' || candidate.kind === 'water') return 3;
  if (candidate.kind === 'other') return 2;
  return 1;
}

function bestCandidate(
  candidates: readonly (PoiCandidate | undefined)[],
): PoiCandidate | undefined {
  return candidates
    .filter((candidate): candidate is PoiCandidate => candidate !== undefined)
    .sort((left, right) => {
      const byRank = candidateRank(right) - candidateRank(left);
      return byRank === 0 ? left.label.localeCompare(right.label, 'en') : byRank;
    })[0];
}
export function TracksWorkspaceProvider({ children }: PropsWithChildren) {
  const {
    clock,
    database,
    elevationProvider,
    trackContentHasher,
    trackShares,
    trailRouter,
    idGenerator,
    logger,
    userData,
    mapLayers,
    mapViewport,
    searchPlaces,
  } = useRuntimeServices();
  const trackSort = useUiStore((state) => state.trackSort);
  const markerPlacement = useStore(
    mapInteractionStore,
    (state) => state.markerPlacement,
  );
  const markerCreationCommand = useStore(
    mapInteractionStore,
    (state) => state.markerCreationCommand,
  );
  const subscribeViewport = useCallback(
    (listener: () => void) => mapViewport.subscribe(listener),
    [mapViewport],
  );
  const getViewportSnapshot = useCallback(
    () => mapViewport.getViewportSnapshot(),
    [mapViewport],
  );
  const viewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportSnapshot,
  );
  const mapCenter = viewport?.center ?? null;
  const [summaries, setSummaries] = useState<readonly LocalTrackSummary[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<ActiveTrack | null>(null);
  const [multiTrackMode, setMultiTrackMode] = useState(false);
  const editableTrackId =
    active?.kind === 'saved'
      ? active.summary.id
      : active?.kind === 'preview'
        ? active.id
        : null;
  const editableTrackMarkers =
    active?.kind === 'saved'
      ? active.content.markers
      : active?.kind === 'preview'
        ? active.markers
        : null;
  const [multiTrackSelections, setMultiTrackSelections] = useState<
    readonly MultiTrackSelection[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<ImportErrorNotice | null>(null);
  const [importState, setImportState] = useState<'idle' | 'preparing'>('idle');
  const [recalculationState, setRecalculationState] = useState<
    'idle' | 'recalculating'
  >('idle');
  const [elevationProgress, setElevationProgress] =
    useState<TrackElevationPreparationProgress | null>(null);
  const [trackMarkerDraft, setTrackMarkerDraft] =
    useState<TrackMarkerEditorDraft | null>(null);
  useEffect(() => {
    const command = markerCreationCommand;
    if (command?.target.kind !== 'track-marker') return;
    const trackId = command.target.trackId;
    const matchesActiveTrack = !multiTrackMode && trackId === editableTrackId;
    const timer = window.setTimeout(() => {
      consumeMarkerCreationCommand(command.id);
      if (!matchesActiveTrack) return;
      setTrackMarkerDraft({
        trackId,
        coordinate: [command.coordinate.longitude, command.coordinate.latitude],
        initialName: command.suggestedName ?? '',
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [editableTrackId, markerCreationCommand, multiTrackMode]);
  useEffect(() => {
    if (
      markerPlacement?.target.kind === 'track-marker' &&
      (multiTrackMode || markerPlacement.target.trackId !== editableTrackId)
    ) {
      cancelMarkerPlacement();
    }
  }, [editableTrackId, markerPlacement, multiTrackMode]);
  useEffect(() => {
    if (
      trackMarkerDraft === null ||
      (!multiTrackMode && trackMarkerDraft.trackId === editableTrackId)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setTrackMarkerDraft(null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [editableTrackId, multiTrackMode, trackMarkerDraft]);
  const namingAbort = useRef<AbortController | null>(null);
  const preparationAbort = useRef<AbortController | null>(null);
  const recalculationAbort = useRef<AbortController | null>(null);
  const routePlanRequestAbort = useRef<AbortController | null>(null);
  const routePlanRequestOwner = useRef<string | null>(null);
  const routePlanElevationAbort = useRef<AbortController | null>(null);
  const routePlanElevationOwner = useRef<string | null>(null);
  const previewSaveInProgress = useRef(false);
  const routePlanSaveInProgress = useRef(false);
  const importGeneration = useRef(0);
  const multiTrackRequestId = useRef(0);
  const multiTrackSelectionRequests = useRef(new Map<string, number>());
  const latestOpenedTrackId = useRef<string | null>(null);
  const latestOpenedTrackWrite = useRef<Promise<void>>(Promise.resolve());
  const renderedTrackId = useRef<string | null>(null);
  const initiallyRestoredTrackId = useRef<string | null>(null);
  const shareResolutionAbort = useRef<AbortController | null>(null);
  const sharedIntent = useRef(parseTrackShareLocation(window.location.hash));
  const restorationAttempted = useRef(false);
  const readyMultiTrackSelections = useMemo(
    () =>
      multiTrackSelections.filter(
        (selection): selection is ReadyMultiTrackSelection =>
          selection.status === 'ready',
      ),
    [multiTrackSelections],
  );
  const visibleTrackMarkers = useMemo(() => {
    if (multiTrackMode) return EMPTY_TRACK_MARKERS;
    if (active?.kind === 'saved') return active.content.markers;
    if (active?.kind === 'preview') return active.markers;
    return EMPTY_TRACK_MARKERS;
  }, [active, multiTrackMode]);

  useEffect(() => {
    mapLayers?.setTrackMarkers(visibleTrackMarkers);
  }, [mapLayers, visibleTrackMarkers]);

  useEffect(
    () => () => {
      mapLayers?.setTrackMarkers([]);
    },
    [mapLayers],
  );

  const saveLatestOpenedTrackId = useCallback(
    async (trackId: string | null) => {
      latestOpenedTrackId.current = trackId;
      const write = latestOpenedTrackWrite.current
        .catch(() => undefined)
        .then(async () => {
          await database.saveLatestOpenedTrackId(latestOpenedTrackId.current);
        });
      latestOpenedTrackWrite.current = write;
      await write;
    },
    [database],
  );
  const reloadSummaries = useCallback(async () => {
    try {
      const loaded = await database.listLocalTracks();
      setSummaries(loaded);
      if (!restorationAttempted.current) {
        restorationAttempted.current = true;
        if (sharedIntent.current.kind !== 'none') return;
        const latestTrackId = await database.loadLatestOpenedTrackId();
        const latestSummary = loaded.find((summary) => summary.id === latestTrackId);
        if (latestSummary !== undefined) {
          try {
            const content = await database.loadLocalTrackContent(latestSummary.id);
            initiallyRestoredTrackId.current = latestSummary.id;
            setActive({
              kind: 'saved',
              summary: latestSummary,
              content,
              draftName: latestSummary.name,
            });
          } catch {
            await database.saveLatestOpenedTrackId(null);
          }
        } else if (latestTrackId !== null) {
          await database.saveLatestOpenedTrackId(null);
        }
      }
    } catch {
      setError('Saved tracks could not be loaded from this browser.');
    }
  }, [database]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void reloadSummaries();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      namingAbort.current?.abort();
      preparationAbort.current?.abort();
      recalculationAbort.current?.abort();
      routePlanRequestAbort.current?.abort();
      routePlanElevationAbort.current?.abort();
      shareResolutionAbort.current?.abort();
    };
  }, [reloadSummaries]);
  useEffect(() => {
    const intent = sharedIntent.current;
    if (intent.kind === 'none') return undefined;
    if (intent.kind === 'invalid' || trackShares === null) {
      const timeout = window.setTimeout(() => {
        setError(
          intent.kind === 'invalid'
            ? 'This track link is invalid.'
            : 'Shared tracks are unavailable because cloud features are not configured.',
        );
      }, 0);
      return () => {
        window.clearTimeout(timeout);
      };
    }
    const controller = new AbortController();
    shareResolutionAbort.current = controller;
    const generation = importGeneration.current;
    void trackShares.resolve(intent.token, controller.signal).then(
      (shared) => {
        if (controller.signal.aborted || generation !== importGeneration.current) {
          return;
        }
        const sourceSegments = shared.trackPoints.map((points) => ({ points }));
        const metrics = calculateTrackMetrics(sourceSegments);
        const parsed: ParsedGpx = {
          parserVersion: GPX_PARSER_VERSION,
          geometryKind: shared.metadata.geometryKind,
          segments: sourceSegments,
          waypoints: [],
          pointCount: shared.trackPoints.reduce(
            (count, points) => count + points.length,
            0,
          ),
          metadata: {
            version: '1.1',
            name: shared.metadata.name,
            selectedName: shared.metadata.name,
            links: [],
          },
          warnings: [],
        };
        const sharedTrack: SharedTrackSelection = {
          kind: 'shared',
          id: `shared:${shared.contentHash}`,
          file: new File([], safeTrackFilename(shared.metadata.name, 'gpx')),
          parsed,
          sourceFormat: shared.metadata.sourceFormat,
          name: shared.metadata.name,
          markers: [],
          preparationStatus: 'ready',
          sourceSegments,
          sourceProfile: null,
          sourceMetrics: metrics,
          calculatedSegments: null,
          calculatedProfile: null,
          calculatedMetrics: null,
          namingStatus: 'unavailable',
        };
        setActive(sharedTrack);
        void prepareImportedTrack(
          sourceSegments,
          elevationProvider,
          controller.signal,
          {
            onProgress: (progress) => {
              if (
                controller.signal.aborted ||
                generation !== importGeneration.current
              ) {
                return;
              }
              setElevationProgress(progress);
            },
          },
        )
          .then((prepared) => {
            if (controller.signal.aborted || generation !== importGeneration.current) {
              return;
            }
            setElevationProgress(null);
            setActive((current) =>
              current?.kind === 'shared' && current.id === sharedTrack.id
                ? { ...current, ...prepared }
                : current,
            );
          })
          .catch(() => {
            if (!controller.signal.aborted && generation === importGeneration.current) {
              setElevationProgress(null);
              logger.log({
                level: 'warn',
                name: 'shared-track.elevation-preparation.failed',
              });
            }
          });
      },
      (error: unknown) => {
        if (controller.signal.aborted || generation !== importGeneration.current) {
          return;
        }
        setError(
          error instanceof TrackShareError && error.category === 'share-not-found'
            ? 'This shared track is unavailable.'
            : 'Shared track could not be loaded. Try again.',
        );
      },
    );
    return () => {
      controller.abort();
    };
  }, [elevationProvider, logger, trackShares]);

  useEffect(
    () =>
      userData.subscribeTracksChanged(() => {
        void reloadSummaries();
        if (active?.kind === 'saved') {
          void (async () => {
            const summary = await database.localTracks.get(active.summary.id);
            if (summary === undefined) {
              setActive(null);
              return;
            }
            const content = await database.loadLocalTrackContent(summary.id);
            setActive((current) =>
              current?.kind === 'saved' && current.summary.id === summary.id
                ? { kind: 'saved', summary, content, draftName: summary.name }
                : current,
            );
          })().catch(() => {
            setActive(null);
          });
        }

        const refreshes = multiTrackSelections.flatMap((selection) => {
          if (
            multiTrackSelectionRequests.current.get(selection.summary.id) !==
            selection.requestId
          ) {
            return [];
          }
          const requestId = ++multiTrackRequestId.current;
          multiTrackSelectionRequests.current.set(selection.summary.id, requestId);
          return [
            {
              previousRequestId: selection.requestId,
              requestId,
              summary: selection.summary,
            },
          ];
        });
        if (refreshes.length === 0) return;
        setMultiTrackSelections((current) =>
          current.map((selection) => {
            const refresh = refreshes.find(
              (candidate) =>
                candidate.summary.id === selection.summary.id &&
                candidate.previousRequestId === selection.requestId,
            );
            return refresh === undefined
              ? selection
              : {
                  status: 'loading',
                  requestId: refresh.requestId,
                  summary: selection.summary,
                };
          }),
        );
        for (const refresh of refreshes) {
          void (async () => {
            const summary = await database.localTracks.get(refresh.summary.id);
            if (summary === undefined) {
              throw new Error('The selected track no longer exists.');
            }
            const content = await database.loadLocalTrackContent(summary.id);
            const profile = elevationProfileForSavedTrack(content);
            if (
              multiTrackSelectionRequests.current.get(summary.id) !== refresh.requestId
            ) {
              return;
            }
            setMultiTrackSelections((current) =>
              current.map((selection) =>
                selection.requestId === refresh.requestId
                  ? {
                      status: 'ready',
                      requestId: refresh.requestId,
                      summary,
                      content,
                      profile,
                    }
                  : selection,
              ),
            );
          })().catch(() => {
            if (
              multiTrackSelectionRequests.current.get(refresh.summary.id) !==
              refresh.requestId
            ) {
              return;
            }
            multiTrackSelectionRequests.current.delete(refresh.summary.id);
            setMultiTrackSelections((current) =>
              current.filter((selection) => selection.requestId !== refresh.requestId),
            );
            setError('The track could not be added to multi-track view.');
          });
        }
      }),
    [active, database, multiTrackSelections, reloadSummaries, userData],
  );

  useEffect(() => {
    const hasUnsavedWork =
      active?.kind === 'preview' ||
      (active?.kind === 'route-plan' && active.waypoints.length > 0);
    if (!hasUnsavedWork) return undefined;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => {
      window.removeEventListener('beforeunload', preventUnload);
    };
  }, [active]);

  useEffect(() => {
    if (importError === null) return undefined;
    const timeout = window.setTimeout(() => {
      setImportError(null);
    }, 5_000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [importError]);

  useEffect(() => {
    if (multiTrackMode) {
      renderedTrackId.current = null;
      mapLayers?.clearRoutePlanGeometry();
      if (readyMultiTrackSelections.length === 0) {
        mapLayers?.clearImportedTrackGeometry();
        return;
      }
      const segments = readyMultiTrackSelections.flatMap((selection) =>
        localTrackSegments(selection.content),
      );
      const result = mapLayers?.setImportedTrackGeometry(segments);
      if (result?.status === 'failed') return;
      const metrics = calculateTrackMetrics(
        readyMultiTrackSelections.flatMap((selection) =>
          selection.content.trackPoints.map((points) => ({ points })),
        ),
      );
      requestMapFitBounds(
        {
          west: metrics.bounds.west,
          south: metrics.bounds.south,
          east: metrics.bounds.crossesAntimeridian
            ? metrics.bounds.east + 360
            : metrics.bounds.east,
          north: metrics.bounds.north,
        },
        15,
      );
      return;
    }
    if (active === null) {
      renderedTrackId.current = null;
      mapLayers?.clearImportedTrackGeometry();
      mapLayers?.clearRoutePlanGeometry();
      return;
    }
    if (active.kind === 'route-plan') {
      renderedTrackId.current = null;
      mapLayers?.clearImportedTrackGeometry();
      mapLayers?.setRoutePlanGeometry(
        active.legs.flatMap((leg) => leg.sections),
        [...active.waypoints, ...active.queuedWaypoints],
      );
      return;
    }
    mapLayers?.clearRoutePlanGeometry();
    const trackId =
      active.kind === 'preview' || active.kind === 'shared'
        ? `${active.id}:${active.preparationStatus}`
        : active.summary.id;
    if (renderedTrackId.current === trackId) return;
    const segments =
      active.kind === 'saved'
        ? localTrackSegments(active.content)
        : (active.preparationStatus === 'ready'
            ? active.sourceSegments
            : active.parsed.segments
          ).map((segment) => segment.points.map((point) => point.coordinate));
    const metrics =
      active.kind === 'saved'
        ? active.summary.metrics
        : active.preparationStatus === 'ready'
          ? active.sourceMetrics
          : calculateTrackMetrics(active.parsed.segments);
    const result = mapLayers?.setImportedTrackGeometry(segments);
    if (result?.status === 'failed') return;
    renderedTrackId.current = trackId;
    if (initiallyRestoredTrackId.current !== trackId) {
      requestMapFitBounds(
        {
          west: metrics.bounds.west,
          south: metrics.bounds.south,
          east: metrics.bounds.crossesAntimeridian
            ? metrics.bounds.east + 360
            : metrics.bounds.east,
          north: metrics.bounds.north,
        },
        15,
      );
    }
  }, [active, mapLayers, multiTrackMode, readyMultiTrackSelections]);

  const generateName = useCallback(
    async (preview: PreparedPreviewTrack, controller: AbortController) => {
      if (searchPlaces === null) {
        setActive((current) =>
          current?.kind === 'preview' &&
          current.preparationStatus === 'ready' &&
          current.id === preview.id
            ? { ...current, namingStatus: 'unavailable' }
            : current,
        );
        return;
      }
      const segments =
        preview.sourceProfile === null
          ? (preview.calculatedSegments ?? preview.sourceSegments)
          : preview.sourceSegments;
      const multipleSegments = segments.length > 1;
      const lookedUpAt = clock.now().toISOString();
      try {
        if (multipleSegments) {
          const points = segments.flatMap((segment) => segment.points);
          const anchors = [0.25, 0.5, 0.75].map(
            (fraction) => pointNearestFraction(points, fraction).coordinate,
          );
          const candidates: (PoiCandidate | undefined)[] = [];
          for (const coordinate of anchors) {
            const result = await searchPlaces.reverse(
              { longitude: coordinate[0], latitude: coordinate[1] },
              controller.signal,
            );
            candidates.push(toPoiCandidate(result, coordinate, lookedUpAt));
          }
          const fallbackPoi = bestCandidate(candidates);
          const generatedNameInput: GeneratedNameInput = {
            loop: false,
            multipleSegments: true,
          };
          if (fallbackPoi !== undefined) generatedNameInput.fallbackPoi = fallbackPoi;
          const generatedName = generateEnglishTrackName(generatedNameInput);
          setActive((current) => {
            if (
              current?.kind !== 'preview' ||
              current.preparationStatus !== 'ready' ||
              current.id !== preview.id
            )
              return current;
            const updated: PreparedPreviewTrackBuilder = {
              ...current,
              namingStatus: 'ready',
            };
            if (fallbackPoi !== undefined) updated.fallbackPoi = fallbackPoi;
            if (generatedName !== null) updated.generatedName = generatedName;
            return updated;
          });
          return;
        }

        const segment = segments[0];
        if (segment === undefined) return;
        const summit = findDominantSummit(segment.points);
        const middlePoint =
          summit === null
            ? pointNearestFraction(segment.points, 0.5)
            : ({ coordinate: summit.coordinate } satisfies Pick<
                TrackPoint,
                'coordinate'
              >);
        const loop = isLoop(segments, preview.sourceMetrics.distanceMeters);
        const reverseCandidate = async (
          coordinate: readonly [number, number],
        ): Promise<PoiCandidate | undefined> => {
          const result = await searchPlaces.reverse(
            { longitude: coordinate[0], latitude: coordinate[1] },
            controller.signal,
          );
          return toPoiCandidate(result, coordinate, lookedUpAt);
        };
        let middlePoi: PoiCandidate | undefined;
        if (summit !== null) {
          try {
            const result = await searchPlaces.nearest(
              {
                longitude: summit.coordinate[0],
                latitude: summit.coordinate[1],
              },
              controller.signal,
            );
            if (result !== null) {
              const matchedCoordinate = [
                result.coordinate.longitude,
                result.coordinate.latitude,
              ] as const;
              middlePoi = toPoiCandidate(result, matchedCoordinate, lookedUpAt);
            }
          } catch (nearestError) {
            if (controller.signal.aborted) throw nearestError;
            logger.log({ level: 'warn', name: 'local-track.nearby-poi.failed' });
          }
        }
        middlePoi ??= await reverseCandidate(middlePoint.coordinate);
        let startPoi: PoiCandidate | undefined;
        let endPoi: PoiCandidate | undefined;
        if (!loop) {
          const firstPoint = segment.points[0];
          const lastPoint = segment.points[segment.points.length - 1];
          if (firstPoint !== undefined) {
            startPoi = await reverseCandidate(firstPoint.coordinate);
          }
          if (lastPoint !== undefined) {
            endPoi = await reverseCandidate(lastPoint.coordinate);
          }
        }
        const fallbackPoi = loop ? middlePoi : undefined;
        const generatedNameInput: GeneratedNameInput = {
          loop,
          multipleSegments: false,
        };
        if (startPoi !== undefined) generatedNameInput.startPoi = startPoi;
        if (middlePoi !== undefined) generatedNameInput.middlePoi = middlePoi;
        if (endPoi !== undefined) generatedNameInput.endPoi = endPoi;
        if (fallbackPoi !== undefined) generatedNameInput.fallbackPoi = fallbackPoi;
        const generatedName = generateEnglishTrackName(generatedNameInput);
        setActive((current) => {
          if (
            current?.kind !== 'preview' ||
            current.preparationStatus !== 'ready' ||
            current.id !== preview.id
          )
            return current;
          const updated: PreparedPreviewTrackBuilder = {
            ...current,
            namingStatus: 'ready',
            middleAnchorKind: summit === null ? 'distance-midpoint' : 'dominant-summit',
          };
          if (startPoi !== undefined) updated.startPoi = startPoi;
          if (middlePoi !== undefined) updated.middlePoi = middlePoi;
          if (endPoi !== undefined) updated.endPoi = endPoi;
          if (fallbackPoi !== undefined) updated.fallbackPoi = fallbackPoi;
          if (generatedName !== null) updated.generatedName = generatedName;
          return updated;
        });
      } catch {
        if (controller.signal.aborted) return;
        logger.log({ level: 'warn', name: 'local-track.naming.failed' });
        setActive((current) =>
          current?.kind === 'preview' &&
          current.preparationStatus === 'ready' &&
          current.id === preview.id
            ? { ...current, namingStatus: 'unavailable' }
            : current,
        );
      }
    },
    [clock, logger, searchPlaces],
  );

  const importFiles = useCallback(
    async (files: FileList | readonly File[]) => {
      if (routePlanSaveInProgress.current) return;
      const reportImportError = (message: string) => {
        setImportError((current) => ({
          message,
          occurrence: (current?.occurrence ?? 0) + 1,
        }));
      };
      const selected = Array.from(files);
      if (selected.length !== 1) {
        reportImportError('Choose exactly one GPX, FIT, or KML file.');
        return;
      }
      const file = selected[0];
      const sourceFormat = file === undefined ? null : trackSourceFormat(file.name);
      if (file === undefined || sourceFormat === null) {
        reportImportError('Choose a file with a .gpx, .fit, or .kml extension.');
        return;
      }
      const replacingUnsavedTrack =
        active?.kind === 'preview' ||
        (active?.kind === 'route-plan' && active.waypoints.length > 0);
      if (
        replacingUnsavedTrack &&
        !window.confirm('Discard the current unsaved track and import another file?')
      ) {
        return;
      }
      setMultiTrackMode(false);
      setMultiTrackSelections([]);
      multiTrackSelectionRequests.current.clear();
      initiallyRestoredTrackId.current = null;
      namingAbort.current?.abort();
      preparationAbort.current?.abort();
      recalculationAbort.current?.abort();
      routePlanRequestAbort.current?.abort();
      routePlanElevationAbort.current?.abort();
      setRecalculationState('idle');
      setElevationProgress(null);
      const generation = importGeneration.current + 1;
      importGeneration.current = generation;
      setActive(null);
      setImportError(null);
      setError(null);
      setImportState('preparing');
      const controller = new AbortController();
      preparationAbort.current = controller;
      const importIsStale = (): boolean =>
        controller.signal.aborted || generation !== importGeneration.current;
      try {
        const parsed = await parseTrackFile(file, sourceFormat);
        if (importIsStale()) return;
        const previewBase: PreviewTrackBase = {
          kind: 'preview',
          id: `local:${idGenerator.generate()}`,
          file,
          parsed,
          sourceFormat,
          name: initialTrackName(file, parsed),
          markers: parsed.waypoints.map((waypoint) => ({
            id: idGenerator.generate(),
            name: waypoint.name,
            coordinate: waypoint.coordinate,
          })),
        };
        setActive({ ...previewBase, preparationStatus: 'preparing' });
        try {
          const prepared = await prepareImportedTrack(
            parsed.segments,
            elevationProvider,
            controller.signal,
            {
              onProgress: (progress) => {
                if (importIsStale()) return;
                setElevationProgress(progress);
              },
            },
          );
          if (importIsStale()) return;
          const preview: PreparedPreviewTrack = {
            ...previewBase,
            preparationStatus: 'ready',
            ...prepared,
            namingStatus: 'loading',
          };
          setActive((current) =>
            current?.kind === 'preview' && current.id === preview.id
              ? { ...preview, name: current.name }
              : current,
          );
          setElevationProgress(null);
          const namingController = new AbortController();
          namingAbort.current = namingController;
          void generateName(preview, namingController);
        } catch (preparationFailure) {
          if (importIsStale()) return;
          logger.log({
            level: 'warn',
            name: 'local-track.elevation-preparation.failed',
          });
          const preparationError =
            preparationFailure instanceof Error
              ? preparationFailure.message
              : 'Elevation preparation failed.';
          setActive((current) =>
            current?.kind === 'preview' && current.id === previewBase.id
              ? {
                  ...previewBase,
                  name: current.name,
                  preparationStatus: 'failed',
                  preparationError,
                }
              : current,
          );
          setElevationProgress(null);
        }
      } catch (importFailure) {
        if (controller.signal.aborted || generation !== importGeneration.current)
          return;
        logger.log({ level: 'warn', name: 'local-track.import.failed' });
        reportImportError(
          importFailure instanceof Error
            ? importFailure.message
            : 'The track file could not be imported.',
        );
        setElevationProgress(null);
      } finally {
        if (generation === importGeneration.current) {
          preparationAbort.current = null;
          setElevationProgress(null);
          setImportState('idle');
        }
      }
    },
    [active, elevationProvider, generateName, idGenerator, logger],
  );

  const startRoutePlan = useCallback(() => {
    if (routePlanSaveInProgress.current) return;
    if (trailRouter === null) return;
    const replacingUnsavedTrack =
      active?.kind === 'preview' ||
      (active?.kind === 'route-plan' && active.waypoints.length > 0);
    if (
      replacingUnsavedTrack &&
      !window.confirm('Discard the current unsaved track and start a new route?')
    ) {
      return;
    }
    setMultiTrackMode(false);
    setMultiTrackSelections([]);
    multiTrackSelectionRequests.current.clear();
    initiallyRestoredTrackId.current = null;
    namingAbort.current?.abort();
    preparationAbort.current?.abort();
    recalculationAbort.current?.abort();
    routePlanRequestAbort.current?.abort();
    routePlanElevationAbort.current?.abort();
    setRecalculationState('idle');
    setElevationProgress(null);
    setImportState('idle');
    importGeneration.current += 1;
    setActive(createRoutePlanDraft(`local:${idGenerator.generate()}`));
    setError(null);
  }, [active, idGenerator, trailRouter]);

  const enrichRoutePlan = useCallback(
    (draft: RoutePlanDraft) => {
      if (
        draft.status !== 'elevation-enriching' ||
        draft.segment === null ||
        draft.pendingRequest !== null ||
        draft.queuedWaypoints.length > 0
      ) {
        return;
      }
      const planId = draft.id;
      const requestGeneration = draft.requestGeneration;
      const owner = `${planId}:${String(requestGeneration)}`;
      if (
        routePlanElevationOwner.current === owner &&
        routePlanElevationAbort.current !== null
      ) {
        return;
      }
      const controller = new AbortController();
      routePlanElevationAbort.current?.abort();
      routePlanElevationAbort.current = controller;
      routePlanElevationOwner.current = owner;
      void prepareImportedTrack([draft.segment], elevationProvider, controller.signal, {
        preserveGeometry: true,
        sampleIntervalMeters: 30,
        maximumElevationSamples: 5_000,
        onProgress: (progress) => {
          if (
            !controller.signal.aborted &&
            routePlanElevationAbort.current === controller &&
            routePlanElevationOwner.current === owner
          ) {
            setElevationProgress(progress);
          }
        },
      })
        .then((prepared) => {
          const ownsElevation =
            routePlanElevationAbort.current === controller &&
            routePlanElevationOwner.current === owner;
          if (controller.signal.aborted || !ownsElevation) return;
          const segment =
            prepared.calculatedSegments?.[0] ?? prepared.sourceSegments[0];
          const profile = prepared.calculatedProfile ?? prepared.sourceProfile;
          if (segment === undefined || profile === null) {
            throw new Error('Elevation data is unavailable for this route.');
          }
          setActive((current) =>
            current?.kind === 'route-plan' &&
            current.id === planId &&
            current.requestGeneration === requestGeneration &&
            current.status === 'elevation-enriching' &&
            current.pendingRequest === null &&
            current.queuedWaypoints.length === 0
              ? finishRoutePlanElevation(current, segment, profile)
              : current,
          );
        })
        .catch(() => {
          const ownsElevation =
            routePlanElevationAbort.current === controller &&
            routePlanElevationOwner.current === owner;
          if (controller.signal.aborted || !ownsElevation) return;
          setActive((current) =>
            current?.kind === 'route-plan' &&
            current.id === planId &&
            current.requestGeneration === requestGeneration &&
            current.status === 'elevation-enriching' &&
            current.pendingRequest === null &&
            current.queuedWaypoints.length === 0
              ? finishRoutePlanElevation(current, null, null)
              : current,
          );
        })
        .finally(() => {
          if (
            routePlanElevationAbort.current === controller &&
            routePlanElevationOwner.current === owner
          ) {
            routePlanElevationAbort.current = null;
            routePlanElevationOwner.current = null;
            setElevationProgress(null);
          }
        });
    },
    [elevationProvider],
  );

  useEffect(() => {
    if (
      active?.kind === 'route-plan' &&
      active.status === 'elevation-enriching' &&
      active.pendingRequest === null &&
      active.queuedWaypoints.length === 0
    ) {
      enrichRoutePlan(active);
    }
  }, [active, enrichRoutePlan]);

  useEffect(() => {
    if (active?.kind !== 'route-plan' || active.pendingRequest === null) return;
    const request = active.pendingRequest;
    const owner = `${active.id}:${String(request.generation)}`;
    if (routePlanRequestOwner.current === owner) return;

    const controller = new AbortController();
    routePlanRequestAbort.current?.abort();
    routePlanRequestAbort.current = controller;
    routePlanRequestOwner.current = owner;
    const unavailable = {
      status: 'failed',
      reason: 'routing-data-unavailable',
    } as const;
    void (
      trailRouter === null
        ? Promise.resolve(unavailable)
        : trailRouter
            .route(
              { start: request.start, destination: request.destination },
              controller.signal,
              (progress) => {
                setActive((current) =>
                  current?.kind === 'route-plan' &&
                  current.id === active.id &&
                  current.status === 'calculating' &&
                  current.pendingRequest === request &&
                  current.requestGeneration === request.generation &&
                  routePlanRequestAbort.current === controller &&
                  routePlanRequestOwner.current === owner
                    ? updateRoutePlanProgress(current, request.generation, progress)
                    : current,
                );
              },
            )
            .catch(() => unavailable)
    )
      .then((result) => {
        const ownsRequest =
          routePlanRequestAbort.current === controller &&
          routePlanRequestOwner.current === owner;
        if (controller.signal.aborted || !ownsRequest) return;
        setActive((current) => {
          if (
            current?.kind !== 'route-plan' ||
            current.id !== active.id ||
            current.status !== 'calculating' ||
            current.pendingRequest !== request ||
            current.requestGeneration !== request.generation
          ) {
            return current;
          }
          const completed = completeRoutePlanPoint(current, request, result);
          return completed.pendingRequest === null &&
            completed.queuedWaypoints.length === 0 &&
            completed.status === 'route-ready'
            ? beginRoutePlanElevation(completed)
            : completed;
        });
      })
      .finally(() => {
        if (
          routePlanRequestAbort.current === controller &&
          routePlanRequestOwner.current === owner
        ) {
          routePlanRequestAbort.current = null;
          routePlanRequestOwner.current = null;
        }
      });
  }, [active, trailRouter]);

  const addRoutePlanPoint = useCallback((coordinate: TrackCoordinate) => {
    if (routePlanSaveInProgress.current) return;
    routePlanElevationAbort.current?.abort();
    routePlanElevationOwner.current = null;
    setElevationProgress(null);
    setActive((current) => {
      if (current?.kind !== 'route-plan') return current;
      const next = enqueueRoutePlanPoint(current, coordinate);
      return next.status === 'route-ready' &&
        next.pendingRequest === null &&
        next.queuedWaypoints.length === 0
        ? beginRoutePlanElevation(next)
        : next;
    });
  }, []);

  const setNextSegmentMode = useCallback((mode: RoutePlanSegmentMode) => {
    if (routePlanSaveInProgress.current) return;
    setActive((current) =>
      current?.kind === 'route-plan' ? setRoutePlanSegmentMode(current, mode) : current,
    );
  }, []);

  const undoLastRoutePlanPoint = useCallback(() => {
    if (routePlanSaveInProgress.current) return;
    if (active?.kind !== 'route-plan') return;
    routePlanRequestAbort.current?.abort();
    routePlanElevationAbort.current?.abort();
    setElevationProgress(null);
    const undone = undoRoutePlanPoint(active);
    setActive((current) =>
      current?.kind === 'route-plan' && current.id === active.id
        ? undone.status === 'route-ready'
          ? beginRoutePlanElevation(undone)
          : undone
        : current,
    );
  }, [active]);

  const clearRoutePlan = useCallback(() => {
    if (routePlanSaveInProgress.current) return;
    routePlanRequestAbort.current?.abort();
    routePlanElevationAbort.current?.abort();
    setElevationProgress(null);
    setActive((current) =>
      current?.kind === 'route-plan' ? clearRoutePlanDraft(current) : current,
    );
  }, []);

  const discardRoutePlan = useCallback(() => {
    if (routePlanSaveInProgress.current) return;
    if (
      active?.kind === 'route-plan' &&
      active.waypoints.length > 0 &&
      !window.confirm('Discard this unsaved track?')
    ) {
      return;
    }
    routePlanRequestAbort.current?.abort();
    routePlanElevationAbort.current?.abort();
    setElevationProgress(null);
    importGeneration.current += 1;
    setActive((current) => (current?.kind === 'route-plan' ? null : current));
    setError(null);
  }, [active]);

  const saveRoutePlan = useCallback(async () => {
    if (
      active?.kind !== 'route-plan' ||
      !canSaveRoutePlan(active) ||
      active.segment === null ||
      active.metrics === null ||
      routePlanSaveInProgress.current
    ) {
      return;
    }
    routePlanSaveInProgress.current = true;
    routePlanRequestAbort.current?.abort();
    routePlanElevationAbort.current?.abort();
    routePlanElevationAbort.current = null;
    routePlanElevationOwner.current = null;
    setElevationProgress(null);
    const planId = active.id;
    const previousStatus = active.status;
    setActive((current) =>
      current?.kind === 'route-plan' && current.id === planId
        ? { ...current, status: 'saving' }
        : current,
    );
    const generation = importGeneration.current;
    try {
      const normalizedName = normalizeLocalTrackName(active.name);
      const savedAt = clock.now().toISOString();
      const content: LocalTrackContent = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        trackId: planId,
        trackPoints: [active.segment.points],
        markers: [],
      };
      const summary: LocalTrackSummary = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        id: planId,
        ...normalizedName,
        savedAt,
        updatedAt: savedAt,
        contentHash: await trackContentHasher.hash(content),
        sourceFilename: safeTrackFilename(normalizedName.name, 'gpx'),
        sourceFormat: 'gpx',
        favorite: false,
        geometryKind: 'route',
        pointCount: active.segment.points.length,
        segmentCount: 1,
        metrics: active.metrics,
        metadata: {
          version: '1.1',
          name: normalizedName.name,
          selectedName: normalizedName.name,
          links: [],
        },
        warnings: [],
      };
      await database.saveLocalTrack(summary, content);
      void userData.trackSaved(summary.id);
      if (generation !== importGeneration.current) return;
      await saveLatestOpenedTrackId(summary.id);
      if (generation !== importGeneration.current) return;
      setActive((current) =>
        current?.kind === 'route-plan' &&
        current.id === planId &&
        current.status === 'saving' &&
        generation === importGeneration.current
          ? { kind: 'saved', summary, content, draftName: summary.name }
          : current,
      );
      await reloadSummaries();
      setError(null);
    } catch (saveError) {
      if (generation !== importGeneration.current) return;
      setActive((current) =>
        current?.kind === 'route-plan' &&
        current.id === planId &&
        current.status === 'saving'
          ? { ...current, status: previousStatus }
          : current,
      );
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'The route could not be saved.',
      );
    } finally {
      routePlanSaveInProgress.current = false;
    }
  }, [
    active,
    clock,
    database,
    reloadSummaries,
    saveLatestOpenedTrackId,
    trackContentHasher,
    userData,
  ]);

  const savePreview = useCallback(async () => {
    if (
      (active?.kind !== 'preview' && active?.kind !== 'shared') ||
      active.preparationStatus !== 'ready' ||
      recalculationState === 'recalculating' ||
      recalculationAbort.current !== null ||
      previewSaveInProgress.current
    ) {
      return;
    }
    previewSaveInProgress.current = true;
    const previewId = active.id;
    const generation = importGeneration.current;
    const previewNamingAbort = namingAbort.current;
    try {
      const savedTrackId = active.id.startsWith('shared:')
        ? `local:${idGenerator.generate()}`
        : active.id;
      const normalizedName = normalizeLocalTrackName(active.name);
      const savedAt = clock.now().toISOString();
      const content: LocalTrackContent = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        trackId: savedTrackId,
        trackPoints: active.sourceSegments.map((segment) => segment.points),
        markers: active.markers,
        ...(active.calculatedSegments === null
          ? {}
          : {
              calculatedTrackPoints: active.calculatedSegments.map(
                (segment) => segment.points,
              ),
            }),
      };
      const summary: LocalTrackSummaryBuilder = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        id: savedTrackId,
        ...normalizedName,
        savedAt,
        updatedAt: savedAt,
        contentHash: await trackContentHasher.hash(content),
        sourceFilename: active.file.name,
        sourceFormat: active.sourceFormat,
        favorite: false,
        geometryKind: active.parsed.geometryKind,
        pointCount: active.sourceSegments.reduce(
          (count, segment) => count + segment.points.length,
          0,
        ),
        segmentCount: active.sourceSegments.length,
        metrics: active.sourceMetrics,
        metadata: active.parsed.metadata,
        warnings: active.parsed.warnings,
      };
      if (active.calculatedMetrics !== null) {
        summary.calculatedMetrics = active.calculatedMetrics;
      }
      if (active.generatedName !== undefined)
        summary.generatedName = active.generatedName;
      if (active.middleAnchorKind !== undefined) {
        summary.middleAnchorKind = active.middleAnchorKind;
      }
      if (active.startPoi !== undefined) summary.startPoi = active.startPoi;
      if (active.middlePoi !== undefined) summary.middlePoi = active.middlePoi;
      if (active.endPoi !== undefined) summary.endPoi = active.endPoi;
      if (active.fallbackPoi !== undefined) summary.fallbackPoi = active.fallbackPoi;
      await database.saveLocalTrack(summary, content);
      void userData.trackSaved(summary.id);
      if (generation !== importGeneration.current) return;
      await saveLatestOpenedTrackId(summary.id);
      if (generation !== importGeneration.current) return;
      if (namingAbort.current === previewNamingAbort) previewNamingAbort?.abort();
      setActive((current) =>
        (current?.kind === 'preview' || current?.kind === 'shared') &&
        current.preparationStatus === 'ready' &&
        current.id === previewId &&
        generation === importGeneration.current
          ? { kind: 'saved', summary, content, draftName: summary.name }
          : current,
      );
      if (previewId.startsWith('shared:')) {
        window.history.replaceState(null, '', '#tracks');
      }
      await reloadSummaries();
      setError(null);
    } catch (saveError) {
      if (generation !== importGeneration.current) return;
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'The track could not be saved.',
      );
    } finally {
      previewSaveInProgress.current = false;
    }
  }, [
    active,
    clock,
    idGenerator,
    database,
    recalculationState,
    reloadSummaries,
    saveLatestOpenedTrackId,
    trackContentHasher,
    userData,
  ]);

  const recalculateElevation = useCallback(async () => {
    if (
      active === null ||
      active.kind === 'route-plan' ||
      (active.kind === 'preview' && active.preparationStatus === 'preparing') ||
      recalculationState === 'recalculating' ||
      previewSaveInProgress.current
    ) {
      return;
    }
    initiallyRestoredTrackId.current = null;
    recalculationAbort.current?.abort();
    const controller = new AbortController();
    recalculationAbort.current = controller;
    setRecalculationState('recalculating');
    setElevationProgress(null);
    setError(null);
    const activeId =
      active.kind === 'preview' || active.kind === 'shared'
        ? active.id
        : active.summary.id;
    const generation = importGeneration.current;
    try {
      const sourceSegments =
        active.kind === 'preview' || active.kind === 'shared'
          ? active.parsed.segments
          : active.content.trackPoints.map((points) => ({ points }));
      const prepared = await prepareImportedTrack(
        sourceSegments,
        elevationProvider,
        controller.signal,
        {
          onProgress: (progress) => {
            if (
              controller.signal.aborted ||
              recalculationAbort.current !== controller ||
              generation !== importGeneration.current
            ) {
              return;
            }
            setElevationProgress(progress);
          },
        },
      );
      controller.signal.throwIfAborted();
      if (
        recalculationAbort.current !== controller ||
        generation !== importGeneration.current
      ) {
        return;
      }
      setElevationProgress(null);
      renderedTrackId.current = null;
      if (active.kind === 'preview') {
        setActive((current) => {
          if (current?.kind !== 'preview' || current.id !== activeId) {
            return current;
          }
          const updated: PreparedPreviewTrack = {
            ...current,
            preparationStatus: 'ready',
            ...prepared,
            namingStatus:
              current.preparationStatus === 'ready'
                ? current.namingStatus
                : 'unavailable',
          };
          return updated;
        });
      } else if (active.kind === 'shared') {
        setActive((current) => {
          if (current?.kind !== 'shared' || current.id !== activeId) {
            return current;
          }
          return { ...current, preparationStatus: 'ready', ...prepared };
        });
      } else {
        const summary = await database.replaceCalculatedTrackElevation(
          activeId,
          prepared.calculatedMetrics,
          prepared.calculatedSegments?.map((segment) => segment.points),
        );
        const content = await database.loadLocalTrackContent(activeId);
        controller.signal.throwIfAborted();
        setActive((current) =>
          current?.kind === 'saved' && current.summary.id === activeId
            ? { ...current, summary, content }
            : current,
        );
        await reloadSummaries();
      }
    } catch (recalculationError) {
      if (!controller.signal.aborted) {
        setError(
          recalculationError instanceof Error
            ? recalculationError.message
            : 'Elevation could not be recalculated.',
        );
      }
    } finally {
      if (recalculationAbort.current === controller) {
        recalculationAbort.current = null;
        setRecalculationState('idle');
        setElevationProgress(null);
      }
    }
  }, [active, database, elevationProvider, recalculationState, reloadSummaries]);

  const discardPreview = useCallback(() => {
    initiallyRestoredTrackId.current = null;
    preparationAbort.current?.abort();
    recalculationAbort.current?.abort();
    setRecalculationState('idle');
    setElevationProgress(null);
    importGeneration.current += 1;
    namingAbort.current?.abort();
    setImportState('idle');
    setActive(null);
    setError(null);
  }, []);

  const closeActive = useCallback(async () => {
    if (routePlanSaveInProgress.current) return false;
    const closingUnsavedTrack =
      active?.kind === 'preview' ||
      (active?.kind === 'route-plan' && active.waypoints.length > 0);
    if (closingUnsavedTrack && !window.confirm('Discard this unsaved track?')) {
      return false;
    }
    if (active?.kind === 'saved') {
      const closingGeneration = importGeneration.current;
      try {
        await saveLatestOpenedTrackId(null);
      } catch {
        if (closingGeneration === importGeneration.current) {
          setError('The track could not be closed.');
        }
        return false;
      }
      if (closingGeneration !== importGeneration.current) return false;
    }
    initiallyRestoredTrackId.current = null;
    preparationAbort.current?.abort();
    recalculationAbort.current?.abort();
    routePlanRequestAbort.current?.abort();
    routePlanElevationAbort.current?.abort();
    setRecalculationState('idle');
    setElevationProgress(null);
    importGeneration.current += 1;
    setImportState('idle');
    namingAbort.current?.abort();
    setActive(null);
    setError(null);
    return true;
  }, [active, saveLatestOpenedTrackId]);
  const toggleMultiTrackMode = useCallback(async () => {
    if (multiTrackMode) {
      setMultiTrackMode(false);
      setMultiTrackSelections([]);
      multiTrackSelectionRequests.current.clear();
      return;
    }
    if (active?.kind === 'shared') return;
    if (
      (active?.kind === 'preview' || active?.kind === 'route-plan') &&
      !(await closeActive())
    ) {
      return;
    }
    if (active?.kind === 'saved') {
      const requestId = ++multiTrackRequestId.current;
      multiTrackSelectionRequests.current.set(active.summary.id, requestId);
      setMultiTrackSelections([
        {
          status: 'ready',
          requestId,
          summary: active.summary,
          content: active.content,
          profile: elevationProfileForSavedTrack(active.content),
        },
      ]);
    } else {
      multiTrackSelectionRequests.current.clear();
      setMultiTrackSelections([]);
    }
    setMultiTrackMode(true);
    setError(null);
  }, [active, closeActive, multiTrackMode]);

  const toggleMultiTrackSelection = useCallback(
    async (summary: LocalTrackSummary) => {
      if (!multiTrackMode) return;
      const existingRequestId = multiTrackSelectionRequests.current.get(summary.id);
      if (existingRequestId !== undefined) {
        multiTrackSelectionRequests.current.delete(summary.id);
        setMultiTrackSelections((current) =>
          current.filter(
            (selection) =>
              selection.summary.id !== summary.id ||
              selection.requestId !== existingRequestId,
          ),
        );
        return;
      }

      const requestId = ++multiTrackRequestId.current;
      multiTrackSelectionRequests.current.set(summary.id, requestId);
      setMultiTrackSelections((current) => [
        ...current,
        { status: 'loading', requestId, summary },
      ]);
      try {
        const content = await database.loadLocalTrackContent(summary.id);
        if (multiTrackSelectionRequests.current.get(summary.id) !== requestId) {
          return;
        }
        setMultiTrackSelections((current) =>
          current.map((selection) =>
            selection.requestId === requestId
              ? {
                  status: 'ready',
                  requestId,
                  summary,
                  content,
                  profile: elevationProfileForSavedTrack(content),
                }
              : selection,
          ),
        );
        setError(null);
      } catch (loadError) {
        if (multiTrackSelectionRequests.current.get(summary.id) !== requestId) {
          return;
        }
        multiTrackSelectionRequests.current.delete(summary.id);
        setMultiTrackSelections((current) =>
          current.filter((selection) => selection.requestId !== requestId),
        );
        setError('The track could not be added to multi-track view.');
        throw loadError;
      }
    },
    [database, multiTrackMode],
  );

  const activeSavedTrackId = active?.kind === 'saved' ? active.summary.id : null;

  const selectSaved = useCallback(
    async (summary: LocalTrackSummary) => {
      if (routePlanSaveInProgress.current) return;
      const replacingUnsavedTrack =
        active?.kind === 'preview' ||
        (active?.kind === 'route-plan' && active.waypoints.length > 0);
      if (
        replacingUnsavedTrack &&
        !window.confirm('Discard the current unsaved track and open the saved track?')
      ) {
        return;
      }
      initiallyRestoredTrackId.current = null;
      renderedTrackId.current = null;
      preparationAbort.current?.abort();
      recalculationAbort.current?.abort();
      routePlanRequestAbort.current?.abort();
      routePlanElevationAbort.current?.abort();
      setRecalculationState('idle');
      setElevationProgress(null);
      const generation = importGeneration.current + 1;
      importGeneration.current = generation;
      setImportState('idle');
      namingAbort.current?.abort();
      try {
        const content = await database.loadLocalTrackContent(summary.id);
        if (generation !== importGeneration.current) return;
        await saveLatestOpenedTrackId(summary.id);
        if (generation !== importGeneration.current) return;
        setActive((current) =>
          generation === importGeneration.current
            ? { kind: 'saved', summary, content, draftName: summary.name }
            : current,
        );
        setError(null);
      } catch (loadError) {
        if (generation !== importGeneration.current) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'The track could not be opened.',
        );
        if (activeSavedTrackId !== null && latestOpenedTrackId.current === null) {
          try {
            await saveLatestOpenedTrackId(activeSavedTrackId);
          } catch {
            // The active saved track remains visible; preserve the open failure.
          }
        }
      }
    },
    [active, activeSavedTrackId, database, saveLatestOpenedTrackId],
  );

  const setActiveName = useCallback((name: string) => {
    if (routePlanSaveInProgress.current) return;
    setActive((current) => {
      if (current === null) return null;
      if (current.kind === 'preview' || current.kind === 'shared') {
        return { ...current, name };
      }
      if (current.kind === 'route-plan') return setRoutePlanName(current, name);
      return { ...current, draftName: name };
    });
  }, []);

  const renameActive = useCallback(async (): Promise<boolean> => {
    if (active?.kind !== 'saved') return false;
    const activeId = active.summary.id;
    const generation = importGeneration.current;
    try {
      const summary = await database.renameLocalTrack(activeId, active.draftName);
      setActive((current) =>
        current?.kind === 'saved' &&
        current.summary.id === activeId &&
        generation === importGeneration.current
          ? { ...current, summary, draftName: summary.name }
          : current,
      );
      await reloadSummaries();
      void userData.trackMetadataChanged(activeId);
      if (generation === importGeneration.current) setError(null);
      return true;
    } catch (renameError) {
      if (generation === importGeneration.current) {
        setError(
          renameError instanceof Error
            ? renameError.message
            : 'The track could not be renamed.',
        );
      }
      return false;
    }
  }, [active, database, reloadSummaries, userData]);

  const updateTrackMarkers = useCallback(
    async (trackId: string, markers: readonly TrackMarker[]) => {
      if (active?.kind === 'preview' && active.id === trackId) {
        setActive((current) =>
          current?.kind === 'preview' && current.id === trackId
            ? { ...current, markers }
            : current,
        );
        return;
      }
      if (active?.kind !== 'saved' || active.summary.id !== trackId) {
        throw new Error('The active track changed before the marker update.');
      }
      const updated = await database.updateLocalTrackMarkers(trackId, markers);
      setActive((current) =>
        current?.kind === 'saved' && current.summary.id === trackId
          ? {
              ...current,
              summary: updated.summary,
              content: updated.content,
            }
          : current,
      );
      await reloadSummaries();
      void userData.trackMetadataChanged(trackId);
    },
    [active, database, reloadSummaries, userData],
  );

  const startTrackMarkerPlacement = useCallback(() => {
    if (multiTrackMode || editableTrackId === null || editableTrackMarkers === null) {
      return;
    }
    if (editableTrackMarkers.length >= MAXIMUM_TRACK_MARKERS) {
      setError(`A track can have up to ${String(MAXIMUM_TRACK_MARKERS)} markers.`);
      return;
    }
    requestMarkerPlacement({ kind: 'track-marker', trackId: editableTrackId });
  }, [editableTrackId, editableTrackMarkers, multiTrackMode]);

  const createTrackMarker = useCallback(
    async (name: NormalizedMarkerName) => {
      const draft = trackMarkerDraft;
      if (
        draft === null ||
        multiTrackMode ||
        draft.trackId !== editableTrackId ||
        editableTrackMarkers === null
      ) {
        throw new Error('The active track changed before the marker was created.');
      }
      if (editableTrackMarkers.length >= MAXIMUM_TRACK_MARKERS) {
        throw new Error(
          `A track can have up to ${String(MAXIMUM_TRACK_MARKERS)} markers.`,
        );
      }
      await updateTrackMarkers(draft.trackId, [
        ...editableTrackMarkers,
        {
          id: idGenerator.generate(),
          name: name.name,
          coordinate: draft.coordinate,
        },
      ]);
      setTrackMarkerDraft((current) =>
        current?.trackId === draft.trackId ? null : current,
      );
    },
    [
      editableTrackId,
      editableTrackMarkers,
      idGenerator,
      multiTrackMode,
      trackMarkerDraft,
      updateTrackMarkers,
    ],
  );

  const renameTrackMarker = useCallback(
    async (markerId: string, name: string) => {
      if (editableTrackId === null || editableTrackMarkers === null) {
        throw new Error('No editable track is active.');
      }
      const marker = editableTrackMarkers.find(
        (candidate) => candidate.id === markerId,
      );
      if (marker === undefined) throw new Error('The track marker was not found.');
      const normalized = normalizeMarkerName(name);
      await updateTrackMarkers(
        editableTrackId,
        editableTrackMarkers.map((candidate) =>
          candidate.id === marker.id
            ? { ...candidate, name: normalized.name }
            : candidate,
        ),
      );
    },
    [editableTrackId, editableTrackMarkers, updateTrackMarkers],
  );

  const deleteTrackMarker = useCallback(
    async (markerId: string) => {
      if (editableTrackId === null || editableTrackMarkers === null) {
        throw new Error('No editable track is active.');
      }
      if (!editableTrackMarkers.some((marker) => marker.id === markerId)) {
        throw new Error('The track marker was not found.');
      }
      await updateTrackMarkers(
        editableTrackId,
        editableTrackMarkers.filter((marker) => marker.id !== markerId),
      );
    },
    [editableTrackId, editableTrackMarkers, updateTrackMarkers],
  );

  const toggleFavorite = useCallback(
    async (summary: LocalTrackSummary) => {
      try {
        const updated = await database.setLocalTrackFavorite(
          summary.id,
          !summary.favorite,
        );
        setActive((current) =>
          current?.kind === 'saved' && current.summary.id === updated.id
            ? { ...current, summary: updated }
            : current,
        );
        setMultiTrackSelections((current) =>
          current.map((selection) =>
            selection.summary.id === updated.id
              ? { ...selection, summary: updated }
              : selection,
          ),
        );
        await reloadSummaries();
        void userData.trackMetadataChanged(updated.id);
        setError(null);
      } catch {
        setError('The favorite could not be updated.');
      }
    },
    [database, reloadSummaries, userData],
  );

  const deleteSaved = useCallback(
    async (summary: LocalTrackSummary) => {
      try {
        if (active?.kind === 'saved' && active.summary.id === summary.id) {
          recalculationAbort.current?.abort();
          setRecalculationState('idle');
          setElevationProgress(null);
        }
        await database.deleteLocalTrack(summary.id);
        if (latestOpenedTrackId.current === summary.id) {
          await saveLatestOpenedTrackId(null);
        }
        setActive((current) =>
          current?.kind === 'saved' && current.summary.id === summary.id
            ? null
            : current,
        );
        const selectedRequestId = multiTrackSelectionRequests.current.get(summary.id);
        if (selectedRequestId !== undefined) {
          multiTrackSelectionRequests.current.delete(summary.id);
          setMultiTrackSelections((current) =>
            current.filter(
              (selection) =>
                selection.summary.id !== summary.id ||
                selection.requestId !== selectedRequestId,
            ),
          );
        }
        await reloadSummaries();
        void userData.trackDeleted(summary.id);
        setError(null);
      } catch {
        setError('The track could not be deleted.');
      }
    },
    [active, database, reloadSummaries, saveLatestOpenedTrackId, userData],
  );

  const applyGeneratedName = useCallback(() => {
    setActive((current) =>
      current?.kind === 'preview' &&
      current.preparationStatus === 'ready' &&
      current.generatedName !== undefined
        ? { ...current, name: current.generatedName }
        : current,
    );
  }, []);

  const filteredSummaries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('en');
    const matchingSummaries =
      normalizedQuery.length === 0
        ? summaries
        : summaries.filter((summary) =>
            summary.normalizedName.includes(normalizedQuery),
          );
    return sortTracks(matchingSummaries, trackSort, mapCenter);
  }, [mapCenter, query, summaries, trackSort]);

  const activeProfile = useMemo(() => elevationProfileForActiveTrack(active), [active]);
  const multiTrackStatsMetrics = useMemo(
    () =>
      multiTrackMode &&
      multiTrackSelections.length > 0 &&
      readyMultiTrackSelections.length === multiTrackSelections.length
        ? aggregateTrackStatsMetrics(readyMultiTrackSelections)
        : null,
    [multiTrackMode, multiTrackSelections.length, readyMultiTrackSelections],
  );
  useEffect(
    () => () => {
      mapLayers?.setImportedTrackHighlight(null);
    },
    [mapLayers],
  );
  useEffect(() => {
    const highlightSegments = multiTrackMode
      ? readyMultiTrackSelections.flatMap((selection) => {
          const profile = selection.profile;
          if (profile === null) return [];
          return profile.gradeSubsegments.map((gradeSubsegment) => ({
            coordinates: profile.points
              .slice(
                gradeSubsegment.startSampleIndex,
                gradeSubsegment.endSampleIndex + 1,
              )
              .map((point) => point.coordinate),
            color: appColors.elevationGrade[gradeSubsegment.band],
          }));
        })
      : active?.kind === 'route-plan' || activeProfile === null
        ? null
        : activeProfile.gradeSubsegments.map((gradeSubsegment) => ({
            coordinates: activeProfile.points
              .slice(
                gradeSubsegment.startSampleIndex,
                gradeSubsegment.endSampleIndex + 1,
              )
              .map((point) => point.coordinate),
            color: appColors.elevationGrade[gradeSubsegment.band],
          }));
    mapLayers?.setImportedTrackHighlight(highlightSegments);
  }, [
    active?.kind,
    activeProfile,
    mapLayers,
    multiTrackMode,
    readyMultiTrackSelections,
  ]);

  const value = useMemo<TracksWorkspaceValue>(
    () => ({
      active,
      activeProfile,
      addRoutePlanPoint,
      clearRoutePlan,
      elevationProgress,
      error,
      filteredSummaries,
      importError: importError?.message ?? null,
      importState,
      importFiles,
      multiTrackMode,
      multiTrackSelections,
      multiTrackStatsMetrics,
      query,
      summaries,
      applyGeneratedName,
      closeActive,
      deleteSaved,
      discardPreview,
      discardRoutePlan,
      startTrackMarkerPlacement,
      renameTrackMarker,
      deleteTrackMarker,
      recalculateElevation,
      recalculationState,
      renameActive,
      savePreview,
      saveRoutePlan,
      selectSaved,
      setNextSegmentMode,
      startRoutePlan,
      setActiveName,
      setQuery,
      undoLastRoutePlanPoint,
      toggleMultiTrackMode,
      toggleMultiTrackSelection,
      toggleFavorite,
    }),
    [
      active,
      addRoutePlanPoint,
      activeProfile,
      applyGeneratedName,
      elevationProgress,
      closeActive,
      clearRoutePlan,
      deleteSaved,
      discardPreview,
      discardRoutePlan,
      startTrackMarkerPlacement,
      renameTrackMarker,
      deleteTrackMarker,
      error,
      filteredSummaries,
      importError,
      importFiles,
      importState,
      multiTrackMode,
      multiTrackSelections,
      multiTrackStatsMetrics,
      query,
      renameActive,
      recalculateElevation,
      recalculationState,
      savePreview,
      saveRoutePlan,
      selectSaved,
      setNextSegmentMode,
      startRoutePlan,
      setActiveName,
      setQuery,
      undoLastRoutePlanPoint,
      summaries,
      toggleFavorite,
      toggleMultiTrackMode,
      toggleMultiTrackSelection,
    ],
  );

  return (
    <>
      <TracksWorkspaceContext value={value}>{children}</TracksWorkspaceContext>
      <MarkerEditorDialog
        open={trackMarkerDraft !== null}
        mode="name-only"
        initialName={trackMarkerDraft?.initialName ?? ''}
        title="Create track marker"
        onCancel={() => {
          setTrackMarkerDraft(null);
        }}
        onSubmit={createTrackMarker}
      />
    </>
  );
}

interface TrackSortControlProps {
  readonly onTrackSortChange: (sort: TrackSort) => Promise<boolean>;
}

const trackSortLabels: Readonly<Record<TrackSort, string>> = {
  created: 'Newest',
  name: 'Name',
  oldest: 'Oldest',
  distance: 'Distance from map center',
};

export function TrackSortControl({ onTrackSortChange }: TrackSortControlProps) {
  const trackSort = useUiStore((state) => state.trackSort);
  const [sortSaveError, setSortSaveError] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);

  const chooseSort = async (sort: TrackSort) => {
    setSortAnchor(null);
    const saved = await onTrackSortChange(sort);
    setSortSaveError(!saved);
  };

  return (
    <>
      <Tooltip title={`Sort: ${trackSortLabels[trackSort]}`}>
        <IconButton
          size="small"
          aria-label={`Sort tracks. Current: ${trackSortLabels[trackSort]}`}
          aria-haspopup="menu"
          onClick={(event) => {
            setSortAnchor(event.currentTarget);
          }}
        >
          <SortIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={sortAnchor}
        open={sortAnchor !== null}
        onClose={() => {
          setSortAnchor(null);
        }}
      >
        {(Object.keys(trackSortLabels) as TrackSort[]).map((sort) => (
          <MenuItem
            key={sort}
            selected={sort === trackSort}
            onClick={() => {
              void chooseSort(sort);
            }}
          >
            {trackSortLabels[sort]}
          </MenuItem>
        ))}
      </Menu>
      <Snackbar
        open={sortSaveError}
        autoHideDuration={4_000}
        message="Sort preference could not be saved"
        onClose={() => {
          setSortSaveError(false);
        }}
      />
    </>
  );
}

function TrackImportZone() {
  const { importError, importFiles } = useTracksWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const compactZoneRef = useRef<HTMLElement>(null);
  const floatingZoneRef = useRef<HTMLElement>(null);
  const workspaceShellRef = useRef<HTMLElement | null>(null);
  const [workspaceShell, setWorkspaceShell] = useState<HTMLElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    const workspaceShell = document.querySelector('[data-testid="workspace-shell"]');
    if (!(workspaceShell instanceof HTMLElement)) return undefined;
    workspaceShellRef.current = workspaceShell;

    const hasFiles = (event: globalThis.DragEvent) =>
      event.dataTransfer?.types.includes('Files') ?? false;
    const handleWorkspaceDragEnter = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      setWorkspaceShell(workspaceShell);
      setDragActive(true);
    };
    const handleWorkspaceDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event) || event.dataTransfer === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect =
        event.target instanceof Node &&
        (compactZoneRef.current?.contains(event.target) === true ||
          floatingZoneRef.current?.contains(event.target) === true)
          ? 'copy'
          : 'none';
    };
    const handleWorkspaceDragLeave = (event: globalThis.DragEvent) => {
      if (
        !hasFiles(event) ||
        (event.relatedTarget instanceof Node &&
          workspaceShell.contains(event.relatedTarget))
      )
        return;
      setDragActive(false);
    };
    const handleWorkspaceDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (
        event.target instanceof Node &&
        (compactZoneRef.current?.contains(event.target) === true ||
          floatingZoneRef.current?.contains(event.target) === true)
      )
        return;
      setDragActive(false);
    };
    const handleWorkspaceDragEnd = () => {
      setDragActive(false);
    };

    workspaceShell.addEventListener('dragenter', handleWorkspaceDragEnter);
    workspaceShell.addEventListener('dragover', handleWorkspaceDragOver);
    workspaceShell.addEventListener('dragleave', handleWorkspaceDragLeave);
    workspaceShell.addEventListener('drop', handleWorkspaceDrop);
    workspaceShell.addEventListener('dragend', handleWorkspaceDragEnd);
    return () => {
      workspaceShell.removeEventListener('dragenter', handleWorkspaceDragEnter);
      workspaceShell.removeEventListener('dragover', handleWorkspaceDragOver);
      workspaceShell.removeEventListener('dragleave', handleWorkspaceDragLeave);
      workspaceShell.removeEventListener('drop', handleWorkspaceDrop);
      workspaceShell.removeEventListener('dragend', handleWorkspaceDragEnd);
      workspaceShellRef.current = null;
    };
  }, []);

  const handleCompactDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    void importFiles(event.dataTransfer.files);
  };

  return (
    <Box sx={{ minHeight: importError === null ? 52 : 106 }}>
      <Paper
        ref={compactZoneRef}
        component="section"
        aria-label="Import track file"
        variant="outlined"
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={handleCompactDrop}
        sx={{
          minHeight: 52,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderStyle: 'dashed',
          borderWidth: 2,
          borderColor: 'divider',
          bgcolor: appColors.surface.subtle,
          borderRadius: 1.5,
        }}
      >
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            minHeight: 48,
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            px: { xs: 0.75, sm: 1.25 },
            py: 0.5,
            textAlign: 'center',
          }}
        >
          <UploadFileOutlinedIcon color="primary" sx={{ fontSize: 24 }} />
          <Typography
            variant="subtitle2"
            noWrap
            sx={{ flex: 1, fontSize: { xs: '0.6875rem', sm: '0.875rem' } }}
          >
            Drop GPX, FIT, or KML here
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => inputRef.current?.click()}
            sx={{ whiteSpace: 'nowrap', px: { xs: 1, sm: 1.25 } }}
          >
            Browse track file
          </Button>
        </Stack>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".gpx,.fit,.kml,application/gpx+xml,application/vnd.ant.fit,application/vnd.google-earth.kml+xml"
          onChange={(event) => {
            if (event.target.files !== null) void importFiles(event.target.files);
            event.target.value = '';
          }}
        />
        {importError === null ? null : (
          <Alert
            severity="warning"
            sx={{
              mx: 0.75,
              mb: 0.75,
              py: 0,
              minHeight: 44,
              alignItems: 'center',
              borderRadius: 1,
              '& .MuiAlert-message': { py: 0.5 },
            }}
          >
            {importError}
          </Alert>
        )}
      </Paper>
      {dragActive && workspaceShell !== null
        ? createPortal(
            <Paper
              ref={floatingZoneRef}
              component="section"
              aria-label="Drop track file"
              variant="outlined"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragActive(false);
                void importFiles(event.dataTransfer.files);
              }}
              sx={{
                position: 'absolute',
                zIndex: 7,
                top: 70,
                left: 70,
                width: { xs: 'calc(100% - 82px)', sm: 420, xl: 464 },
                height: 138,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                borderStyle: 'dashed',
                borderWidth: 2,
                borderColor: 'primary.main',
                bgcolor: appColors.surface.selected,
                boxShadow: '0 12px 28px rgba(2, 48, 71, 0.28)',
                borderRadius: 1.5,
              }}
            >
              <Stack
                spacing={0.75}
                sx={{
                  minHeight: 48,
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                  px: 1.25,
                  py: 2,
                  textAlign: 'center',
                }}
              >
                <UploadFileOutlinedIcon color="primary" sx={{ fontSize: 36 }} />
                <Typography variant="subtitle2">Drop GPX, FIT, or KML here</Typography>
                <Typography variant="caption" color="text.secondary">
                  Release the file inside this zone
                </Typography>
              </Stack>
            </Paper>,
            workspaceShell,
          )
        : null}
    </Box>
  );
}

interface TracksPanelProps {
  readonly onOpenActiveDetails: () => void;
}

export function TracksPanel({ onOpenActiveDetails }: TracksPanelProps) {
  const {
    active,
    error,
    filteredSummaries,
    multiTrackMode,
    multiTrackSelections,
    query,
    setQuery,
    selectSaved,
    summaries,
    toggleFavorite,
    toggleMultiTrackSelection,
    deleteSaved,
  } = useTracksWorkspace();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // A sorted row can move under a stationary pointer without a leave event.
  const [hoveredSavedTrackId, setHoveredSavedTrackId] = useState<string | null>(null);
  const [savedTrackHoverEpoch, setSavedTrackHoverEpoch] = useState(0);
  const [savedTrackHoverSuppressed, setSavedTrackHoverSuppressed] = useState(false);
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack spacing={2} sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2 }}>
        <TrackImportZone />
        <TextField
          fullWidth
          size="small"
          aria-label="Search saved tracks"
          placeholder={`Search ${String(summaries.length)} saved tracks`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        {error === null ? null : <Alert severity="warning">{error}</Alert>}
        {filteredSummaries.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 2, bgcolor: appColors.surface.subtle }}>
            <Typography variant="body2" color="text.secondary">
              {summaries.length === 0
                ? 'Import a GPX, FIT, or KML file to preview it, then save it in this browser.'
                : 'No saved track matches this name.'}
            </Typography>
          </Paper>
        ) : (
          <List
            disablePadding
            aria-label="Saved tracks"
            sx={{ display: 'grid', gap: 1.5 }}
          >
            {filteredSummaries.map((summary) => {
              const elapsedSeconds = summary.metrics.elapsedSeconds;
              const ascentMeters = summary.metrics.ascentMeters;
              const selected = multiTrackMode
                ? multiTrackSelections.some(
                    (selection) => selection.summary.id === summary.id,
                  )
                : active?.kind === 'saved' && active.summary.id === summary.id;
              const pending = pendingDeleteId === summary.id;
              const deleting = deletingId === summary.id;
              const actionClassName = `saved-track-row-action${pending ? ' saved-track-row-action--pending' : ''}`;
              const hovered = hoveredSavedTrackId === summary.id;
              return (
                <ClickAwayListener
                  key={summary.id}
                  onClickAway={() => {
                    if (deletingId !== summary.id) {
                      setPendingDeleteId((current) =>
                        current === summary.id ? null : current,
                      );
                    }
                  }}
                >
                  <Paper
                    component="li"
                    variant="outlined"
                    className={hovered ? 'saved-track-row--hovered' : undefined}
                    onMouseEnter={() => {
                      if (!savedTrackHoverSuppressed) {
                        setHoveredSavedTrackId(summary.id);
                      }
                    }}
                    onMouseMove={() => {
                      setSavedTrackHoverSuppressed(false);
                      setHoveredSavedTrackId(summary.id);
                    }}
                    onMouseLeave={() => {
                      setHoveredSavedTrackId((current) =>
                        current === summary.id ? null : current,
                      );
                      if (deletingId !== summary.id) {
                        setPendingDeleteId((current) =>
                          current === summary.id ? null : current,
                        );
                      }
                    }}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      alignItems: 'center',
                      bgcolor: selected
                        ? hovered
                          ? `color-mix(in srgb, ${appColors.surface.selected}, ${appColors.text.primary} 8%)`
                          : appColors.surface.selected
                        : hovered
                          ? 'action.hover'
                          : 'transparent',
                      '& .MuiListItemButton-root, & .MuiListItemButton-root:hover, & .MuiListItemButton-root.Mui-selected, & .MuiListItemButton-root.Mui-selected:hover':
                        { bgcolor: 'transparent' },
                      '& .saved-track-row-action': {
                        opacity: 0,
                        pointerEvents: 'none',
                        transition: 'opacity 150ms ease-out',
                      },
                      '& .saved-track-row-favorite--active, & .saved-track-row-action--pending, &:focus-within .saved-track-row-action, &.saved-track-row--hovered .saved-track-row-action':
                        { opacity: 1, pointerEvents: 'auto' },
                      '@media (width < 900px)': {
                        '& .saved-track-row-action': {
                          opacity: 1,
                          pointerEvents: 'auto',
                        },
                      },
                    }}
                  >
                    <ListItemButton
                      selected={selected}
                      aria-pressed={multiTrackMode ? selected : undefined}
                      onClick={() => {
                        if (multiTrackMode) {
                          const adding = !selected;
                          void toggleMultiTrackSelection(summary)
                            .then(() => {
                              if (adding) onOpenActiveDetails();
                            })
                            .catch(() => undefined);
                          return;
                        }
                        if (selected) {
                          onOpenActiveDetails();
                          return;
                        }
                        void selectSaved(summary);
                      }}
                      sx={{
                        display: 'block',
                        minWidth: 0,
                        px: 1.5,
                        py: 1.25,
                      }}
                    >
                      <Typography variant="subtitle2">{summary.name}</Typography>
                      <Stack
                        direction="row"
                        spacing={1.5}
                        sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}
                      >
                        {elapsedSeconds === undefined ? null : (
                          <TrackStat
                            icon={<TimerOutlinedIcon sx={{ fontSize: 16 }} />}
                            label="Recorded time"
                            value={formatTrackDuration(elapsedSeconds)}
                          />
                        )}
                        <TrackStat
                          icon={<SwapHorizIcon sx={{ fontSize: 16 }} />}
                          label="Distance"
                          value={formatTrackDistance(summary.metrics.distanceMeters)}
                        />
                        {ascentMeters === undefined ? null : (
                          <TrackStat
                            icon={<NorthEastIcon sx={{ fontSize: 16 }} />}
                            label="Elevation gain"
                            value={formatTrackElevation(ascentMeters)}
                          />
                        )}
                      </Stack>
                    </ListItemButton>
                    <Stack
                      key={`saved-track-actions:${summary.id}:${String(savedTrackHoverEpoch)}`}
                      direction="row"
                      spacing={0.5}
                      sx={{ alignItems: 'center', px: 1 }}
                    >
                      <Tooltip
                        disableHoverListener={savedTrackHoverSuppressed}
                        title={
                          summary.favorite
                            ? 'Remove from favorites'
                            : 'Add to favorites'
                        }
                      >
                        <IconButton
                          className={`saved-track-row-action${summary.favorite ? ' saved-track-row-favorite--active' : ''}`}
                          size="small"
                          aria-label={
                            summary.favorite
                              ? 'Remove from favorites'
                              : 'Add to favorites'
                          }
                          color={summary.favorite ? 'warning' : 'default'}
                          onClick={(event) => {
                            if (event.detail > 0) {
                              setSavedTrackHoverSuppressed(true);
                              setHoveredSavedTrackId(null);
                              setSavedTrackHoverEpoch((current) => current + 1);
                            }
                            void toggleFavorite(summary);
                          }}
                        >
                          {summary.favorite ? (
                            <StarIcon fontSize="small" />
                          ) : (
                            <StarBorderIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                      <Tooltip
                        disableHoverListener={savedTrackHoverSuppressed}
                        title={pending ? 'Confirm deletion' : 'Delete track'}
                      >
                        <IconButton
                          className={actionClassName}
                          size="small"
                          aria-label={
                            pending
                              ? `Confirm deletion of ${summary.name}`
                              : `Delete ${summary.name}`
                          }
                          color={pending ? 'error' : 'default'}
                          disabled={deleting}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape' && deletingId !== summary.id) {
                              setPendingDeleteId(null);
                              event.currentTarget.blur();
                            }
                          }}
                          onClick={() => {
                            if (!pending) {
                              setPendingDeleteId(summary.id);
                              return;
                            }
                            setDeletingId(summary.id);
                            void deleteSaved(summary).finally(() => {
                              setDeletingId(null);
                              setPendingDeleteId(null);
                            });
                          }}
                        >
                          {pending ? (
                            <DeleteForeverOutlinedIcon fontSize="small" />
                          ) : (
                            <DeleteOutlineOutlinedIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Paper>
                </ClickAwayListener>
              );
            })}
          </List>
        )}
      </Stack>
      <Alert
        severity="info"
        icon={<SaveOutlinedIcon fontSize="small" />}
        sx={{
          flexShrink: 0,
          m: 0,
          px: 1,
          py: 0,
          minHeight: 32,
          alignItems: 'center',
          borderRadius: 0,
          borderTop: 1,
          borderColor: 'divider',
          '& .MuiAlert-icon': { mr: 0.75, py: 0.25 },
          '& .MuiAlert-message': { py: 0.25 },
        }}
      >
        <Typography variant="caption">Saved tracks stay in this browser.</Typography>
      </Alert>
    </Box>
  );
}

function downloadFile(
  filename: string,
  type: string,
  content: string | Uint8Array,
): void {
  const blobContent = typeof content === 'string' ? content : Uint8Array.from(content);
  const url = URL.createObjectURL(new Blob([blobContent], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function elevationProfileInputSegments(
  segments: readonly (readonly TrackPoint[])[],
): readonly (readonly ElevationProfileInputPoint[])[] | null {
  const inputs: ElevationProfileInputPoint[][] = [];
  for (const [sourceSegmentIndex, segment] of segments.entries()) {
    let preparedSegment: ElevationProfileInputPoint[] = [];
    for (const point of segment) {
      if (point.elevationMeters === undefined) {
        if (preparedSegment.length > 0) inputs.push(preparedSegment);
        preparedSegment = [];
        continue;
      }
      preparedSegment.push({
        coordinate: point.coordinate,
        rawElevationMeters: point.elevationMeters,
        elevationMeters: point.elevationMeters,
        sourceSegmentIndex,
        ...(point.recordedAt === undefined ? {} : { recordedAt: point.recordedAt }),
      });
    }
    if (preparedSegment.length > 0) inputs.push(preparedSegment);
  }
  return inputs.length === 0 ? null : inputs;
}
function elevationProfileForSavedTrack(
  content: LocalTrackContent,
): ElevationProfile | null {
  const sourceInputs = elevationProfileInputSegments(content.trackPoints);
  const sourceProfile =
    sourceInputs === null
      ? null
      : calculateElevationProfile(medianFilterElevationSamples(sourceInputs));
  if (sourceProfile !== null) return sourceProfile;
  const calculatedInputs =
    content.calculatedTrackPoints === undefined
      ? null
      : elevationProfileInputSegments(content.calculatedTrackPoints);
  return calculatedInputs === null ? null : calculateElevationProfile(calculatedInputs);
}

function elevationProfileForActiveTrack(
  active: ActiveTrack | null,
): ElevationProfile | null {
  if (active === null) return null;
  if (active.kind === 'route-plan') return active.profile;
  if (active.kind === 'preview' || active.kind === 'shared') {
    return active.preparationStatus === 'ready'
      ? (active.sourceProfile ?? active.calculatedProfile)
      : null;
  }
  return elevationProfileForSavedTrack(active.content);
}

interface InteractiveElevationProfileProps {
  readonly profile: ElevationProfile;
  readonly showHeading?: boolean;
}

function InteractiveElevationProfile({
  profile,
  showHeading = true,
}: InteractiveElevationProfileProps): ReactElement {
  const { active, elevationProgress, recalculateElevation, recalculationState } =
    useTracksWorkspace();
  const { database, logger, mapLayers } = useRuntimeServices();
  const trackGradeLegendDismissed = useUiStore(
    (state) => state.elevationGradeLegendDismissed,
  );
  const setTrackGradeLegendDismissed = useUiStore(
    (state) => state.setElevationGradeLegendDismissed,
  );
  const [hoveredSegment, setHoveredSegment] = useState<{
    readonly profile: ElevationProfile;
    readonly index: number;
  } | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<{
    readonly profile: ElevationProfile;
    readonly index: number;
  } | null>(null);
  useEffect(
    () => () => {
      mapLayers?.setImportedTrackTracePoint(null);
    },
    [mapLayers],
  );
  useEffect(() => {
    mapLayers?.setImportedTrackTracePoint(null);
  }, [mapLayers, profile]);
  const hoveredSegmentIndex =
    hoveredSegment?.profile === profile ? hoveredSegment.index : null;
  const selectedSegmentIndex =
    selectedSegment?.profile === profile ? selectedSegment.index : null;
  const activeSegmentIndex = hoveredSegmentIndex ?? selectedSegmentIndex;
  const onSegmentHoverChange = (nextSegmentIndex: number | null) => {
    if (nextSegmentIndex === null) {
      setHoveredSegment(null);
      return;
    }
    setHoveredSegment((current) =>
      current?.profile === profile && current.index === nextSegmentIndex
        ? current
        : { profile, index: nextSegmentIndex },
    );
  };
  const onSegmentSelectionChange = (nextSegmentIndex: number | null) => {
    if (nextSegmentIndex === null) {
      setSelectedSegment(null);
      return;
    }
    setSelectedSegment((current) =>
      current?.profile === profile && current.index === nextSegmentIndex
        ? current
        : { profile, index: nextSegmentIndex },
    );
  };
  return (
    <Stack spacing={1.5}>
      {showHeading && recalculationState === 'recalculating' ? (
        <ElevationPreparationChart
          progress={elevationProgress}
          showProgressStatus={active?.kind !== 'route-plan'}
        />
      ) : (
        <ElevationProfileChart
          profile={profile}
          showHeading={showHeading}
          activeSegmentIndex={activeSegmentIndex}
          selectedSegmentIndex={selectedSegmentIndex}
          onActivePointChange={(point) => {
            mapLayers?.setImportedTrackTracePoint(point?.coordinate ?? null);
          }}
          onSegmentHoverChange={onSegmentHoverChange}
          onSegmentSelectionChange={onSegmentSelectionChange}
          onPointClick={(point) => {
            requestMapNavigation({
              longitude: point.coordinate[0],
              latitude: point.coordinate[1],
              zoom: 13,
            });
          }}
          trackGradeLegendDismissed={trackGradeLegendDismissed}
          onTrackGradeLegendDismissedChange={(dismissed) => {
            setTrackGradeLegendDismissed(dismissed);
            void database.saveElevationGradeLegendDismissed(dismissed).catch(() => {
              logger.log({ level: 'warn', name: 'storage.settings.save-failed' });
            });
          }}
        />
      )}
      {showHeading && active?.kind !== 'route-plan' ? (
        <ClimbsDescentsSection
          recalculating={
            recalculationState === 'recalculating' ||
            (active?.kind === 'preview' && active.preparationStatus === 'preparing')
          }
          onRecalculate={() => void recalculateElevation()}
          segments={profile.segments}
          activeSegmentIndex={activeSegmentIndex}
          selectedSegmentIndex={selectedSegmentIndex}
          onSegmentHoverChange={onSegmentHoverChange}
          onSegmentSelectionChange={onSegmentSelectionChange}
        />
      ) : null}
    </Stack>
  );
}

function TrackElevationAnalysis() {
  const {
    active,
    activeProfile: profile,
    elevationProgress,
    recalculateElevation,
    recalculationState,
  } = useTracksWorkspace();
  if (active === null) return null;
  const preparing =
    (active.kind === 'route-plan' && active.status === 'elevation-enriching') ||
    (active.kind === 'preview' && active.preparationStatus === 'preparing');
  const emptyOrPreparing =
    preparing || profile === null ? (
      <Stack spacing={1.5}>
        {preparing ? (
          <ElevationPreparationChart
            progress={elevationProgress}
            showProgressStatus={active.kind !== 'route-plan'}
          />
        ) : (
          <Stack spacing={1.5}>
            <Typography component="h3" variant="subtitle2">
              Elevation profile
            </Typography>
            <Box
              sx={{
                height: 264,
                mx: -1,
                px: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                bgcolor: 'action.hover',
                borderRadius: 1,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {active.kind === 'route-plan'
                  ? 'Add at least two route points to see the elevation profile.'
                  : 'No elevation profile is available for this track.'}
              </Typography>
            </Box>
          </Stack>
        )}
        {active.kind === 'route-plan' ? null : (
          <ClimbsDescentsSection
            recalculating={
              recalculationState === 'recalculating' ||
              (active.kind === 'preview' && active.preparationStatus === 'preparing')
            }
            onRecalculate={() => void recalculateElevation()}
            segments={[]}
            activeSegmentIndex={null}
            selectedSegmentIndex={null}
            onSegmentHoverChange={() => undefined}
            onSegmentSelectionChange={() => undefined}
          />
        )}
      </Stack>
    ) : null;
  if (emptyOrPreparing !== null) return emptyOrPreparing;
  if (profile === null) return null;
  return <InteractiveElevationProfile profile={profile} />;
}

interface TrackMetadataProps {
  readonly calculatedMetrics: TrackMetrics | null;
  readonly pointCount: number;
  readonly savedAt: string | undefined;
  readonly segmentCount: number;
  readonly sourceFilename: string;
  readonly sourceFormat: TrackSourceFormat;
}

function TrackMetadata({
  calculatedMetrics,
  pointCount,
  savedAt,
  segmentCount,
  sourceFilename,
  sourceFormat,
}: TrackMetadataProps) {
  const pointLabel = `${pointCount.toLocaleString('en')} ${pointCount === 1 ? 'point' : 'points'}`;
  const segmentLabel = `${segmentCount.toLocaleString('en')} ${segmentCount === 1 ? 'segment' : 'segments'}`;
  return (
    <Stack spacing={0.5} sx={{ px: 1 }}>
      <Typography variant="body2">
        {sourceFilename} · {sourceFormat.toLocaleUpperCase('en')}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {pointLabel} · {segmentLabel}
      </Typography>
      {calculatedMetrics?.ascentMeters === undefined ? null : (
        <Typography
          aria-label={`Elevation gain (calculated): ${formatTrackElevation(calculatedMetrics.ascentMeters)}`}
          variant="caption"
          color="text.secondary"
        >
          Elevation gain (calculated):{' '}
          {formatTrackElevation(calculatedMetrics.ascentMeters)}
        </Typography>
      )}
      {calculatedMetrics?.descentMeters === undefined ? null : (
        <Typography
          aria-label={`Elevation loss (calculated): ${formatTrackElevation(calculatedMetrics.descentMeters)}`}
          variant="caption"
          color="text.secondary"
        >
          Elevation loss (calculated):{' '}
          {formatTrackElevation(calculatedMetrics.descentMeters)}
        </Typography>
      )}
      {savedAt === undefined ? null : (
        <Typography variant="caption" color="text.secondary">
          Saved {formatDateTime(new Date(savedAt))}
        </Typography>
      )}
    </Stack>
  );
}
type TrackStatsMetricsBuilder = {
  -readonly [Key in keyof TrackStatsMetrics]: TrackStatsMetrics[Key];
};

function aggregateTrackStatsMetrics(
  selections: readonly ReadyMultiTrackSelection[],
): TrackStatsMetrics {
  const totals: TrackStatsMetricsBuilder = {
    distanceMeters: selections.reduce(
      (sum, selection) => sum + selection.summary.metrics.distanceMeters,
      0,
    ),
  };
  if (
    selections.every(
      (selection) => selection.summary.metrics.elapsedSeconds !== undefined,
    )
  ) {
    totals.elapsedSeconds = selections.reduce(
      (sum, selection) => sum + (selection.summary.metrics.elapsedSeconds ?? 0),
      0,
    );
  }
  if (
    selections.every(
      (selection) => selection.summary.metrics.ascentMeters !== undefined,
    )
  ) {
    totals.ascentMeters = selections.reduce(
      (sum, selection) => sum + (selection.summary.metrics.ascentMeters ?? 0),
      0,
    );
  }
  if (
    selections.every(
      (selection) => selection.summary.metrics.descentMeters !== undefined,
    )
  ) {
    totals.descentMeters = selections.reduce(
      (sum, selection) => sum + (selection.summary.metrics.descentMeters ?? 0),
      0,
    );
  }
  return totals;
}

interface TrackDetailsPaneProps {
  readonly mode: 'mobile' | 'overlay' | 'adjacent';
  readonly onCollapse: () => void;
  readonly onClosed: () => void;
}

type ShareMenuState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'enabled'; readonly token: string }
  | { readonly kind: 'error' };

interface TrackShareMenuState {
  readonly contentHash: string | null;
  readonly state: ShareMenuState;
}

function shareMutationErrorMessage(error: unknown): string {
  if (
    error instanceof TrackShareError &&
    (error.category === 'track-not-found' || error.category === 'track-not-ready')
  ) {
    return 'Sync this track before sharing.';
  }
  return 'Sharing could not be updated. Try again.';
}

interface ShareNotice {
  readonly contentHash: string;
  readonly message: string;
}

export function TrackDetailsPane({
  mode,
  onCollapse,
  onClosed,
}: TrackDetailsPaneProps) {
  const {
    active,
    applyGeneratedName,
    closeActive,
    clearRoutePlan,
    deleteSaved,
    discardPreview,
    discardRoutePlan,
    startTrackMarkerPlacement,
    renameTrackMarker,
    deleteTrackMarker,
    multiTrackMode,
    multiTrackSelections,
    multiTrackStatsMetrics,
    renameActive,
    savePreview,
    saveRoutePlan,
    recalculationState,
    elevationProgress,
    setActiveName,
    setNextSegmentMode,
    toggleFavorite,
    toggleMultiTrackMode,
    undoLastRoutePlanPoint,
  } = useTracksWorkspace();
  const trackMarkers =
    active?.kind === 'saved'
      ? active.content.markers
      : active?.kind === 'preview'
        ? active.markers
        : null;
  const { trackShares, userData } = useRuntimeServices();
  const subscribeUser = useCallback(
    (listener: () => void) => userData.subscribe(listener),
    [userData],
  );
  const getUserSnapshot = useCallback(() => userData.getSnapshot(), [userData]);
  const userSnapshot = useSyncExternalStore(
    subscribeUser,
    getUserSnapshot,
    getUserSnapshot,
  );
  const [shareMenuState, setShareMenuState] = useState<TrackShareMenuState>({
    contentHash: null,
    state: { kind: 'disabled' },
  });
  const [shareNotice, setShareNotice] = useState<ShareNotice | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<HTMLElement | null>(null);
  const readyMultiTrackSelections = multiTrackSelections.filter(
    (selection): selection is ReadyMultiTrackSelection => selection.status === 'ready',
  );
  const canDownloadMultiTrackSelections =
    readyMultiTrackSelections.length === multiTrackSelections.length;
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [confirmingDeleteTrackId, setConfirmingDeleteTrackId] = useState<string | null>(
    null,
  );
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const shareContentHash =
    active?.kind === 'saved' ? (active.summary.contentHash ?? null) : null;
  const currentShareMenuState = useMemo(
    () =>
      shareMenuState.contentHash === shareContentHash
        ? shareMenuState.state
        : { kind: 'disabled' as const },
    [shareContentHash, shareMenuState],
  );
  const shareRequest = useRef<AbortController | null>(null);
  const shareOperationGeneration = useRef(0);
  const beginShareOperation = useCallback(() => {
    shareRequest.current?.abort();
    const controller = new AbortController();
    const generation = shareOperationGeneration.current + 1;
    shareOperationGeneration.current = generation;
    shareRequest.current = controller;
    return { controller, generation };
  }, []);
  const shareOperationIsCurrent = useCallback(
    (controller: AbortController, generation: number): boolean =>
      !controller.signal.aborted && generation === shareOperationGeneration.current,
    [],
  );
  const loadShareStatus = useCallback(async () => {
    const service = trackShares;
    const contentHash = shareContentHash;
    if (
      service === null ||
      contentHash === null ||
      userSnapshot.status !== 'signed-in'
    ) {
      return;
    }
    const { controller, generation } = beginShareOperation();
    setShareMenuState({ contentHash, state: { kind: 'loading' } });
    try {
      const status = await service.status(contentHash, controller.signal);
      if (!shareOperationIsCurrent(controller, generation)) return;
      setShareMenuState({
        contentHash,
        state: status.enabled
          ? { kind: 'enabled', token: status.token }
          : { kind: 'disabled' },
      });
    } catch {
      if (!shareOperationIsCurrent(controller, generation)) return;
      setShareMenuState({ contentHash, state: { kind: 'error' } });
    } finally {
      if (shareOperationIsCurrent(controller, generation)) {
        shareRequest.current = null;
      }
    }
  }, [
    beginShareOperation,
    shareContentHash,
    shareOperationIsCurrent,
    trackShares,
    userSnapshot.status,
  ]);
  const copyShareLink = useCallback(
    async (token: string): Promise<void> => {
      const contentHash = shareContentHash;
      if (contentHash === null) return;
      const generation = shareOperationGeneration.current;
      const url = createTrackShareUrl(window.location.href, token);
      try {
        await navigator.clipboard.writeText(url);
        if (generation !== shareOperationGeneration.current) return;
        setShareNotice({ contentHash, message: 'Share link copied.' });
      } catch {
        if (generation !== shareOperationGeneration.current) return;
        setShareNotice({
          contentHash,
          message: 'Sharing is enabled, but the link could not be copied.',
        });
      }
    },
    [shareContentHash],
  );
  const updateShare = useCallback(async (): Promise<void> => {
    const service = trackShares;
    const contentHash = shareContentHash;
    if (
      service === null ||
      contentHash === null ||
      userSnapshot.status !== 'signed-in' ||
      (currentShareMenuState.kind !== 'disabled' &&
        currentShareMenuState.kind !== 'enabled')
    ) {
      return;
    }
    const previousState = currentShareMenuState;
    const { controller, generation } = beginShareOperation();
    setShareMenuState({ contentHash, state: { kind: 'loading' } });
    try {
      if (previousState.kind === 'disabled') {
        const enabled = await service.enable(contentHash, controller.signal);
        if (!shareOperationIsCurrent(controller, generation)) return;
        setShareMenuState({
          contentHash,
          state: { kind: 'enabled', token: enabled.token },
        });
        await copyShareLink(enabled.token);
        return;
      }
      await service.disable(contentHash, controller.signal);
      if (!shareOperationIsCurrent(controller, generation)) return;
      setShareMenuState({ contentHash, state: { kind: 'disabled' } });
      setShareNotice({ contentHash, message: 'Sharing disabled.' });
    } catch (error) {
      if (!shareOperationIsCurrent(controller, generation)) return;
      setShareMenuState({ contentHash, state: previousState });
      setShareNotice({
        contentHash,
        message: shareMutationErrorMessage(error),
      });
    } finally {
      if (shareOperationIsCurrent(controller, generation)) {
        shareRequest.current = null;
      }
    }
  }, [
    beginShareOperation,
    copyShareLink,
    shareContentHash,
    currentShareMenuState,
    shareOperationIsCurrent,
    trackShares,
    userSnapshot.status,
  ]);
  useEffect(() => {
    shareRequest.current?.abort();
    shareRequest.current = null;
    shareOperationGeneration.current += 1;
    return () => {
      shareRequest.current?.abort();
      shareRequest.current = null;
      shareOperationGeneration.current += 1;
    };
  }, [shareContentHash]);
  if (multiTrackMode && multiTrackSelections.length > 0) {
    return (
      <Box
        component="aside"
        aria-label="Multiple track details"
        sx={{
          width: mode === 'adjacent' ? { xs: 404, xl: 440 } : '100%',
          height: '100%',
          minHeight: 0,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          bgcolor: 'background.paper',
          borderRight: mode === 'adjacent' ? 1 : 0,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction="row"
          sx={{
            minHeight: 64,
            px: 2,
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          {mode === 'mobile' ? (
            <IconButton
              size="small"
              aria-label="Collapse track details"
              onClick={onCollapse}
            >
              <KeyboardArrowDownIcon fontSize="small" />
            </IconButton>
          ) : null}
          {mode === 'overlay' ? (
            <IconButton size="small" aria-label="Back to tracks" onClick={onCollapse}>
              <ArrowBackOutlinedIcon fontSize="small" />
            </IconButton>
          ) : null}
          <Box sx={{ minWidth: 0, flex: 1, ml: mode === 'adjacent' ? 0 : 1 }}>
            <Typography
              component="h2"
              variant="subtitle1"
              noWrap
              sx={{ fontWeight: 700 }}
            >
              Selected tracks
            </Typography>
          </Box>
          <Tooltip title="Download selected tracks">
            <span>
              <IconButton
                size="small"
                aria-label="Download selected tracks"
                disabled={!canDownloadMultiTrackSelections}
                onClick={() => {
                  if (!canDownloadMultiTrackSelections) return;
                  downloadFile(
                    'selected-tracks.zip',
                    'application/zip',
                    exportTracksAsZip(
                      readyMultiTrackSelections.map(({ summary, content }) => ({
                        summary,
                        content,
                      })),
                    ),
                  );
                }}
              >
                <DownloadOutlinedIcon
                  fontSize="small"
                  sx={{ transform: 'translateY(1px)' }}
                />
              </IconButton>
            </span>
          </Tooltip>
          {mode === 'adjacent' ? (
            <IconButton
              size="small"
              aria-label="Close multi-track view"
              onClick={() => {
                void toggleMultiTrackMode().then(onClosed);
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          ) : null}
        </Stack>
        <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2 }}>
          <Stack spacing={2}>
            {multiTrackStatsMetrics === null ? null : (
              <Box role="group" aria-label="Combined track details">
                <TrackStats metrics={multiTrackStatsMetrics} />
              </Box>
            )}
            {multiTrackSelections.map((selection) => (
              <Box
                component="section"
                aria-label={`${selection.summary.name} track details`}
                key={selection.summary.id}
              >
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Divider sx={{ width: 24 }} />
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {selection.summary.name}
                    </Typography>
                    <Divider sx={{ flex: 1 }} />
                  </Stack>
                  {selection.status === 'loading' ? (
                    <Stack
                      role="status"
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center' }}
                    >
                      <CircularProgress size={18} />
                      <Typography variant="body2">Loading track…</Typography>
                    </Stack>
                  ) : (
                    <>
                      <TrackStats metrics={selection.summary.metrics} />
                      {selection.profile === null ? (
                        <Box
                          sx={{
                            height: 264,
                            mx: -1,
                            px: 3,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            No elevation profile is available for this track.
                          </Typography>
                        </Box>
                      ) : (
                        <InteractiveElevationProfile
                          profile={selection.profile}
                          showHeading={false}
                        />
                      )}
                    </>
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>
    );
  }
  if (active === null) return null;
  const canManageShare =
    trackShares !== null &&
    userSnapshot.status === 'signed-in' &&
    shareContentHash !== null;
  const metrics =
    active.kind === 'route-plan'
      ? active.metrics
      : active.kind === 'saved'
        ? active.summary.metrics
        : active.preparationStatus === 'ready'
          ? active.sourceMetrics
          : null;
  const calculatedMetrics =
    active.kind === 'route-plan'
      ? null
      : active.kind === 'saved'
        ? (active.summary.calculatedMetrics ?? null)
        : active.preparationStatus === 'ready'
          ? active.calculatedMetrics
          : null;
  const pointCount =
    active.kind === 'route-plan'
      ? (active.segment?.points.length ?? active.waypoints.length)
      : active.kind === 'saved'
        ? active.summary.pointCount
        : active.preparationStatus === 'ready'
          ? active.sourceSegments.reduce(
              (count, segment) => count + segment.points.length,
              0,
            )
          : active.parsed.pointCount;
  const savedAt = active.kind === 'saved' ? active.summary.savedAt : undefined;
  const segmentCount =
    active.kind === 'route-plan'
      ? active.segment === null
        ? 0
        : 1
      : active.kind === 'saved'
        ? active.summary.segmentCount
        : active.preparationStatus === 'ready'
          ? active.sourceSegments.length
          : active.parsed.segments.length;
  const sourceFilename =
    active.kind === 'route-plan'
      ? safeTrackFilename(active.name, 'gpx')
      : active.kind === 'saved'
        ? active.summary.sourceFilename
        : active.file.name;
  const sourceFormat =
    active.kind === 'route-plan'
      ? ('gpx' as const)
      : active.kind === 'saved'
        ? active.summary.sourceFormat
        : active.sourceFormat;
  const warnings =
    active.kind === 'route-plan'
      ? []
      : active.kind === 'saved'
        ? active.summary.warnings
        : active.parsed.warnings;
  const savedTrackId = active.kind === 'saved' ? active.summary.id : null;
  const renaming = savedTrackId !== null && renamingTrackId === savedTrackId;
  const confirmingDelete =
    savedTrackId !== null && confirmingDeleteTrackId === savedTrackId;
  const deleting = savedTrackId !== null && deletingTrackId === savedTrackId;
  const handleClose = async () => {
    if (await closeActive()) onClosed();
  };
  return (
    <Box
      component="aside"
      aria-label="Track details"
      sx={{
        width: mode === 'adjacent' ? { xs: 404, xl: 440 } : '100%',
        height: '100%',
        minHeight: 0,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        borderRight: mode === 'adjacent' ? 1 : 0,
        borderColor: 'divider',
      }}
    >
      <Stack
        direction="row"
        sx={{
          minHeight: 64,
          px: 2,
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        {mode === 'mobile' ? (
          <IconButton
            size="small"
            aria-label="Collapse track details"
            onClick={onCollapse}
            sx={{ mr: 1 }}
          >
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        ) : null}
        {mode === 'overlay' ? (
          <IconButton
            size="small"
            aria-label="Back to tracks"
            onClick={() => {
              void closeActive();
            }}
            sx={{ mr: 1 }}
          >
            <ArrowBackOutlinedIcon fontSize="small" />
          </IconButton>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {active.kind === 'saved' && renaming ? (
            <TextField
              autoFocus
              fullWidth
              inputRef={renameInputRef}
              size="small"
              label="Track name"
              value={active.draftName}
              onChange={(event) => {
                setActiveName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setActiveName(active.summary.name);
                  setRenamingTrackId(null);
                  return;
                }
                if (
                  event.key === 'Enter' &&
                  active.draftName.trim().length > 0 &&
                  active.draftName.trim() !== active.summary.name
                ) {
                  void renameActive().then((renamed) => {
                    if (renamed) setRenamingTrackId(null);
                  });
                }
              }}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          ) : (
            <Typography
              component="h2"
              variant="subtitle1"
              noWrap
              sx={{ fontWeight: 700 }}
            >
              {active.kind === 'saved'
                ? active.summary.name
                : active.kind === 'shared'
                  ? active.name
                  : 'New track'}
            </Typography>
          )}
        </Box>
        {active.kind === 'saved' && renaming ? (
          <Tooltip title="Confirm rename">
            <span>
              <IconButton
                size="small"
                aria-label="Confirm rename"
                disabled={
                  active.draftName.trim().length === 0 ||
                  active.draftName.trim() === active.summary.name
                }
                onClick={() => {
                  void renameActive().then((renamed) => {
                    if (renamed) setRenamingTrackId(null);
                  });
                }}
              >
                <CheckIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
        {active.kind === 'saved' ? (
          <ClickAwayListener
            onClickAway={() => {
              if (confirmingDelete && !deleting) setConfirmingDeleteTrackId(null);
            }}
          >
            <Box
              onMouseLeave={() => {
                if (confirmingDelete && !deleting) setConfirmingDeleteTrackId(null);
              }}
              sx={{ display: 'flex', alignItems: 'center' }}
            >
              {confirmingDelete ? (
                <Button
                  autoFocus
                  color="error"
                  disabled={deleting}
                  size="small"
                  startIcon={<DeleteForeverOutlinedIcon />}
                  variant="text"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && !deleting) {
                      setConfirmingDeleteTrackId(null);
                    }
                  }}
                  onClick={() => {
                    setDeletingTrackId(active.summary.id);
                    void deleteSaved(active.summary).finally(() => {
                      setDeletingTrackId(null);
                      setConfirmingDeleteTrackId(null);
                    });
                  }}
                >
                  Confirm delete
                </Button>
              ) : (
                <>
                  <Tooltip title="Download GPX">
                    <IconButton
                      size="small"
                      aria-label="Download GPX"
                      onClick={() => {
                        downloadFile(
                          safeTrackFilename(active.summary.name, 'gpx'),
                          'application/gpx+xml',
                          exportTrackAsGpx(active.summary, active.content),
                        );
                      }}
                    >
                      <DownloadOutlinedIcon
                        fontSize="small"
                        sx={{ transform: 'translateY(1px)' }}
                      />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Track actions">
                    <IconButton
                      size="small"
                      aria-label="Track actions"
                      onClick={(event) => {
                        setActionMenuAnchor(event.currentTarget);
                        void loadShareStatus();
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
              <Menu
                anchorEl={actionMenuAnchor}
                open={actionMenuAnchor !== null}
                onClose={() => {
                  setActionMenuAnchor(null);
                }}
              >
                <MenuItem
                  onClick={() => {
                    void toggleFavorite(active.summary);
                    setActionMenuAnchor(null);
                  }}
                >
                  {active.summary.favorite ? (
                    <StarIcon fontSize="small" sx={{ mr: 1.25 }} />
                  ) : (
                    <StarBorderIcon fontSize="small" sx={{ mr: 1.25 }} />
                  )}
                  {active.summary.favorite
                    ? 'Remove from favorites'
                    : 'Add to favorites'}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    downloadFile(
                      safeTrackFilename(active.summary.name, 'kml'),
                      'application/vnd.google-earth.kml+xml',
                      exportTrackAsKml(active.summary, active.content),
                    );
                    setActionMenuAnchor(null);
                  }}
                >
                  <DownloadOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                  Download KML
                </MenuItem>
                {canManageShare ? (
                  <>
                    <MenuItem
                      role="menuitemcheckbox"
                      aria-checked={currentShareMenuState.kind === 'enabled'}
                      disabled={
                        currentShareMenuState.kind !== 'disabled' &&
                        currentShareMenuState.kind !== 'enabled'
                      }
                      onClick={() => {
                        void updateShare();
                      }}
                      sx={{ gap: 2, justifyContent: 'space-between' }}
                    >
                      <Stack direction="row" sx={{ alignItems: 'center' }}>
                        <ShareOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                        Share
                      </Stack>
                      <Box
                        sx={{
                          width: 40,
                          height: 24,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {currentShareMenuState.kind === 'loading' ? (
                          <CircularProgress
                            aria-label="Loading sharing status"
                            size={20}
                          />
                        ) : (
                          <Switch
                            checked={currentShareMenuState.kind === 'enabled'}
                            slotProps={{
                              input: {
                                'aria-label': 'Share track publicly',
                                readOnly: true,
                                tabIndex: -1,
                              },
                            }}
                            size="small"
                            sx={{ pointerEvents: 'none' }}
                          />
                        )}
                      </Box>
                    </MenuItem>
                    {currentShareMenuState.kind === 'enabled' ? (
                      <MenuItem
                        onClick={() => {
                          setActionMenuAnchor(null);
                          void copyShareLink(currentShareMenuState.token);
                        }}
                      >
                        <ContentCopyOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                        Copy share link
                      </MenuItem>
                    ) : null}
                    {currentShareMenuState.kind === 'error' ? (
                      <MenuItem
                        onClick={() => {
                          void loadShareStatus();
                        }}
                      >
                        <RefreshOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                        Retry sharing status
                      </MenuItem>
                    ) : null}
                  </>
                ) : null}
                <MenuItem
                  onClick={() => {
                    setActionMenuAnchor(null);
                    setActiveName(active.summary.name);
                    setRenamingTrackId(active.summary.id);
                  }}
                >
                  <EditOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                  Rename
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setActionMenuAnchor(null);
                    setConfirmingDeleteTrackId(active.summary.id);
                  }}
                  sx={{ color: 'error.main' }}
                >
                  <DeleteOutlineOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                  Delete track
                </MenuItem>
              </Menu>
            </Box>
          </ClickAwayListener>
        ) : null}
        <Snackbar
          autoHideDuration={6_000}
          message={shareNotice?.message}
          open={shareNotice !== null && shareNotice.contentHash === shareContentHash}
          onClose={() => {
            setShareNotice(null);
          }}
        />
        {mode !== 'overlay' ? (
          <IconButton
            size="small"
            aria-label="Close track"
            onClick={() => {
              void handleClose();
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        ) : null}
      </Stack>
      <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2 }}>
        <Stack spacing={2}>
          {active.kind === 'route-plan' ? (
            <RoutePlanControls
              draft={active}
              elevationProgress={elevationProgress}
              onClear={clearRoutePlan}
              onDiscard={discardRoutePlan}
              onNameChange={setActiveName}
              onNextSegmentModeChange={setNextSegmentMode}
              onSave={() => void saveRoutePlan()}
              onUndo={undoLastRoutePlanPoint}
            />
          ) : null}
          {active.kind === 'preview' ? (
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Track name"
                value={active.name}
                onChange={(event) => {
                  setActiveName(event.target.value);
                }}
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
              {active.preparationStatus === 'preparing' ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2">
                    Preparing terrain and elevation…
                  </Typography>
                </Stack>
              ) : active.preparationStatus === 'failed' ? (
                <Alert severity="warning">{active.preparationError}</Alert>
              ) : active.namingStatus === 'loading' ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2">
                    Looking up representative places…
                  </Typography>
                </Stack>
              ) : active.generatedName === undefined ? (
                <Typography variant="body2" color="text.secondary">
                  No generated name is available. Saving is unaffected.
                </Typography>
              ) : (
                <Stack spacing={2}>
                  <Button
                    size="small"
                    variant="text"
                    aria-label="Apply place name"
                    onClick={applyGeneratedName}
                    sx={{ alignSelf: 'center' }}
                  >
                    ↑ Apply place name ↑
                  </Button>
                  <TextField
                    size="small"
                    label="English place name"
                    value={active.generatedName}
                    slotProps={{ input: { readOnly: true } }}
                  />
                </Stack>
              )}
            </Stack>
          ) : null}
          {active.kind === 'preview' || active.kind === 'shared' ? (
            <>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                }}
              >
                {active.kind === 'shared' ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}
                  >
                    Shared track
                  </Typography>
                ) : null}
                <Button size="small" color="inherit" onClick={discardPreview}>
                  Discard
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={
                    active.preparationStatus !== 'ready' ||
                    recalculationState === 'recalculating'
                  }
                  onClick={() => void savePreview()}
                >
                  {active.id.startsWith('shared:') ? 'Save a copy' : 'Save'}
                </Button>
              </Stack>
            </>
          ) : null}
          <Typography component="h3" variant="subtitle2">
            Track details
          </Typography>
          <Box sx={{ minHeight: 56, display: 'flex', alignItems: 'center' }}>
            {metrics === null ? (
              <Typography variant="body2" color="text.secondary">
                {active.kind === 'route-plan'
                  ? 'Add at least two route points to see track details.'
                  : 'Track details are being prepared…'}
              </Typography>
            ) : (
              <Box sx={{ width: '100%' }}>
                <TrackStats metrics={metrics} />
              </Box>
            )}
          </Box>
          <TrackElevationAnalysis
            key={`elevation:${active.kind === 'saved' ? active.summary.id : active.id}`}
          />
          {trackMarkers === null ? null : (
            <TrackMarkersSection
              key={`markers:${active.kind === 'saved' ? active.summary.id : active.id}`}
              markers={trackMarkers}
              onAdd={startTrackMarkerPlacement}
              onRename={renameTrackMarker}
              onDelete={deleteTrackMarker}
            />
          )}
          {active.kind === 'route-plan' ? null : (
            <TrackMetadata
              calculatedMetrics={calculatedMetrics}
              pointCount={pointCount}
              savedAt={savedAt}
              segmentCount={segmentCount}
              sourceFilename={sourceFilename}
              sourceFormat={sourceFormat}
            />
          )}
          {segmentCount > 1 ? (
            <Alert severity="info">
              Independent segments are not joined; totals exclude gaps.
            </Alert>
          ) : null}
          {warnings.length > 0 ? (
            <Alert severity="warning">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Imported with {warnings.length} validation{' '}
                {warnings.length === 1 ? 'warning' : 'warnings'}
              </Typography>
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.25 }}>
                {warnings.map((warning, index) => {
                  const context: string[] = [];
                  if (warning.segmentIndex !== undefined) {
                    context.push(`segment ${String(warning.segmentIndex + 1)}`);
                  }
                  if (warning.pointIndex !== undefined) {
                    context.push(`point ${String(warning.pointIndex + 1)}`);
                  }
                  const contextLabel =
                    context.length === 0 ? '' : ` (${context.join(', ')})`;
                  return (
                    <Typography
                      component="li"
                      key={`${warning.code}-${String(index)}`}
                      variant="caption"
                      sx={{ mb: 0.25 }}
                    >
                      <Box component="code" sx={{ fontSize: 'inherit' }}>
                        {warning.code}
                      </Box>{' '}
                      — {warning.message}
                      {contextLabel}
                    </Typography>
                  );
                })}
              </Box>
            </Alert>
          ) : null}
        </Stack>
      </Box>
    </Box>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { useOptionalTracksWorkspace, useTracksWorkspace };
