import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
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
  type SxProps,
  type Theme,
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

import {
  prepareImportedTrack,
  TrackElevationPreparationError,
  type PreparedImportedTrack,
  type TrackElevationPreparationErrorCode,
  type TrackElevationPreparationProgress,
} from '@/application/tracks/prepareImportedTrack';
import {
  suggestTrackName,
  type TrackNameLookupFailure,
} from '@/application/tracks/suggestTrackName';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  normalizeMarkerName,
  type NormalizedMarkerName,
} from '@/domain/markers/savedMarker';
import { geodesicDistanceKm } from '@/application/map/expandPlaceSearchBounds';
import {
  GPX_PARSER_VERSION,
  GpxParseError,
  type GpxParseFailureCode,
  type GpxValidationWarning,
  type GpxWarningCode,
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
  TrackNameError,
  type LocalTrackContent,
  type LocalTrackSummary,
  type TrackMarker,
  type TrackSort,
} from '@/domain/tracks/localTrack';
import {
  IMPORTS_FOLDER_ID,
  normalizeTrackFolderName,
  type TrackFolder,
  type TrackFolderIconKey,
} from '@/domain/tracks/trackFolder';
import {
  calculateTrackMetrics,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';
import type {
  PoiCandidate,
  TrackNameLandmarkAnchor,
} from '@/domain/tracks/trackNaming';
import type { TrackThumbnail } from '@/domain/tracks/trackThumbnail';
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
  type ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import { SelectableIconGlyph } from '@/presentation/markers/MarkerIconPicker';
import { TrackFolderEditorDialog } from '@/presentation/tracks/TrackFolderEditorDialog';
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
import { TrackWeatherSection } from '@/presentation/tracks/TrackWeatherSection';
import {
  defaultTrackWeatherPreferences,
  type TrackWeatherPreferences,
} from '@/application/weather/TrackWeatherForecast';
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
import { TrackThumbnailImage } from '@/presentation/tracks/TrackThumbnailImage';
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
  readonly preparationError: MessageDescriptor;
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
  readonly middleAnchorKind?: TrackNameLandmarkAnchor;
  readonly startPoi?: PoiCandidate;
  readonly middlePoi?: PoiCandidate;
  readonly endPoi?: PoiCandidate;
  readonly lookupFailures?: readonly TrackNameLookupFailure[];
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
  readonly activeStatsMetrics: TrackStatsMetrics | null;
  readonly elevationProgress: TrackElevationPreparationProgress | null;
  readonly error: string | null;
  readonly filteredSummaries: readonly LocalTrackSummary[];
  readonly folders: readonly TrackFolder[];
  /** Stored list thumbnails by track ID; tracks without one render an empty slot. */
  readonly thumbnails: ReadonlyMap<string, TrackThumbnail>;
  /** Folders shown collapsed; remembered in this browser only. */
  readonly collapsedFolderIds: ReadonlySet<string>;
  readonly toggleFolderCollapsed: (folderId: string) => void;
  /** Forecast disclosure and weekday shared by every track; null until loaded. */
  readonly trackWeatherPreferences: TrackWeatherPreferences | null;
  readonly updateTrackWeatherPreferences: (
    preferences: TrackWeatherPreferences,
  ) => void;
  readonly createFolder: (name: string, iconKey: TrackFolderIconKey) => Promise<void>;
  readonly updateFolder: (
    folder: TrackFolder,
    name: string,
    iconKey: TrackFolderIconKey,
  ) => Promise<void>;
  readonly deleteFolder: (folder: TrackFolder) => Promise<void>;
  readonly moveTrackToFolder: (
    trackId: string,
    folderId: string | null,
  ) => Promise<boolean>;
  readonly reorderFolders: (folderIds: readonly string[]) => Promise<boolean>;
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

const TracksWorkspaceContext = createContext<TracksWorkspaceValue | null>(null);

function sortTracks(
  summaries: readonly LocalTrackSummary[],
  sort: TrackSort,
  mapCenter: MapCoordinate | null,
): readonly LocalTrackSummary[] {
  const distanceByTrack = new Map<LocalTrackSummary, number>();
  if (sort === 'distance' && mapCenter !== null) {
    for (const summary of summaries) {
      distanceByTrack.set(
        summary,
        geodesicDistanceKm(
          mapCenter.latitude,
          mapCenter.longitude,
          summary.metrics.center[1],
          summary.metrics.center[0],
        ),
      );
    }
  }
  return [...summaries].sort((left, right) => {
    const byFavorite = Number(right.favorite) - Number(left.favorite);
    if (byFavorite !== 0) return byFavorite;

    /* eslint-disable lingui/no-unlocalized-strings -- BCP 47 locale tokens keep ordering deterministic. */
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

    const byDistance =
      (distanceByTrack.get(left) ?? 0) - (distanceByTrack.get(right) ?? 0);
    if (byDistance !== 0) return byDistance;
    return byName === 0 ? left.id.localeCompare(right.id, 'en') : byName;
    /* eslint-enable lingui/no-unlocalized-strings */
  });
}

interface ImportErrorNotice {
  readonly message: MessageDescriptor;
  readonly occurrence: number;
}

type LocalTrackSummaryBuilder = {
  -readonly [Key in keyof LocalTrackSummary]: LocalTrackSummary[Key];
};
type LocalTrackContentBuilder = {
  -readonly [Key in keyof LocalTrackContent]: LocalTrackContent[Key];
};

function useTracksWorkspace(): TracksWorkspaceValue {
  const value = use(TracksWorkspaceContext);
  if (value === null) throw new Error('Tracks workspace is unavailable.');
  return value;
}

function useOptionalTracksWorkspace(): TracksWorkspaceValue | null {
  return use(TracksWorkspaceContext);
}

function initialTrackName(file: File, parsed: ParsedGpx, fallbackName: string): string {
  const embeddedName = parsed.metadata.selectedName ?? parsed.metadata.name;
  if (embeddedName !== undefined && embeddedName.trim().length > 0) {
    return embeddedName.trim();
  }
  const filenameStem = file.name.replace(/\.(gpx|fit|kml)$/iu, '').trim();
  return filenameStem.length > 0 ? filenameStem : fallbackName;
}

const lookupFailureMessages: Readonly<
  Record<
    TrackNameLookupFailure['lookup'],
    Readonly<Record<TrackNameLookupFailure['reason'], MessageDescriptor>>
  >
> = {
  landmark: {
    'rate-limited': msg`Nearby landmark lookup was rate-limited by the provider (HTTP 429); wait a minute and import the track again.`,
    timeout: msg`Nearby landmark lookup timed out.`,
    provider: msg`Nearby landmark lookup failed because the provider is overloaded.`,
    network: msg`Nearby landmark lookup could not reach the provider.`,
    'invalid-response': msg`Nearby landmark lookup received an unsupported provider response.`,
    unknown: msg`Nearby landmark lookup failed.`,
  },
  settlement: {
    'rate-limited': msg`Settlement lookup was rate-limited by the provider (HTTP 429); wait a minute and import the track again.`,
    timeout: msg`Settlement lookup timed out.`,
    provider: msg`Settlement lookup failed because the provider is overloaded.`,
    network: msg`Settlement lookup could not reach the provider.`,
    'invalid-response': msg`Settlement lookup received an unsupported provider response.`,
    unknown: msg`Settlement lookup failed.`,
  },
};

/** Explains why a generated name is missing or may be incomplete. */
function lookupFailureText(
  i18n: I18n,
  failures: readonly TrackNameLookupFailure[],
): string {
  return failures
    .map(({ lookup, reason }) => i18n._(lookupFailureMessages[lookup][reason]))
    .join(' ');
}

/** Returns DEM-calculated elevation, rejecting preparations that produced none. */
function requireCalculatedElevation(prepared: PreparedImportedTrack) {
  if (prepared.calculatedSegments === null || prepared.calculatedMetrics === null) {
    throw new TrackElevationPreparationError('elevation-unavailable');
  }
  return { segments: prepared.calculatedSegments, metrics: prepared.calculatedMetrics };
}

const elevationPreparationFailureMessages: Readonly<
  Record<TrackElevationPreparationErrorCode, MessageDescriptor>
> = {
  'elevation-unavailable': msg`Elevation data is unavailable for this track.`,
  'point-limit-exceeded': msg`This track is too long to prepare at 10 metre resolution.`,
  'zero-length-track': msg`This track is broken: all track points are in one location, so its route length is zero. Choose another file.`,
};

const trackImportFailureMessages: Readonly<
  Record<GpxParseFailureCode, MessageDescriptor>
> = {
  aborted: msg`The import was cancelled.`,
  'file-too-large': msg`The file is larger than the import limit.`,
  'unsafe-xml': msg`Files with DTD or entity declarations are not supported.`,
  'invalid-xml': msg`The file could not be read as a GPX, FIT, or KML track.`,
  'unsupported-version': msg`Only GPX 1.0 and 1.1 are supported.`,
  'limit-exceeded': msg`The file contains too much track data.`,
  'empty-geometry': msg`The file has no usable track or route geometry.`,
};

const maximumMarkers = MAXIMUM_TRACK_MARKERS;
const trackMarkerLimitMessage = msg`${plural(maximumMarkers, {
  one: 'A track can have up to # marker.',
  other: 'A track can have up to # markers.',
})}`;

/** Explains a rejected track name; other failures keep the caller's generic message. */
function trackNameFailureMessage(
  error: unknown,
  fallback: MessageDescriptor,
): MessageDescriptor {
  if (!(error instanceof TrackNameError)) return fallback;
  return error.problem === 'required'
    ? msg`Track name is required.`
    : msg`Track name must be 200 characters or fewer.`;
}

export function TracksWorkspaceProvider({ children }: PropsWithChildren) {
  const { t, i18n } = useLingui();
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
  // Smartphone map reveal: provider actions whose result is on the map close the
  // full-screen workspace themselves. The flag is ignored on wider viewports.
  const setMobileWorkspaceOpen = useUiStore((state) => state.setMobileWorkspaceOpen);
  const markerPlacement = useStore(
    mapInteractionStore,
    (state) => state.markerPlacement,
  );
  const markerCreationCommand = useStore(
    mapInteractionStore,
    (state) => state.markerCreationCommand,
  );
  // Only the distance sort reads the camera; other sorts must not re-render on moves.
  const subscribeViewport = useCallback(
    (listener: () => void) => mapViewport.subscribe(listener),
    [mapViewport],
  );
  const getSortCenterSnapshot = useCallback(
    () =>
      trackSort === 'distance'
        ? (mapViewport.getViewportSnapshot()?.center ?? null)
        : null,
    [mapViewport, trackSort],
  );
  const mapCenter = useSyncExternalStore(
    subscribeViewport,
    getSortCenterSnapshot,
    getSortCenterSnapshot,
  );
  const [summaries, setSummaries] = useState<readonly LocalTrackSummary[]>([]);
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, TrackThumbnail>>(
    () => new Map(),
  );
  const [folders, setFolders] = useState<readonly TrackFolder[]>([]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [trackWeatherPreferences, setTrackWeatherPreferences] =
    useState<TrackWeatherPreferences | null>(null);
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
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const [importError, setImportError] = useState<ImportErrorNotice | null>(null);
  /* eslint-disable lingui/no-unlocalized-strings -- State tokens. */
  const [importState, setImportState] = useState<'idle' | 'preparing'>('idle');
  const [recalculationState, setRecalculationState] = useState<
    'idle' | 'recalculating'
  >('idle');
  /* eslint-enable lingui/no-unlocalized-strings */
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
    let current = true;
    void database
      .loadTrackWeatherPreferences()
      .catch((): TrackWeatherPreferences => {
        // View state only: an unreadable record falls back to the defaults.
        logger.log({ level: 'warn', name: 'storage.settings.load-failed' });
        return defaultTrackWeatherPreferences;
      })
      .then((loaded) => {
        // A choice made before the stored record arrived wins over it.
        if (current) setTrackWeatherPreferences((existing) => existing ?? loaded);
      });
    return () => {
      current = false;
    };
  }, [database, logger]);
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
  // One shared read of the remembered collapsed folders. Every reload waits for it
  // so folders never render expanded first; it applies once, and never after the
  // user has already toggled a folder.
  const collapsedFolderLoad = useRef<Promise<readonly string[]> | null>(null);
  const collapsedFoldersSettled = useRef(false);
  // Thumbnails compute sequentially off the list's critical path; a newer summary list
  // supersedes the one being processed, and unmount stops the loop.
  const thumbnailRefresh = useRef<{
    running: boolean;
    disposed: boolean;
    pending: readonly LocalTrackSummary[] | null;
  }>({ running: false, disposed: false, pending: null });
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
  const refreshTrackThumbnails = useCallback(
    async (loaded: readonly LocalTrackSummary[]) => {
      const queue = thumbnailRefresh.current;
      // Unmount and newer reloads mutate the queue across awaits; the getters re-read
      // it where TypeScript would otherwise keep an earlier narrowing.
      const disposed = (): boolean => queue.disposed;
      const superseded = (): boolean => queue.pending !== null;
      queue.pending = loaded;
      if (queue.running) return;
      queue.running = true;
      try {
        while (queue.pending !== null && !disposed()) {
          const current = queue.pending;
          queue.pending = null;
          let stored: Map<string, TrackThumbnail>;
          try {
            stored = new Map(
              (await database.listLocalTrackThumbnails()).map((thumbnail) => [
                thumbnail.trackId,
                thumbnail,
              ]),
            );
          } catch {
            logger.log({
              level: 'warn',
              name: 'storage.local-track-thumbnails.load-failed',
            });
            continue;
          }
          if (disposed()) return;
          setThumbnails(stored);
          for (const summary of current) {
            if (disposed() || superseded()) break;
            if (stored.get(summary.id)?.contentHash === (summary.contentHash ?? null)) {
              continue;
            }
            try {
              const thumbnail = await database.refreshLocalTrackThumbnail(summary.id);
              if (disposed()) return;
              setThumbnails((existing) => {
                const next = new Map(existing);
                if (thumbnail === null) next.delete(summary.id);
                else next.set(summary.id, thumbnail);
                return next;
              });
            } catch {
              logger.log({
                level: 'warn',
                name: 'storage.local-track-thumbnails.refresh-failed',
              });
            }
          }
        }
      } finally {
        queue.running = false;
      }
    },
    [database, logger],
  );
  const reloadSummaries = useCallback(async () => {
    // The collapsed-folder record loads once; later reloads reuse the settled promise.
    const collapsedLoad =
      collapsedFolderLoad.current ??
      database.loadCollapsedTrackFolderIds().catch((): readonly string[] => {
        // View state only: an unreadable record falls back to expanded folders.
        logger.log({ level: 'warn', name: 'storage.settings.load-failed' });
        return [];
      });
    collapsedFolderLoad.current = collapsedLoad;
    try {
      const [loaded, loadedFolders, collapsed] = await Promise.all([
        database.listLocalTracks(),
        database.listTrackFolders(),
        collapsedLoad,
      ]);
      setSummaries(loaded);
      setFolders(loadedFolders);
      if (!collapsedFoldersSettled.current) {
        collapsedFoldersSettled.current = true;
        setCollapsedFolderIds(new Set(collapsed));
      }
      if (!restorationAttempted.current) {
        restorationAttempted.current = true;
        if (sharedIntent.current.kind === 'none') {
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
      }
      // Started after restoration: thumbnail writes share IndexedDB stores with the
      // restoring reads and would otherwise delay reopening the last track.
      void refreshTrackThumbnails(loaded);
    } catch {
      setError(msg`Saved tracks and folders could not be loaded from this browser.`);
    }
  }, [database, logger, refreshTrackThumbnails]);

  const toggleFolderCollapsed = useCallback(
    (folderId: string) => {
      const next = new Set(collapsedFolderIds);
      if (!next.delete(folderId)) next.add(folderId);
      collapsedFoldersSettled.current = true;
      setCollapsedFolderIds(next);
      // Saving only current folders also forgets folders deleted since.
      const known = new Set(folders.map((folder) => folder.id));
      void database
        .saveCollapsedTrackFolderIds([...next].filter((id) => known.has(id)))
        .catch(() => {
          logger.log({ level: 'warn', name: 'storage.settings.save-failed' });
        });
    },
    [collapsedFolderIds, database, folders, logger],
  );
  const updateTrackWeatherPreferences = useCallback(
    (preferences: TrackWeatherPreferences) => {
      setTrackWeatherPreferences(preferences);
      void database.saveTrackWeatherPreferences(preferences).catch(() => {
        logger.log({ level: 'warn', name: 'storage.settings.save-failed' });
      });
    },
    [database, logger],
  );

  // The folder editor dialog reports these failures, so they are rethrown
  // without also setting the panel-level error.
  const createFolder = useCallback(
    async (name: string, iconKey: TrackFolderIconKey) => {
      const normalized = normalizeTrackFolderName(name);
      const timestamp = clock.now().toISOString();
      const created = await database.createTrackFolder({
        schemaVersion: 1,
        id: `folder:${idGenerator.generate()}`,
        name: normalized.name,
        normalizedName: normalized.normalizedName,
        iconKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      setFolders((current) => [...current, created]);
      void userData.foldersChanged();
    },
    [clock, database, idGenerator, userData],
  );

  const updateFolder = useCallback(
    async (folder: TrackFolder, name: string, iconKey: TrackFolderIconKey) => {
      const normalized = normalizeTrackFolderName(name);
      const updated = await database.updateTrackFolder(folder.id, {
        name: normalized.name,
        normalizedName: normalized.normalizedName,
        iconKey,
        updatedAt: clock.now().toISOString(),
      });
      setFolders((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      void userData.foldersChanged();
    },
    [clock, database, userData],
  );

  const deleteFolder = useCallback(
    async (folder: TrackFolder) => {
      const moved = await database.deleteTrackFolder(folder.id);
      setFolders((current) =>
        current.filter((candidate) => candidate.id !== folder.id),
      );
      const movedById = new Map(moved.map((summary) => [summary.id, summary]));
      const applyMoved = (summary: LocalTrackSummary): LocalTrackSummary =>
        movedById.get(summary.id) ?? summary;
      setSummaries((current) => current.map(applyMoved));
      setActive((current) =>
        current?.kind === 'saved'
          ? { ...current, summary: applyMoved(current.summary) }
          : current,
      );
      setMultiTrackSelections((current) =>
        current.map((selection) => ({
          ...selection,
          summary: applyMoved(selection.summary),
        })),
      );
      void userData.foldersChanged();
    },
    [database, userData],
  );

  const moveTrackToFolder = useCallback(
    async (trackId: string, folderId: string | null): Promise<boolean> => {
      const applyFolder = (summary: LocalTrackSummary): LocalTrackSummary =>
        summary.id === trackId ? { ...summary, folderId } : summary;
      setSummaries((current) => current.map(applyFolder));
      setActive((current) =>
        current?.kind === 'saved' && current.summary.id === trackId
          ? { ...current, summary: applyFolder(current.summary) }
          : current,
      );
      setMultiTrackSelections((current) =>
        current.map((selection) => ({
          ...selection,
          summary: applyFolder(selection.summary),
        })),
      );
      try {
        const updated = await database.moveLocalTrackToFolder(trackId, folderId);
        setSummaries((current) =>
          current.map((summary) => (summary.id === trackId ? updated : summary)),
        );
        setActive((current) =>
          current?.kind === 'saved' && current.summary.id === trackId
            ? { ...current, summary: updated }
            : current,
        );
        setMultiTrackSelections((current) =>
          current.map((selection) => ({
            ...selection,
            summary: selection.summary.id === trackId ? updated : selection.summary,
          })),
        );
        void userData.trackMetadataChanged(trackId);
        setError(null);
        return true;
      } catch {
        await reloadSummaries();
        setError(msg`The track could not be moved.`);
        return false;
      }
    },
    [database, reloadSummaries, userData],
  );

  const reorderFolders = useCallback(
    async (folderIds: readonly string[]): Promise<boolean> => {
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      setFolders(
        folderIds.flatMap((id, position) => {
          const folder = byId.get(id);
          return folder === undefined ? [] : [{ ...folder, position }];
        }),
      );
      try {
        const reordered = await database.reorderTrackFolders(folderIds);
        setFolders(reordered);
        void userData.foldersChanged();
        setError(null);
        return true;
      } catch {
        await reloadSummaries();
        setError(msg`The folder order could not be saved.`);
        return false;
      }
    },
    [database, folders, reloadSummaries, userData],
  );
  useEffect(() => {
    const thumbnailQueue = thumbnailRefresh.current;
    thumbnailQueue.disposed = false;
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
      thumbnailQueue.disposed = true;
    };
  }, [reloadSummaries]);
  useEffect(() => {
    const intent = sharedIntent.current;
    if (intent.kind === 'none') return undefined;
    if (intent.kind === 'invalid' || trackShares === null) {
      const timeout = window.setTimeout(() => {
        setError(
          intent.kind === 'invalid'
            ? msg`This track link is invalid.`
            : msg`Shared tracks are unavailable because cloud features are not configured.`,
        );
        setMobileWorkspaceOpen(true);
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
            ? msg`This shared track is unavailable.`
            : msg`Shared track could not be loaded. Try again.`,
        );
        setMobileWorkspaceOpen(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [elevationProvider, logger, setMobileWorkspaceOpen, trackShares]);

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
            setError(msg`The track could not be added to multi-track view.`);
          });
        }
      }),
    [active, database, multiTrackSelections, reloadSummaries, userData],
  );
  useEffect(
    () =>
      userData.subscribeFoldersChanged(() => {
        void reloadSummaries();
      }),
    [reloadSummaries, userData],
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
      mapLayers?.clearPlannedLineGeometry('route-plan');
      if (readyMultiTrackSelections.length === 0) {
        mapLayers?.clearImportedTrackGeometry();
        return;
      }
      const result = mapLayers?.setImportedTrackGeometry(
        readyMultiTrackSelections.map((selection) =>
          localTrackSegments(selection.content),
        ),
      );
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
      mapLayers?.clearPlannedLineGeometry('route-plan');
      return;
    }
    if (active.kind === 'route-plan') {
      renderedTrackId.current = null;
      mapLayers?.clearImportedTrackGeometry();
      mapLayers?.setPlannedLineGeometry(
        'route-plan',
        active.legs.flatMap((leg) => leg.sections),
        [...active.waypoints, ...active.queuedWaypoints],
      );
      return;
    }
    mapLayers?.clearPlannedLineGeometry('route-plan');
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
    const result = mapLayers?.setImportedTrackGeometry([segments]);
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
      try {
        const suggestion = await suggestTrackName({
          segments,
          places: searchPlaces,
          logger,
          lookedUpAt: clock.now().toISOString(),
          signal: controller.signal,
        });
        setActive((current) =>
          current?.kind === 'preview' &&
          current.preparationStatus === 'ready' &&
          current.id === preview.id
            ? { ...current, ...suggestion, namingStatus: 'ready' }
            : current,
        );
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
      const reportImportError = (message: MessageDescriptor) => {
        setImportError((current) => ({
          message,
          occurrence: (current?.occurrence ?? 0) + 1,
        }));
      };
      const selected = Array.from(files);
      if (selected.length !== 1) {
        reportImportError(msg`Choose exactly one GPX, FIT, or KML file.`);
        return;
      }
      const file = selected[0];
      const sourceFormat = file === undefined ? null : trackSourceFormat(file.name);
      if (file === undefined || sourceFormat === null) {
        reportImportError(msg`Choose a file with a .gpx, .fit, or .kml extension.`);
        return;
      }
      const replacingUnsavedTrack =
        active?.kind === 'preview' ||
        (active?.kind === 'route-plan' && active.waypoints.length > 0);
      if (
        replacingUnsavedTrack &&
        !window.confirm(t`Discard the current unsaved track and import another file?`)
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
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setRecalculationState('idle');
      setElevationProgress(null);
      const generation = importGeneration.current + 1;
      importGeneration.current = generation;
      setActive(null);
      setImportError(null);
      setError(null);
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setImportState('preparing');
      const controller = new AbortController();
      preparationAbort.current = controller;
      const importIsStale = (): boolean =>
        controller.signal.aborted || generation !== importGeneration.current;
      const importAll = async () => {
        const parsed = await parseTrackFile(file, sourceFormat);
        if (importIsStale()) return;
        const previewBase: PreviewTrackBase = {
          kind: 'preview',
          id: `local:${idGenerator.generate()}`,
          file,
          parsed,
          sourceFormat,
          name: initialTrackName(file, parsed, t`New track`),
          markers: parsed.waypoints.map((waypoint) => ({
            id: idGenerator.generate(),
            name: waypoint.name,
            coordinate: waypoint.coordinate,
          })),
        };
        setActive({ ...previewBase, preparationStatus: 'preparing' });
        setMobileWorkspaceOpen(false);
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
            preparationFailure instanceof TrackElevationPreparationError
              ? elevationPreparationFailureMessages[preparationFailure.code]
              : msg`Elevation preparation failed.`;
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
      };
      await importAll()
        .catch((importFailure: unknown) => {
          if (controller.signal.aborted || generation !== importGeneration.current)
            return;
          logger.log({ level: 'warn', name: 'local-track.import.failed' });
          reportImportError(
            importFailure instanceof GpxParseError
              ? trackImportFailureMessages[importFailure.code]
              : msg`The track file could not be imported.`,
          );
          setElevationProgress(null);
        })
        .finally(() => {
          if (generation === importGeneration.current) {
            preparationAbort.current = null;
            setElevationProgress(null);
            // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
            setImportState('idle');
          }
        });
    },
    [
      active,
      elevationProvider,
      generateName,
      idGenerator,
      logger,
      setMobileWorkspaceOpen,
      t,
    ],
  );

  const startRoutePlan = useCallback(() => {
    if (routePlanSaveInProgress.current) return;
    if (trailRouter === null) return;
    const replacingUnsavedTrack =
      active?.kind === 'preview' ||
      (active?.kind === 'route-plan' && active.waypoints.length > 0);
    if (
      replacingUnsavedTrack &&
      !window.confirm(t`Discard the current unsaved track and start a new route?`)
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
    /* eslint-disable lingui/no-unlocalized-strings -- State tokens and track ID prefix. */
    setRecalculationState('idle');
    setElevationProgress(null);
    setImportState('idle');
    importGeneration.current += 1;
    const draftId = `local:${idGenerator.generate()}`;
    /* eslint-enable lingui/no-unlocalized-strings */
    setActive(createRoutePlanDraft(draftId, t`New route`));
    setError(null);
    setMobileWorkspaceOpen(false);
  }, [active, idGenerator, setMobileWorkspaceOpen, t, trailRouter]);

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
    /* eslint-disable lingui/no-unlocalized-strings -- Routing result tokens. */
    const unavailable = {
      status: 'failed',
      reason: 'routing-data-unavailable',
    } as const;
    /* eslint-enable lingui/no-unlocalized-strings */
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
    setMobileWorkspaceOpen(false);
  }, [active, setMobileWorkspaceOpen]);

  const clearRoutePlan = useCallback(() => {
    if (routePlanSaveInProgress.current) return;
    routePlanRequestAbort.current?.abort();
    routePlanElevationAbort.current?.abort();
    setElevationProgress(null);
    setActive((current) =>
      current?.kind === 'route-plan' ? clearRoutePlanDraft(current) : current,
    );
    setMobileWorkspaceOpen(false);
  }, [setMobileWorkspaceOpen]);

  const discardRoutePlan = useCallback(() => {
    if (routePlanSaveInProgress.current) return;
    if (
      active?.kind === 'route-plan' &&
      active.waypoints.length > 0 &&
      !window.confirm(t`Discard this unsaved track?`)
    ) {
      return;
    }
    routePlanRequestAbort.current?.abort();
    routePlanElevationAbort.current?.abort();
    setElevationProgress(null);
    importGeneration.current += 1;
    setActive((current) => (current?.kind === 'route-plan' ? null : current));
    setError(null);
  }, [active, t]);

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
    const segment = active.segment;
    const metrics = active.metrics;
    setActive((current) =>
      current?.kind === 'route-plan' && current.id === planId
        ? { ...current, status: 'saving' }
        : current,
    );
    const generation = importGeneration.current;
    const saveRoute = async () => {
      const normalizedName = normalizeLocalTrackName(active.name);
      const savedAt = clock.now().toISOString();
      const content: LocalTrackContent = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        trackId: planId,
        trackPoints: [segment.points],
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
        folderId: null,
        pointCount: segment.points.length,
        segmentCount: 1,
        metrics,
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
    };
    await saveRoute()
      .catch((error: unknown) => {
        if (generation !== importGeneration.current) return;
        setActive((current) =>
          current?.kind === 'route-plan' &&
          current.id === planId &&
          current.status === 'saving'
            ? { ...current, status: previousStatus }
            : current,
        );
        setError(trackNameFailureMessage(error, msg`The route could not be saved.`));
      })
      .finally(() => {
        routePlanSaveInProgress.current = false;
      });
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
    const savePreviewTrack = async () => {
      /* eslint-disable lingui/no-unlocalized-strings -- Track ID prefixes. */
      const savedTrackId = active.id.startsWith('shared:')
        ? `local:${idGenerator.generate()}`
        : active.id;
      /* eslint-enable lingui/no-unlocalized-strings */
      const normalizedName = normalizeLocalTrackName(active.name);
      const savedAt = clock.now().toISOString();
      const promoteCalculatedElevation =
        active.sourceProfile === null &&
        active.calculatedSegments !== null &&
        active.calculatedMetrics !== null;
      const primarySegments = promoteCalculatedElevation
        ? active.calculatedSegments
        : active.sourceSegments;
      const content: LocalTrackContentBuilder = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        trackId: savedTrackId,
        trackPoints: primarySegments.map((segment) => segment.points),
        markers: active.markers,
      };
      if (!promoteCalculatedElevation && active.calculatedSegments !== null) {
        content.calculatedTrackPoints = active.calculatedSegments.map(
          (segment) => segment.points,
        );
      }
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
        folderId: IMPORTS_FOLDER_ID,
        pointCount: primarySegments.reduce(
          (count, segment) => count + segment.points.length,
          0,
        ),
        segmentCount: primarySegments.length,
        metrics: promoteCalculatedElevation
          ? active.calculatedMetrics
          : active.sourceMetrics,
        metadata: active.parsed.metadata,
        warnings: active.parsed.warnings,
      };
      if (!promoteCalculatedElevation && active.calculatedMetrics !== null) {
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
      await database.ensureImportsFolder();
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
      /* eslint-disable lingui/no-unlocalized-strings -- Track ID prefix and URL hash. */
      if (previewId.startsWith('shared:')) {
        window.history.replaceState(null, '', '#tracks');
      }
      /* eslint-enable lingui/no-unlocalized-strings */
      await reloadSummaries();
      setError(null);
    };
    await savePreviewTrack()
      .catch((error: unknown) => {
        if (generation !== importGeneration.current) return;
        setError(trackNameFailureMessage(error, msg`The track could not be saved.`));
      })
      .finally(() => {
        previewSaveInProgress.current = false;
      });
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
    // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
    setRecalculationState('recalculating');
    setElevationProgress(null);
    setError(null);
    const activeId =
      active.kind === 'preview' || active.kind === 'shared'
        ? active.id
        : active.summary.id;
    const generation = importGeneration.current;
    const recalculate = async () => {
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
      } else if (
        active.summary.metrics.elevationSource === 'dem-assisted' &&
        active.summary.calculatedMetrics === undefined &&
        active.content.calculatedTrackPoints === undefined
      ) {
        const calculated = requireCalculatedElevation(prepared);
        const content: LocalTrackContent = {
          schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
          trackId: activeId,
          trackPoints: calculated.segments.map((segment) => segment.points),
          markers: active.content.markers,
        };
        const summary: LocalTrackSummary = {
          ...active.summary,
          updatedAt: clock.now().toISOString(),
          contentHash: await trackContentHasher.hash(content),
          metrics: calculated.metrics,
        };
        await database.saveLocalTrack(summary, content);
        void userData.trackSaved(activeId);
        const reloadedContent = await database.loadLocalTrackContent(activeId);
        controller.signal.throwIfAborted();
        setActive((current) =>
          current?.kind === 'saved' && current.summary.id === activeId
            ? { ...current, summary, content: reloadedContent }
            : current,
        );
        await reloadSummaries();
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
    };
    await recalculate()
      .catch((recalculationError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            recalculationError instanceof TrackElevationPreparationError
              ? elevationPreparationFailureMessages[recalculationError.code]
              : msg`Elevation could not be recalculated.`,
          );
        }
      })
      .finally(() => {
        if (recalculationAbort.current === controller) {
          recalculationAbort.current = null;
          // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
          setRecalculationState('idle');
          setElevationProgress(null);
        }
      });
  }, [
    active,
    clock,
    database,
    elevationProvider,
    recalculationState,
    reloadSummaries,
    trackContentHasher,
    userData,
  ]);

  const discardPreview = useCallback(() => {
    initiallyRestoredTrackId.current = null;
    preparationAbort.current?.abort();
    recalculationAbort.current?.abort();
    /* eslint-disable lingui/no-unlocalized-strings -- State tokens. */
    setRecalculationState('idle');
    setElevationProgress(null);
    importGeneration.current += 1;
    namingAbort.current?.abort();
    setImportState('idle');
    /* eslint-enable lingui/no-unlocalized-strings */
    setActive(null);
    setError(null);
  }, []);

  const closeActive = useCallback(async () => {
    if (routePlanSaveInProgress.current) return false;
    const closingUnsavedTrack =
      active?.kind === 'preview' ||
      (active?.kind === 'route-plan' && active.waypoints.length > 0);
    if (closingUnsavedTrack && !window.confirm(t`Discard this unsaved track?`)) {
      return false;
    }
    if (active?.kind === 'saved') {
      const closingGeneration = importGeneration.current;
      try {
        await saveLatestOpenedTrackId(null);
      } catch {
        if (closingGeneration === importGeneration.current) {
          setError(msg`The track could not be closed.`);
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
    /* eslint-disable lingui/no-unlocalized-strings -- State tokens. */
    setRecalculationState('idle');
    setElevationProgress(null);
    importGeneration.current += 1;
    setImportState('idle');
    /* eslint-enable lingui/no-unlocalized-strings */
    namingAbort.current?.abort();
    setActive(null);
    setError(null);
    return true;
  }, [active, saveLatestOpenedTrackId, t]);
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
        setError(msg`The track could not be added to multi-track view.`);
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
        !window.confirm(t`Discard the current unsaved track and open the saved track?`)
      ) {
        return;
      }
      initiallyRestoredTrackId.current = null;
      renderedTrackId.current = null;
      preparationAbort.current?.abort();
      recalculationAbort.current?.abort();
      routePlanRequestAbort.current?.abort();
      routePlanElevationAbort.current?.abort();
      /* eslint-disable lingui/no-unlocalized-strings -- State tokens. */
      setRecalculationState('idle');
      setElevationProgress(null);
      const generation = importGeneration.current + 1;
      importGeneration.current = generation;
      setImportState('idle');
      /* eslint-enable lingui/no-unlocalized-strings */
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
        setMobileWorkspaceOpen(false);
      } catch {
        if (generation !== importGeneration.current) return;
        setError(msg`The track could not be opened.`);
        setMobileWorkspaceOpen(true);
        if (activeSavedTrackId !== null && latestOpenedTrackId.current === null) {
          try {
            await saveLatestOpenedTrackId(activeSavedTrackId);
          } catch {
            // The active saved track remains visible; preserve the open failure.
          }
        }
      }
    },
    [
      active,
      activeSavedTrackId,
      database,
      saveLatestOpenedTrackId,
      setMobileWorkspaceOpen,
      t,
    ],
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
    } catch (error) {
      if (generation === importGeneration.current) {
        setError(trackNameFailureMessage(error, msg`The track could not be renamed.`));
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
      setError(trackMarkerLimitMessage);
      return;
    }
    requestMarkerPlacement({ kind: 'track-marker', trackId: editableTrackId });
    setMobileWorkspaceOpen(false);
  }, [editableTrackId, editableTrackMarkers, multiTrackMode, setMobileWorkspaceOpen]);

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
        setError(msg`The favorite could not be updated.`);
      }
    },
    [database, reloadSummaries, userData],
  );

  const deleteSaved = useCallback(
    async (summary: LocalTrackSummary) => {
      const deleteTrack = async () => {
        if (active?.kind === 'saved' && active.summary.id === summary.id) {
          recalculationAbort.current?.abort();
          // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
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
      };
      await deleteTrack().catch(() => {
        setError(msg`The track could not be deleted.`);
      });
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
    // eslint-disable-next-line lingui/no-unlocalized-strings -- BCP 47 locale token.
    const normalizedQuery = query.trim().toLocaleLowerCase('en');
    const matchingSummaries =
      normalizedQuery.length === 0
        ? summaries
        : summaries.filter((summary) =>
            summary.normalizedName.includes(normalizedQuery),
          );
    return sortTracks(matchingSummaries, trackSort, mapCenter);
  }, [mapCenter, query, summaries, trackSort]);

  // Keyed on the geometry owner: renames replace `active` per keystroke but keep
  // `content`, so the median-filtered profile and map highlight stay untouched.
  const savedTrackContent = active?.kind === 'saved' ? active.content : null;
  const savedTrackProfile = useMemo(
    () =>
      savedTrackContent === null
        ? null
        : elevationProfileForSavedTrack(savedTrackContent),
    [savedTrackContent],
  );
  const activeProfile =
    active === null
      ? null
      : active.kind === 'saved'
        ? savedTrackProfile
        : active.kind === 'route-plan'
          ? active.profile
          : active.preparationStatus === 'ready'
            ? (active.sourceProfile ?? active.calculatedProfile)
            : null;
  const activeStatsMetrics = useMemo<TrackStatsMetrics | null>(() => {
    if (active === null) return null;
    if (active.kind === 'route-plan') return active.metrics;
    if (active.kind === 'saved') return active.summary.metrics;
    if (active.preparationStatus !== 'ready') return null;
    if (active.sourceProfile === null && active.calculatedMetrics !== null) {
      return active.calculatedMetrics;
    }
    return active.sourceMetrics;
  }, [active]);
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

  const errorMessage = error === null ? null : i18n._(error);
  const importErrorMessage = importError === null ? null : i18n._(importError.message);
  const value = useMemo<TracksWorkspaceValue>(
    () => ({
      active,
      activeProfile,
      activeStatsMetrics,
      addRoutePlanPoint,
      clearRoutePlan,
      elevationProgress,
      error: errorMessage,
      filteredSummaries,
      folders,
      collapsedFolderIds,
      toggleFolderCollapsed,
      trackWeatherPreferences,
      updateTrackWeatherPreferences,
      createFolder,
      updateFolder,
      deleteFolder,
      moveTrackToFolder,
      reorderFolders,
      importError: importErrorMessage,
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
      thumbnails,
    }),
    [
      active,
      addRoutePlanPoint,
      activeProfile,
      activeStatsMetrics,
      applyGeneratedName,
      elevationProgress,
      closeActive,
      clearRoutePlan,
      createFolder,
      deleteSaved,
      deleteFolder,
      discardPreview,
      discardRoutePlan,
      startTrackMarkerPlacement,
      renameTrackMarker,
      deleteTrackMarker,
      errorMessage,
      filteredSummaries,
      folders,
      collapsedFolderIds,
      toggleFolderCollapsed,
      trackWeatherPreferences,
      updateTrackWeatherPreferences,
      importErrorMessage,
      importFiles,
      importState,
      multiTrackMode,
      multiTrackSelections,
      multiTrackStatsMetrics,
      moveTrackToFolder,
      query,
      renameActive,
      recalculateElevation,
      recalculationState,
      reorderFolders,
      savePreview,
      saveRoutePlan,
      selectSaved,
      setNextSegmentMode,
      startRoutePlan,
      setActiveName,
      setQuery,
      undoLastRoutePlanPoint,
      thumbnails,
      summaries,
      updateFolder,
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

const trackSortLabels: Readonly<Record<TrackSort, MessageDescriptor>> = {
  created: msg`Newest`,
  name: msg`Name`,
  oldest: msg`Oldest`,
  distance: msg`Distance from map center`,
};

export function TrackSortControl({ onTrackSortChange }: TrackSortControlProps) {
  const { t, i18n } = useLingui();
  const trackSort = useUiStore((state) => state.trackSort);
  const currentSortLabel = i18n._(trackSortLabels[trackSort]);
  const [sortSaveError, setSortSaveError] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);

  const chooseSort = async (sort: TrackSort) => {
    setSortAnchor(null);
    const saved = await onTrackSortChange(sort);
    setSortSaveError(!saved);
  };

  return (
    <>
      <Tooltip title={t`Sort: ${currentSortLabel}`}>
        <IconButton
          size="small"
          aria-label={t`Sort tracks. Current: ${currentSortLabel}`}
          data-tour="track-sort"
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
            {i18n._(trackSortLabels[sort])}
          </MenuItem>
        ))}
      </Menu>
      <Snackbar
        open={sortSaveError}
        autoHideDuration={4_000}
        message={t`Sort preference could not be saved`}
        onClose={() => {
          setSortSaveError(false);
        }}
      />
    </>
  );
}

function TrackImportZone() {
  const { t } = useLingui();
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
      // eslint-disable-next-line lingui/no-unlocalized-strings -- DataTransfer type token.
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
        aria-label={t`Import track file`}
        data-tour="track-import"
        variant="outlined"
        onDragEnter={(event) => {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- DataTransfer type token.
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- DataTransfer type token.
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
            <Trans>Drop GPX, FIT, or KML here</Trans>
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => inputRef.current?.click()}
            sx={{ whiteSpace: 'nowrap', px: { xs: 1, sm: 1.25 } }}
          >
            <Trans>Browse track file</Trans>
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
              aria-label={t`Drop track file`}
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
                <Typography variant="subtitle2">
                  <Trans>Drop GPX, FIT, or KML here</Trans>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  <Trans>Release the file inside this zone</Trans>
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
  readonly onTrackSortChange: (sort: TrackSort) => Promise<boolean>;
}

type ActiveDrag =
  | {
      readonly type: 'folder';
      readonly id: string;
      readonly name: string;
      readonly width: number;
    }
  | {
      readonly type: 'track';
      readonly id: string;
      readonly name: string;
      readonly width: number;
    };
const trackFolderKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const activeData = args.context.active?.data.current;
  if (
    (activeData?.type !== 'track' && activeData?.type !== 'folder') ||
    (event.code !== 'ArrowUp' && event.code !== 'ArrowDown')
  ) {
    return args.currentCoordinates;
  }
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Drag data type tokens.
  const targetType = activeData.type === 'track' ? 'folder-target' : 'folder';
  const targets = args.context.droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const data = container.data.current;
      const rect = container.rect.current;
      return data?.type === targetType && rect !== null
        ? [{ folderId: data.folderId as string | null, rect }]
        : [];
    })
    .sort((left, right) => left.rect.top - right.rect.top);
  const overData = args.context.over?.data.current;
  let target: (typeof targets)[number] | undefined;
  if (activeData.type === 'track') {
    const currentTarget = targets.find(
      (candidate, index) =>
        args.currentCoordinates.y >= candidate.rect.top &&
        (args.currentCoordinates.y < candidate.rect.bottom ||
          (index === targets.length - 1 &&
            args.currentCoordinates.y <= candidate.rect.bottom)),
    );
    const currentFolderId =
      currentTarget?.folderId ?? (activeData.summary as LocalTrackSummary).folderId;
    const currentIndex = targets.findIndex(
      (candidate) => candidate.folderId === currentFolderId,
    );
    target =
      currentIndex < 0
        ? undefined
        : targets[currentIndex + (event.code === 'ArrowDown' ? 1 : -1)];
  } else {
    // Folder positions may tie after synchronization, so keyboard moves step
    // through the rendered order rather than comparing stored positions.
    const currentFolderId =
      overData?.type === 'folder'
        ? (overData.folderId as string)
        : (activeData.folder as TrackFolder).id;
    const currentIndex = targets.findIndex(
      (candidate) => candidate.folderId === currentFolderId,
    );
    target =
      currentIndex < 0
        ? undefined
        : targets[currentIndex + (event.code === 'ArrowDown' ? 1 : -1)];
  }
  if (target === undefined) return args.currentCoordinates;
  return {
    x: target.rect.left + target.rect.width / 2,
    y: target.rect.top + target.rect.height / 2,
  };
};

// The saved-track list bleeds to the panel edges. Drag handles live in the
// panel's 16 px side padding, so hover never shifts row content, and folder
// contents align with the folder name to show hierarchy.
const TRACK_LIST_GUTTER_PX = 16;
const TRACK_FOLDER_GLYPH_PX = 20;
const TRACK_FOLDER_INDENT_PX = TRACK_FOLDER_GLYPH_PX + 8;

/* eslint-disable lingui/no-unlocalized-strings -- CSS values and selectors. */
const dragHandleSx: SxProps<Theme> = {
  alignSelf: 'stretch',
  width: TRACK_LIST_GUTTER_PX,
  minWidth: 0,
  p: 0,
  borderRadius: 0,
  color: 'text.secondary',
  touchAction: 'none',
  cursor: 'grab',
  '& .MuiSvgIcon-root': { fontSize: 16 },
  '&:hover': { bgcolor: 'transparent', color: 'text.primary' },
  '&.Mui-focusVisible': {
    bgcolor: 'transparent',
    outline: '2px solid currentColor',
    outlineOffset: -2,
  },
};

// Secondary row controls stay in the layout and only fade in, so revealing
// them never reflows the row. Keyboard focus reveals them too; focus restored
// after a pointer drag does not. Touch devices have no hover and always show them.
function revealOnRowHover(selector: string, hoverSelector: string) {
  return {
    [`& ${selector}`]: {
      opacity: 0,
      pointerEvents: 'none',
      transition: 'opacity 150ms ease-out',
    },
    [`&${hoverSelector} ${selector}, &:has(:focus-visible) ${selector}`]: {
      opacity: 1,
      pointerEvents: 'auto',
    },
    '@media (hover: none), (pointer: coarse)': {
      [`& ${selector}`]: { opacity: 1, pointerEvents: 'auto' },
    },
  } as const;
}
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * Hover state shared by every saved-track row. A pointer favorite click re-sorts
 * rows under a stationary pointer, which fires enter events on whichever row slides
 * underneath; hover stays suppressed across all rows until the pointer really moves.
 */
interface SavedTrackHover {
  readonly suppressed: boolean;
  /** Remounts row tooltips so one opened before the re-sort closes. */
  readonly epoch: number;
  readonly resume: () => void;
}

interface SavedTrackRowProps {
  readonly summary: LocalTrackSummary;
  readonly thumbnail: TrackThumbnail | undefined;
  readonly folderId: string | null;
  readonly selected: boolean;
  readonly multiTrackMode: boolean;
  readonly deleting: boolean;
  readonly hover: SavedTrackHover;
  readonly onSelect: () => void;
  readonly onToggleFavorite: (fromPointer: boolean) => void;
  readonly onDelete: () => Promise<void>;
}

function SavedTrackRow({
  summary,
  thumbnail,
  folderId,
  selected,
  multiTrackMode,
  deleting,
  hover,
  onSelect,
  onToggleFavorite,
  onDelete,
}: SavedTrackRowProps) {
  const { t, i18n } = useLingui();
  const [pendingDelete, setPendingDelete] = useState(false);
  const [hovered, setHovered] = useState(false);
  const {
    attributes: dragAttributes,
    isDragging,
    listeners: dragListeners,
    setActivatorNodeRef,
    setNodeRef: setDraggableNodeRef,
  } = useDraggable({
    id: `track:${summary.id}`,
    data: { type: 'track', summary },
  });
  const { setNodeRef: setDroppableNodeRef } = useDroppable({
    id: `track-target:${summary.id}`,
    data: { type: 'track-target', folderId },
  });
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDraggableNodeRef(node);
      setDroppableNodeRef(node);
    },
    [setDraggableNodeRef, setDroppableNodeRef],
  );
  /* eslint-disable lingui/no-unlocalized-strings -- CSS class names. */
  const actionClassName = `saved-track-row-action${
    pendingDelete ? ' saved-track-row-action--pending' : ''
  }`;
  /* eslint-enable lingui/no-unlocalized-strings */
  const elapsedSeconds = summary.metrics.elapsedSeconds;
  const ascentMeters = summary.metrics.ascentMeters;

  return (
    <ClickAwayListener
      onClickAway={() => {
        if (!deleting) setPendingDelete(false);
      }}
    >
      <Box
        ref={setNodeRef}
        component="li"
        data-tour="track-row"
        className={hovered ? 'saved-track-row--hovered' : undefined}
        sx={{
          display: 'grid',
          gridTemplateColumns: `${String(TRACK_LIST_GUTTER_PX)}px minmax(0, 1fr) auto`,
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider',
          opacity: isDragging ? 0 : 1,
          bgcolor: selected
            ? hovered
              ? `color-mix(in srgb, ${appColors.surface.selected}, ${appColors.text.primary} 8%)`
              : appColors.surface.selected
            : hovered
              ? 'action.hover'
              : 'transparent',
          '& .MuiListItemButton-root, & .MuiListItemButton-root:hover, & .MuiListItemButton-root.Mui-selected, & .MuiListItemButton-root.Mui-selected:hover':
            { bgcolor: 'transparent' },
          ...revealOnRowHover('.saved-track-row-action', '.saved-track-row--hovered'),
          '& .saved-track-row-favorite--active, & .saved-track-row-action--pending': {
            opacity: 1,
            pointerEvents: 'auto',
          },
        }}
        onMouseEnter={() => {
          if (!hover.suppressed) setHovered(true);
        }}
        onMouseMove={() => {
          if (hover.suppressed) hover.resume();
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
          if (!deleting) setPendingDelete(false);
        }}
      >
        <IconButton
          ref={setActivatorNodeRef}
          className="saved-track-row-action"
          size="small"
          aria-label={t`Move ${summary.name}`}
          // eslint-disable-next-line lingui/no-unlocalized-strings -- Focus restoration key.
          data-drag-focus={`track:${summary.id}`}
          sx={dragHandleSx}
          {...dragAttributes}
          {...dragListeners}
        >
          <DragIndicatorIcon fontSize="small" />
        </IconButton>
        <ListItemButton
          selected={selected}
          aria-pressed={multiTrackMode ? selected : undefined}
          onClick={onSelect}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            columnGap: 1.5,
            minWidth: 0,
            py: 1.25,
            pl: folderId === null ? 0 : `${String(TRACK_FOLDER_INDENT_PX)}px`,
            pr: 0.5,
          }}
        >
          <TrackThumbnailImage thumbnail={thumbnail} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2">{summary.name}</Typography>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}
            >
              {elapsedSeconds === undefined ? null : (
                <TrackStat
                  icon={<TimerOutlinedIcon sx={{ fontSize: 16 }} />}
                  label={t`Recorded time`}
                  value={formatTrackDuration(elapsedSeconds, i18n)}
                />
              )}
              <TrackStat
                icon={<SwapHorizIcon sx={{ fontSize: 16 }} />}
                label={t`Distance`}
                value={formatTrackDistance(summary.metrics.distanceMeters, i18n)}
              />
              {ascentMeters === undefined ? null : (
                <TrackStat
                  icon={<NorthEastIcon sx={{ fontSize: 16 }} />}
                  label={t`Elevation gain`}
                  value={formatTrackElevation(ascentMeters, i18n)}
                />
              )}
            </Stack>
          </Box>
        </ListItemButton>
        <Stack
          key={`saved-track-actions:${summary.id}:${String(hover.epoch)}`}
          direction="row"
          spacing={0}
          sx={{ alignItems: 'center', pr: 1 }}
        >
          <Tooltip
            disableHoverListener={hover.suppressed}
            title={summary.favorite ? t`Remove from favorites` : t`Add to favorites`}
          >
            <IconButton
              className={`saved-track-row-action${
                summary.favorite ? ' saved-track-row-favorite--active' : ''
              }`}
              size="small"
              aria-label={
                summary.favorite ? t`Remove from favorites` : t`Add to favorites`
              }
              color={summary.favorite ? 'warning' : 'default'}
              onClick={(event) => {
                const fromPointer = event.detail > 0;
                if (fromPointer) setHovered(false);
                onToggleFavorite(fromPointer);
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
            disableHoverListener={hover.suppressed}
            title={pendingDelete ? t`Confirm deletion` : t`Delete track`}
          >
            <IconButton
              className={actionClassName}
              size="small"
              aria-label={
                pendingDelete
                  ? t`Confirm deletion of ${summary.name}`
                  : t`Delete ${summary.name}`
              }
              color={pendingDelete ? 'error' : 'default'}
              disabled={deleting}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !deleting) {
                  setPendingDelete(false);
                  event.currentTarget.blur();
                }
              }}
              onClick={() => {
                if (!pendingDelete) {
                  setPendingDelete(true);
                  return;
                }
                void onDelete().finally(() => {
                  setPendingDelete(false);
                });
              }}
            >
              {pendingDelete ? (
                <DeleteForeverOutlinedIcon fontSize="small" />
              ) : (
                <DeleteOutlineOutlinedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
    </ClickAwayListener>
  );
}

interface SavedTrackListProps {
  readonly ariaLabel: string;
  readonly summaries: readonly LocalTrackSummary[];
  readonly thumbnails: ReadonlyMap<string, TrackThumbnail>;
  readonly folderId: string | null;
  readonly deletingId: string | null;
  readonly active: ActiveTrack | null;
  readonly multiTrackMode: boolean;
  readonly multiTrackSelections: readonly MultiTrackSelection[];
  readonly hover: SavedTrackHover;
  readonly onSelect: (summary: LocalTrackSummary, selected: boolean) => void;
  readonly onToggleFavorite: (summary: LocalTrackSummary, fromPointer: boolean) => void;
  readonly onDelete: (summary: LocalTrackSummary) => Promise<void>;
}

function SavedTrackList({
  ariaLabel,
  summaries,
  thumbnails,
  folderId,
  deletingId,
  active,
  multiTrackMode,
  multiTrackSelections,
  hover,
  onSelect,
  onToggleFavorite,
  onDelete,
}: SavedTrackListProps) {
  return (
    <List disablePadding aria-label={ariaLabel} sx={{ m: 0, width: '100%' }}>
      {summaries.map((summary) => {
        const selected = multiTrackMode
          ? multiTrackSelections.some(
              (selection) => selection.summary.id === summary.id,
            )
          : active?.kind === 'saved' && active.summary.id === summary.id;
        return (
          <SavedTrackRow
            key={summary.id}
            summary={summary}
            thumbnail={thumbnails.get(summary.id)}
            folderId={folderId}
            selected={selected}
            multiTrackMode={multiTrackMode}
            deleting={deletingId === summary.id}
            hover={hover}
            onSelect={() => {
              onSelect(summary, selected);
            }}
            onToggleFavorite={(fromPointer) => {
              onToggleFavorite(summary, fromPointer);
            }}
            onDelete={() => onDelete(summary)}
          />
        );
      })}
    </List>
  );
}

interface TrackFolderSectionProps {
  readonly folder: TrackFolder;
  readonly summaries: readonly LocalTrackSummary[];
  readonly thumbnails: ReadonlyMap<string, TrackThumbnail>;
  readonly collapsed: boolean;
  readonly deletingId: string | null;
  readonly active: ActiveTrack | null;
  readonly multiTrackMode: boolean;
  readonly multiTrackSelections: readonly MultiTrackSelection[];
  readonly hover: SavedTrackHover;
  readonly onToggleCollapsed: (folderId: string) => void;
  readonly onEditFolder: (folder: TrackFolder) => void;
  readonly onSelect: (summary: LocalTrackSummary, selected: boolean) => void;
  readonly onToggleFavorite: (summary: LocalTrackSummary, fromPointer: boolean) => void;
  readonly onDelete: (summary: LocalTrackSummary) => Promise<void>;
}

function TrackFolderSection({
  folder,
  summaries,
  thumbnails,
  collapsed,
  deletingId,
  active,
  multiTrackMode,
  multiTrackSelections,
  hover,
  onToggleCollapsed,
  onEditFolder,
  onSelect,
  onToggleFavorite,
  onDelete,
}: TrackFolderSectionProps) {
  const { t } = useLingui();
  const {
    attributes: sortableAttributes,
    isDragging,
    listeners: sortableListeners,
    setActivatorNodeRef,
    setNodeRef: setSortableNodeRef,
    transform,
    transition,
  } = useSortable({
    id: `folder-order:${folder.id}`,
    data: { type: 'folder', folderId: folder.id, folder },
  });
  const { isOver, setNodeRef: setDropNodeRef } = useDroppable({
    id: `folder-drop:${folder.id}`,
    data: {
      type: 'folder-target',
      folderId: folder.id,
      folder,
    },
  });
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setSortableNodeRef(node);
      setDropNodeRef(node);
    },
    [setDropNodeRef, setSortableNodeRef],
  );

  return (
    <Box
      ref={setNodeRef}
      role="listitem"
      data-folder-order={folder.id}
      data-folder-drop={folder.id}
      sx={{
        transform: CSS.Transform.toString(transform),
        opacity: isDragging ? 0 : 1,
        bgcolor: isOver ? 'action.selected' : 'transparent',
        transition: [transition, 'background-color 150ms ease-out']
          .filter(Boolean)
          .join(', '),
      }}
    >
      <Box
        component="section"
        aria-label={`${folder.name} (${String(summaries.length)})`}
      >
        <Box
          sx={{
            display: 'grid',
            // Columns match the track rows: gutter, content, favorite-sized
            // edit action, delete-sized chevron. The toggle spans the last
            // three columns so the whole header, chevron included, expands.
            gridTemplateColumns: `${String(TRACK_LIST_GUTTER_PX)}px minmax(0, 1fr) 30px 38px`,
            minHeight: 44,
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: appColors.surface.subtle,
            '&:hover': { bgcolor: 'action.hover' },
            '& .MuiListItemButton-root:hover': { bgcolor: 'transparent' },
            ...revealOnRowHover('.track-folder-action', ':hover'),
          }}
        >
          <IconButton
            className="track-folder-action"
            ref={setActivatorNodeRef}
            size="small"
            aria-label={t`Reorder ${folder.name}`}
            // eslint-disable-next-line lingui/no-unlocalized-strings -- Focus restoration key.
            data-drag-focus={`folder:${folder.id}`}
            sx={dragHandleSx}
            {...sortableAttributes}
            {...sortableListeners}
          >
            <DragIndicatorIcon />
          </IconButton>
          <ListItemButton
            aria-expanded={!collapsed}
            aria-label={
              collapsed ? t`Expand ${folder.name}` : t`Collapse ${folder.name}`
            }
            onClick={() => {
              onToggleCollapsed(folder.id);
            }}
            sx={{
              gridColumn: '2 / -1',
              gridRow: 1,
              alignSelf: 'stretch',
              minWidth: 0,
              gap: 1,
              px: 0,
              py: 0.5,
            }}
          >
            <Box
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: TRACK_FOLDER_GLYPH_PX,
                flexShrink: 0,
                color: 'text.secondary',
              }}
            >
              <SelectableIconGlyph
                iconKey={folder.iconKey}
                size={TRACK_FOLDER_GLYPH_PX}
              />
            </Box>
            <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
              {folder.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {summaries.length}
            </Typography>
            <Box aria-hidden sx={{ flex: 1, minWidth: 32 }} />
            <KeyboardArrowDownIcon
              fontSize="small"
              sx={{
                mr: '13px',
                flexShrink: 0,
                color: 'text.secondary',
                transform: collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 150ms ease-out',
              }}
            />
          </ListItemButton>
          <Tooltip title={t`Edit ${folder.name}`}>
            <IconButton
              className="track-folder-action"
              size="small"
              aria-label={t`Edit ${folder.name}`}
              sx={{ gridColumn: 3, gridRow: 1, zIndex: 1 }}
              onClick={() => {
                onEditFolder(folder);
              }}
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {collapsed ? null : summaries.length === 0 ? (
          <Box
            sx={{
              minHeight: 34,
              display: 'flex',
              alignItems: 'center',
              pl: `${String(TRACK_LIST_GUTTER_PX + TRACK_FOLDER_INDENT_PX)}px`,
              pr: 2,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary">
              <Trans>Drop tracks here</Trans>
            </Typography>
          </Box>
        ) : (
          <SavedTrackList
            ariaLabel={t`${folder.name} tracks`}
            summaries={summaries}
            thumbnails={thumbnails}
            folderId={folder.id}
            deletingId={deletingId}
            active={active}
            multiTrackMode={multiTrackMode}
            multiTrackSelections={multiTrackSelections}
            hover={hover}
            onSelect={onSelect}
            onToggleFavorite={onToggleFavorite}
            onDelete={onDelete}
          />
        )}
      </Box>
    </Box>
  );
}

interface UnfiledTrackDropZoneProps {
  readonly summaries: readonly LocalTrackSummary[];
  readonly thumbnails: ReadonlyMap<string, TrackThumbnail>;
  readonly trackDragActive: boolean;
  readonly deletingId: string | null;
  readonly active: ActiveTrack | null;
  readonly multiTrackMode: boolean;
  readonly multiTrackSelections: readonly MultiTrackSelection[];
  readonly hover: SavedTrackHover;
  readonly onSelect: (summary: LocalTrackSummary, selected: boolean) => void;
  readonly onToggleFavorite: (summary: LocalTrackSummary, fromPointer: boolean) => void;
  readonly onDelete: (summary: LocalTrackSummary) => Promise<void>;
}

function UnfiledTrackDropZone({
  summaries,
  thumbnails,
  trackDragActive,
  deletingId,
  active,
  multiTrackMode,
  multiTrackSelections,
  hover,
  onSelect,
  onToggleFavorite,
  onDelete,
}: UnfiledTrackDropZoneProps) {
  const { t } = useLingui();
  const { isOver, setNodeRef } = useDroppable({
    id: 'folder-drop:unfiled',
    data: { type: 'folder-target', folderId: null },
  });

  return (
    <Box
      ref={setNodeRef}
      role="listitem"
      aria-label={t`Unfiled tracks`}
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Drop target ID.
      data-folder-drop="unfiled"
      sx={{
        minHeight: summaries.length === 0 && trackDragActive ? 44 : undefined,
        bgcolor: isOver ? 'action.selected' : 'transparent',
        transition: 'background-color 150ms ease-out',
      }}
    >
      {summaries.length > 0 ? (
        <SavedTrackList
          ariaLabel={t`Unfiled tracks`}
          summaries={summaries}
          thumbnails={thumbnails}
          folderId={null}
          deletingId={deletingId}
          active={active}
          multiTrackMode={multiTrackMode}
          multiTrackSelections={multiTrackSelections}
          hover={hover}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          onDelete={onDelete}
        />
      ) : trackDragActive ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'flex', minHeight: 44, alignItems: 'center', px: 2 }}
        >
          <Trans>Drop tracks here</Trans>
        </Typography>
      ) : null}
    </Box>
  );
}

export function TracksPanel({
  onOpenActiveDetails,
  onTrackSortChange,
}: TracksPanelProps) {
  const {
    active,
    collapsedFolderIds,
    createFolder,
    deleteFolder,
    deleteSaved,
    error,
    filteredSummaries,
    folders,
    moveTrackToFolder,
    multiTrackMode,
    multiTrackSelections,
    query,
    reorderFolders,
    selectSaved,
    setQuery,
    summaries,
    thumbnails,
    toggleFavorite,
    toggleFolderCollapsed,
    toggleMultiTrackSelection,
    updateFolder,
  } = useTracksWorkspace();
  const { t } = useLingui();
  const trackCount = summaries.length;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  const [hoverEpoch, setHoverEpoch] = useState(0);
  const hover = useMemo<SavedTrackHover>(
    () => ({
      suppressed: hoverSuppressed,
      epoch: hoverEpoch,
      resume: () => {
        setHoverSuppressed(false);
      },
    }),
    [hoverEpoch, hoverSuppressed],
  );
  const toggleRowFavorite = (summary: LocalTrackSummary, fromPointer: boolean) => {
    if (fromPointer) {
      setHoverSuppressed(true);
      setHoverEpoch((current) => current + 1);
    }
    void toggleFavorite(summary);
  };
  const [editingFolder, setEditingFolder] = useState<TrackFolder | 'create' | null>(
    null,
  );
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: trackFolderKeyboardCoordinates }),
  );
  const knownFolderIds = useMemo(
    () => new Set(folders.map((folder) => folder.id)),
    [folders],
  );
  const grouped = useMemo(
    () =>
      folders.map((folder) => ({
        folder,
        summaries: filteredSummaries.filter(
          (summary) => summary.folderId === folder.id,
        ),
      })),
    [filteredSummaries, folders],
  );
  const unfiled = useMemo(
    () =>
      filteredSummaries.filter(
        (summary) => summary.folderId === null || !knownFolderIds.has(summary.folderId),
      ),
    [filteredSummaries, knownFolderIds],
  );

  const restoreFocus = (focusKey: string) => {
    window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-drag-focus="${focusKey}"]`,
      );
      element?.focus();
    }, 0);
  };
  const dragStart = ({ active: dragged }: DragStartEvent) => {
    const data = dragged.data.current;
    const width = dragged.rect.current.initial?.width ?? 280;
    if (data?.type === 'folder') {
      const folder = data.folder as TrackFolder;
      setActiveDrag({ type: 'folder', id: folder.id, name: folder.name, width });
    } else if (data?.type === 'track') {
      const summary = data.summary as LocalTrackSummary;
      setActiveDrag({ type: 'track', id: summary.id, name: summary.name, width });
    }
  };
  const dragEnd = ({ active: dragged, over }: DragEndEvent) => {
    const drag = dragged.data.current;
    const target = over?.data.current;
    setActiveDrag(null);
    if (drag?.type === 'track') {
      const summary = drag.summary as LocalTrackSummary;
      const folderId =
        target?.type === 'folder' ||
        target?.type === 'folder-target' ||
        target?.type === 'track-target'
          ? (target.folderId as string | null)
          : undefined;
      if (folderId === undefined || folderId === summary.folderId) {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Focus restoration key.
        restoreFocus(`track:${summary.id}`);
        return;
      }
      void moveTrackToFolder(summary.id, folderId).finally(() => {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Focus restoration key.
        restoreFocus(`track:${summary.id}`);
      });
      return;
    }
    if (drag?.type !== 'folder') return;
    const folder = drag.folder as TrackFolder;
    const targetFolderId =
      target?.type === 'folder'
        ? (target.folderId as string)
        : target?.type === 'folder-target' || target?.type === 'track-target'
          ? (target.folderId as string | null)
          : null;
    if (targetFolderId === null || targetFolderId === folder.id) {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Focus restoration key.
      restoreFocus(`folder:${folder.id}`);
      return;
    }
    const oldIndex = folders.findIndex((candidate) => candidate.id === folder.id);
    const newIndex = folders.findIndex((candidate) => candidate.id === targetFolderId);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove([...folders], oldIndex, newIndex).map(
      (candidate) => candidate.id,
    );
    void reorderFolders(next).finally(() => {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Focus restoration key.
      restoreFocus(`folder:${folder.id}`);
    });
  };
  const select = (summary: LocalTrackSummary, selected: boolean) => {
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
  };
  const remove = async (summary: LocalTrackSummary) => {
    setDeletingId(summary.id);
    await deleteSaved(summary).finally(() => {
      setDeletingId(null);
    });
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={dragStart}
        onDragCancel={() => {
          if (activeDrag !== null) {
            restoreFocus(`${activeDrag.type}:${activeDrag.id}`);
          }
          setActiveDrag(null);
        }}
        onDragEnd={dragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable: t`Press space to pick up an item. Use arrow keys to move it. Press space to drop or Escape to cancel.`,
          },
          announcements: {
            onDragStart({ active: dragged }) {
              const data = dragged.data.current;
              if (data?.type === 'folder') {
                return t`Picked up folder ${(data.folder as TrackFolder).name}.`;
              }
              if (data?.type === 'track') {
                return t`Picked up track ${(data.summary as LocalTrackSummary).name}.`;
              }
              return t`Picked up item.`;
            },
            onDragOver({ over }) {
              const data = over?.data.current;
              if (
                data?.type === 'folder' ||
                data?.type === 'folder-target' ||
                data?.type === 'track-target'
              ) {
                const folderId = data.folderId as string | null;
                const name =
                  folderId === null
                    ? t`Unfiled`
                    : folders.find((folder) => folder.id === folderId)?.name;
                return name === undefined ? undefined : t`Over ${name}.`;
              }
              return undefined;
            },
            onDragEnd() {
              return t`Item dropped.`;
            },
            onDragCancel() {
              return t`Move cancelled.`;
            },
          },
        }}
      >
        {/* useFlexGap keeps Stack from resetting the saved-track list's
            negative margins, which let it bleed to the panel edges. */}
        <Stack
          spacing={2}
          useFlexGap
          sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2 }}
        >
          <TrackImportZone />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto auto',
              gap: 0.75,
              alignItems: 'center',
            }}
          >
            <TextField
              fullWidth
              size="small"
              aria-label={t`Search saved tracks`}
              placeholder={t`${plural(trackCount, {
                one: 'Search # saved track',
                other: 'Search # saved tracks',
              })}`}
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
            <TrackSortControl onTrackSortChange={onTrackSortChange} />
            <Tooltip title={t`Create folder`}>
              <IconButton
                size="small"
                aria-label={t`Create folder`}
                data-tour="create-folder"
                onClick={() => {
                  // eslint-disable-next-line lingui/no-unlocalized-strings -- Editor mode token.
                  setEditingFolder('create');
                }}
              >
                <CreateNewFolderOutlinedIcon />
              </IconButton>
            </Tooltip>
          </Box>
          {error === null ? null : <Alert severity="warning">{error}</Alert>}
          {summaries.length === 0 && folders.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 2, bgcolor: appColors.surface.subtle }}>
              <Typography variant="body2" color="text.secondary">
                <Trans>
                  Import a GPX, FIT, or KML file to preview it, then save it in this
                  browser.
                </Trans>
              </Typography>
            </Paper>
          ) : null}
          {query.length > 0 && filteredSummaries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              <Trans>No saved track matches this name.</Trans>
            </Typography>
          ) : null}
          {folders.length > 0 || summaries.length > 0 ? (
            <Box
              role="list"
              aria-label={t`Saved tracks`}
              sx={{
                width: 'calc(100% + 32px)',
                mx: -2,
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              <SortableContext
                // eslint-disable-next-line lingui/no-unlocalized-strings -- Sortable item IDs.
                items={folders.map((folder) => `folder-order:${folder.id}`)}
                strategy={verticalListSortingStrategy}
              >
                {grouped.map(({ folder, summaries: folderSummaries }) => (
                  <TrackFolderSection
                    key={folder.id}
                    folder={folder}
                    summaries={folderSummaries}
                    thumbnails={thumbnails}
                    collapsed={collapsedFolderIds.has(folder.id)}
                    deletingId={deletingId}
                    active={active}
                    multiTrackMode={multiTrackMode}
                    multiTrackSelections={multiTrackSelections}
                    hover={hover}
                    onToggleCollapsed={toggleFolderCollapsed}
                    onEditFolder={setEditingFolder}
                    onSelect={select}
                    onToggleFavorite={toggleRowFavorite}
                    onDelete={remove}
                  />
                ))}
              </SortableContext>
              <UnfiledTrackDropZone
                summaries={unfiled}
                thumbnails={thumbnails}
                trackDragActive={activeDrag?.type === 'track'}
                deletingId={deletingId}
                active={active}
                multiTrackMode={multiTrackMode}
                multiTrackSelections={multiTrackSelections}
                hover={hover}
                onSelect={select}
                onToggleFavorite={toggleRowFavorite}
                onDelete={remove}
              />
            </Box>
          ) : null}
        </Stack>
        <DragOverlay>
          {activeDrag === null ? null : (
            <Paper
              elevation={4}
              square
              sx={{
                width: activeDrag.width,
                maxWidth: 'calc(100vw - 32px)',
                minHeight: 44,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.75,
                pointerEvents: 'none',
              }}
            >
              {activeDrag.type === 'folder' ? (
                <FolderOutlinedIcon fontSize="small" />
              ) : (
                <DragIndicatorIcon fontSize="small" />
              )}
              <Typography variant="subtitle2" noWrap>
                {activeDrag.name}
              </Typography>
            </Paper>
          )}
        </DragOverlay>
      </DndContext>
      <TrackFolderEditorDialog
        open={editingFolder !== null}
        folder={editingFolder === 'create' ? null : editingFolder}
        onCancel={() => {
          setEditingFolder(null);
        }}
        onSave={async (name, iconKey) => {
          if (editingFolder === null) return;
          if (editingFolder === 'create') {
            await createFolder(name, iconKey);
          } else {
            await updateFolder(editingFolder, name, iconKey);
          }
          setEditingFolder(null);
        }}
        {...(editingFolder === null ||
        editingFolder === 'create' ||
        editingFolder.id === IMPORTS_FOLDER_ID
          ? {}
          : {
              onDelete: async () => {
                await deleteFolder(editingFolder);
                setEditingFolder(null);
              },
            })}
      />
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
  // Recharts reports the active sample on every mousemove; publish only real changes.
  const tracedPoint = useRef<ElevationProfilePoint | null>(null);
  useEffect(() => {
    tracedPoint.current = null;
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
            if (point === tracedPoint.current) return;
            tracedPoint.current = point;
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
              <Trans>Elevation profile</Trans>
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
                {active.kind === 'route-plan' ? (
                  <Trans>
                    Add at least two route points to see the elevation profile.
                  </Trans>
                ) : (
                  <Trans>No elevation profile is available for this track.</Trans>
                )}
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
  const { t, i18n } = useLingui();
  const countsLabel = t`${plural(pointCount, {
    one: '# point',
    other: '# points',
  })} · ${plural(segmentCount, { one: '# segment', other: '# segments' })}`;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- BCP 47 locale token.
  const formatLabel = sourceFormat.toLocaleUpperCase('en');
  const calculatedAscent =
    calculatedMetrics?.ascentMeters === undefined
      ? null
      : formatTrackElevation(calculatedMetrics.ascentMeters, i18n);
  const calculatedDescent =
    calculatedMetrics?.descentMeters === undefined
      ? null
      : formatTrackElevation(calculatedMetrics.descentMeters, i18n);
  const savedAtLabel = savedAt === undefined ? null : formatDateTime(new Date(savedAt));
  return (
    <Stack spacing={0.5} sx={{ px: 1 }}>
      <Typography variant="body2">
        {sourceFilename} · {formatLabel}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {countsLabel}
      </Typography>
      {calculatedAscent === null ? null : (
        <Typography
          aria-label={t`Elevation gain (calculated): ${calculatedAscent}`}
          variant="caption"
          color="text.secondary"
        >
          <Trans>Elevation gain (calculated): {calculatedAscent}</Trans>
        </Typography>
      )}
      {calculatedDescent === null ? null : (
        <Typography
          aria-label={t`Elevation loss (calculated): ${calculatedDescent}`}
          variant="caption"
          color="text.secondary"
        >
          <Trans>Elevation loss (calculated): {calculatedDescent}</Trans>
        </Typography>
      )}
      {savedAtLabel === null ? null : (
        <Typography variant="caption" color="text.secondary">
          <Trans>Saved {savedAtLabel}</Trans>
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

function shareMutationErrorMessage(error: unknown): MessageDescriptor {
  if (
    error instanceof TrackShareError &&
    (error.category === 'track-not-found' || error.category === 'track-not-ready')
  ) {
    return msg`Sync this track before sharing.`;
  }
  return msg`Sharing could not be updated. Try again.`;
}

interface ShareNotice {
  readonly contentHash: string;
  readonly message: MessageDescriptor;
}

const trackWarningMessages: Readonly<Record<GpxWarningCode, MessageDescriptor>> = {
  'invalid-point': msg`A point with invalid coordinates was skipped.`,
  'invalid-waypoint': msg`A waypoint with invalid coordinates was skipped.`,
  'short-segment': msg`A segment with fewer than two valid points was skipped.`,
  'track-preferred-over-route': msg`Detailed track geometry was used instead of companion route geometry.`,
  'invalid-time': msg`A point with an invalid timestamp was retained without time.`,
  'waypoint-limit-reached': msg`Additional valid waypoints were omitted.`,
  'warning-limit-reached': msg`Additional GPX validation warnings were omitted.`,
};

/** Localized warning text; the parser's stored English message is diagnostic data. */
function trackWarningDetail(warning: GpxValidationWarning, i18n: I18n): string {
  const message = i18n._(trackWarningMessages[warning.code]);
  const segmentNumber =
    warning.segmentIndex === undefined ? undefined : warning.segmentIndex + 1;
  const pointNumber =
    warning.pointIndex === undefined ? undefined : warning.pointIndex + 1;
  if (segmentNumber !== undefined && pointNumber !== undefined) {
    return i18n._(msg`${message} (segment ${segmentNumber}, point ${pointNumber})`);
  }
  if (segmentNumber !== undefined) {
    return i18n._(msg`${message} (segment ${segmentNumber})`);
  }
  if (pointNumber !== undefined) return i18n._(msg`${message} (point ${pointNumber})`);
  return message;
}

export function TrackDetailsPane({
  mode,
  onCollapse,
  onClosed,
}: TrackDetailsPaneProps) {
  const {
    active,
    activeProfile,
    activeStatsMetrics,
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
    trackWeatherPreferences,
    undoLastRoutePlanPoint,
    updateTrackWeatherPreferences,
  } = useTracksWorkspace();
  const { t, i18n } = useLingui();
  const trackMarkers =
    active?.kind === 'saved'
      ? active.content.markers
      : active?.kind === 'preview'
        ? active.markers
        : null;
  const { elevationProvider, trackShares, userData } = useRuntimeServices();
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
    const loadStatus = async () => {
      const status = await service.status(contentHash, controller.signal);
      if (!shareOperationIsCurrent(controller, generation)) return;
      setShareMenuState({
        contentHash,
        state: status.enabled
          ? { kind: 'enabled', token: status.token }
          : { kind: 'disabled' },
      });
    };
    await loadStatus()
      .catch(() => {
        if (!shareOperationIsCurrent(controller, generation)) return;
        setShareMenuState({ contentHash, state: { kind: 'error' } });
      })
      .finally(() => {
        if (shareOperationIsCurrent(controller, generation)) {
          shareRequest.current = null;
        }
      });
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
        setShareNotice({ contentHash, message: msg`Share link copied.` });
      } catch {
        if (generation !== shareOperationGeneration.current) return;
        setShareNotice({
          contentHash,
          message: msg`Sharing is enabled, but the link could not be copied.`,
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
    const applyShareUpdate = async () => {
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
      setShareNotice({ contentHash, message: msg`Sharing disabled.` });
    };
    await applyShareUpdate()
      .catch((error: unknown) => {
        if (!shareOperationIsCurrent(controller, generation)) return;
        setShareMenuState({ contentHash, state: previousState });
        setShareNotice({
          contentHash,
          message: shareMutationErrorMessage(error),
        });
      })
      .finally(() => {
        if (shareOperationIsCurrent(controller, generation)) {
          shareRequest.current = null;
        }
      });
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
        aria-label={t`Multiple track details`}
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
              aria-label={t`Collapse track details`}
              onClick={onCollapse}
            >
              <KeyboardArrowDownIcon fontSize="small" />
            </IconButton>
          ) : null}
          {mode === 'overlay' ? (
            <IconButton
              size="small"
              aria-label={t`Back to tracks`}
              onClick={onCollapse}
            >
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
              <Trans>Selected tracks</Trans>
            </Typography>
          </Box>
          <Tooltip title={t`Download selected tracks`}>
            <span>
              <IconButton
                size="small"
                aria-label={t`Download selected tracks`}
                disabled={!canDownloadMultiTrackSelections}
                onClick={() => {
                  if (!canDownloadMultiTrackSelections) return;
                  downloadFile(
                    /* eslint-disable lingui/no-unlocalized-strings -- Export filename and MIME type. */
                    'selected-tracks.zip',
                    'application/zip',
                    /* eslint-enable lingui/no-unlocalized-strings */
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
              aria-label={t`Close multi-track view`}
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
              <Box role="group" aria-label={t`Combined track details`}>
                <TrackStats metrics={multiTrackStatsMetrics} />
              </Box>
            )}
            {multiTrackSelections.map((selection) => (
              <Box
                component="section"
                aria-label={t`${selection.summary.name} track details`}
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
                      <Typography variant="body2">
                        <Trans>Loading track…</Trans>
                      </Typography>
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
                            <Trans>
                              No elevation profile is available for this track.
                            </Trans>
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
  const metrics = activeStatsMetrics;
  const calculatedMetrics =
    active.kind === 'route-plan'
      ? null
      : active.kind === 'saved'
        ? (active.summary.calculatedMetrics ?? null)
        : active.preparationStatus === 'ready' && active.sourceProfile !== null
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
  const warningCount = warnings.length;
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
      aria-label={t`Track details`}
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
            aria-label={t`Collapse track details`}
            onClick={onCollapse}
            sx={{ mr: 1 }}
          >
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        ) : null}
        {mode === 'overlay' ? (
          <IconButton
            size="small"
            aria-label={t`Back to tracks`}
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
              label={t`Track name`}
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
                  : t`New track`}
            </Typography>
          )}
        </Box>
        {active.kind === 'saved' && renaming ? (
          <Tooltip title={t`Confirm rename`}>
            <span>
              <IconButton
                size="small"
                aria-label={t`Confirm rename`}
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
                  <Trans>Confirm delete</Trans>
                </Button>
              ) : (
                <>
                  <Tooltip title={t`Download GPX`}>
                    <IconButton
                      size="small"
                      aria-label={t`Download GPX`}
                      onClick={() => {
                        downloadFile(
                          safeTrackFilename(active.summary.name, 'gpx'),
                          // eslint-disable-next-line lingui/no-unlocalized-strings -- MIME type.
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
                  <Tooltip title={t`Track actions`}>
                    <IconButton
                      size="small"
                      aria-label={t`Track actions`}
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
                    ? t`Remove from favorites`
                    : t`Add to favorites`}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    downloadFile(
                      safeTrackFilename(active.summary.name, 'kml'),
                      // eslint-disable-next-line lingui/no-unlocalized-strings -- MIME type.
                      'application/vnd.google-earth.kml+xml',
                      exportTrackAsKml(active.summary, active.content),
                    );
                    setActionMenuAnchor(null);
                  }}
                >
                  <DownloadOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                  <Trans>Download KML</Trans>
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
                        <Trans>Share</Trans>
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
                            aria-label={t`Loading sharing status`}
                            size={20}
                          />
                        ) : (
                          <Switch
                            checked={currentShareMenuState.kind === 'enabled'}
                            slotProps={{
                              input: {
                                'aria-label': t`Share track publicly`,
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
                        <Trans>Copy share link</Trans>
                      </MenuItem>
                    ) : null}
                    {currentShareMenuState.kind === 'error' ? (
                      <MenuItem
                        onClick={() => {
                          void loadShareStatus();
                        }}
                      >
                        <RefreshOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                        <Trans>Retry sharing status</Trans>
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
                  <Trans>Rename</Trans>
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
                  <Trans>Delete track</Trans>
                </MenuItem>
              </Menu>
            </Box>
          </ClickAwayListener>
        ) : null}
        <Snackbar
          autoHideDuration={6_000}
          message={shareNotice === null ? undefined : i18n._(shareNotice.message)}
          open={shareNotice !== null && shareNotice.contentHash === shareContentHash}
          onClose={() => {
            setShareNotice(null);
          }}
        />
        {mode !== 'overlay' ? (
          <IconButton
            size="small"
            aria-label={t`Close track`}
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
                label={t`Track name`}
                value={active.name}
                onChange={(event) => {
                  setActiveName(event.target.value);
                }}
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
              {active.preparationStatus === 'preparing' ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <CircularProgress
                    aria-label={t`Preparing terrain and elevation`}
                    size={18}
                  />
                  <Typography variant="body2">
                    <Trans>Preparing terrain and elevation…</Trans>
                  </Typography>
                </Stack>
              ) : active.preparationStatus === 'failed' ? (
                <Alert severity="warning">{i18n._(active.preparationError)}</Alert>
              ) : active.namingStatus === 'loading' ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <CircularProgress
                    aria-label={t`Looking up representative places`}
                    size={18}
                  />
                  <Typography variant="body2">
                    <Trans>Looking up representative places…</Trans>
                  </Typography>
                </Stack>
              ) : active.generatedName === undefined ? (
                active.lookupFailures === undefined ? (
                  <Typography variant="body2" color="text.secondary">
                    <Trans>No generated name is available. Saving is unaffected.</Trans>
                  </Typography>
                ) : (
                  <Alert severity="warning">
                    <Trans>No generated name is available. Saving is unaffected.</Trans>{' '}
                    {lookupFailureText(i18n, active.lookupFailures)}
                  </Alert>
                )
              ) : (
                <Stack spacing={2}>
                  <Button
                    size="small"
                    variant="text"
                    aria-label={t`Apply place name`}
                    onClick={applyGeneratedName}
                    sx={{ alignSelf: 'center' }}
                  >
                    <Trans>↑ Apply place name ↑</Trans>
                  </Button>
                  <TextField
                    size="small"
                    label={t`English place name`}
                    value={active.generatedName}
                    slotProps={{ input: { readOnly: true } }}
                  />
                  {active.lookupFailures === undefined ? null : (
                    <Alert severity="warning">
                      <Trans>The name may be incomplete.</Trans>{' '}
                      {lookupFailureText(i18n, active.lookupFailures)}
                    </Alert>
                  )}
                </Stack>
              )}
            </Stack>
          ) : null}
          {active.kind === 'preview' || active.kind === 'shared' ? (
            <>
              <Stack
                direction="row"
                spacing={1}
                data-tour="track-preview-actions"
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
                    <Trans>Shared track</Trans>
                  </Typography>
                ) : null}
                <Button size="small" color="inherit" onClick={discardPreview}>
                  <Trans>Discard</Trans>
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
                  {active.kind === 'shared' ? (
                    <Trans>Save a copy</Trans>
                  ) : (
                    <Trans>Save</Trans>
                  )}
                </Button>
              </Stack>
            </>
          ) : null}
          <Typography component="h3" variant="subtitle2">
            <Trans>Track details</Trans>
          </Typography>
          <Box sx={{ minHeight: 56, display: 'flex', alignItems: 'center' }}>
            {metrics === null ? (
              <Typography variant="body2" color="text.secondary">
                {active.kind === 'route-plan' ? (
                  <Trans>Add at least two route points to see track details.</Trans>
                ) : (
                  <Trans>Track details are being prepared…</Trans>
                )}
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
              elevationProvider={elevationProvider}
              markers={trackMarkers}
              onAdd={startTrackMarkerPlacement}
              onRename={renameTrackMarker}
              onDelete={deleteTrackMarker}
            />
          )}
          {active.kind === 'route-plan' ||
          activeProfile === null ||
          metrics === null ? null : (
            <TrackWeatherSection
              key={`weather:${active.kind === 'saved' ? active.summary.id : active.id}`}
              profile={activeProfile}
              metrics={metrics}
              preferences={trackWeatherPreferences}
              onPreferencesChange={updateTrackWeatherPreferences}
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
              <Trans>Independent segments are not joined; totals exclude gaps.</Trans>
            </Alert>
          ) : null}
          {warnings.length > 0 ? (
            <Alert severity="warning">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                <Plural
                  value={warningCount}
                  one="Imported with # validation warning"
                  other="Imported with # validation warnings"
                />
              </Typography>
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.25 }}>
                {warnings.map((warning, index) => (
                  <Typography
                    component="li"
                    key={`${warning.code}-${String(index)}`}
                    variant="caption"
                    sx={{ mb: 0.25 }}
                  >
                    <Box component="code" sx={{ fontSize: 'inherit' }}>
                      {warning.code}
                    </Box>{' '}
                    — {trackWarningDetail(warning, i18n)}
                  </Typography>
                ))}
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
