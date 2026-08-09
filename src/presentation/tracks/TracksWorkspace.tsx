import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SearchIcon from '@mui/icons-material/Search';
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
  Stack,
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
  type DragEvent,
  type PropsWithChildren,
} from 'react';

import type { PlaceSearchResult } from '@/application/ports/PlaceSearchGateway';
import {
  prepareImportedTrack,
  type TrackElevationPreparationProgress,
} from '@/application/tracks/prepareImportedTrack';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { ParsedGpx, TrackPoint, TrackSegment } from '@/domain/tracks/gpx';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  localTrackSegments,
  normalizeLocalTrackName,
  type LocalTrackContent,
  type LocalTrackSummary,
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
import {
  formatTrackDuration,
  TrackStat,
  TrackStats,
} from '@/presentation/tracks/TrackSummary';
import { ClimbsDescentsSection } from '@/presentation/tracks/ClimbsDescentsSection';
import {
  formatTrackDistance,
  formatTrackElevation,
} from '@/presentation/tracks/trackFormatters';
import {
  requestMapFitBounds,
  requestMapNavigation,
} from '@/presentation/map/mapInteractionStore';
import { appColors } from '@/presentation/theme/appColors';
import { useUiStore } from '@/presentation/shell/uiStore';

interface PreviewTrackBase {
  readonly kind: 'preview';
  readonly id: string;
  readonly file: File;
  readonly parsed: ParsedGpx;
  readonly sourceFormat: TrackSourceFormat;
  readonly name: string;
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

type PreviewTrack = PreparingPreviewTrack | FailedPreviewTrack | PreparedPreviewTrack;

interface SavedTrackSelection {
  readonly kind: 'saved';
  readonly summary: LocalTrackSummary;
  readonly content: LocalTrackContent;
  readonly draftName: string;
}

type ActiveTrack = PreviewTrack | SavedTrackSelection;

interface TracksWorkspaceValue {
  readonly active: ActiveTrack | null;
  readonly activeProfile: ElevationProfile | null;
  readonly elevationProgress: TrackElevationPreparationProgress | null;
  readonly error: string | null;
  readonly filteredSummaries: readonly LocalTrackSummary[];
  readonly importError: string | null;
  readonly importFiles: (files: FileList | readonly File[]) => Promise<void>;
  readonly importState: 'idle' | 'preparing';
  readonly recalculationState: 'idle' | 'recalculating';
  readonly query: string;
  readonly summaries: readonly LocalTrackSummary[];
  readonly applyGeneratedName: () => void;
  readonly closeActive: () => Promise<boolean>;
  readonly deleteSaved: (summary: LocalTrackSummary) => Promise<void>;
  readonly discardPreview: () => void;
  readonly recalculateElevation: () => Promise<void>;
  readonly savePreview: () => Promise<void>;
  readonly selectSaved: (summary: LocalTrackSummary) => Promise<void>;
  readonly setActiveName: (name: string) => void;
  readonly setQuery: (query: string) => void;
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
    idGenerator,
    logger,
    userData,
    mapLayers,
    searchPlaces,
  } = useRuntimeServices();
  const [summaries, setSummaries] = useState<readonly LocalTrackSummary[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<ActiveTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<ImportErrorNotice | null>(null);
  const [importState, setImportState] = useState<'idle' | 'preparing'>('idle');
  const [recalculationState, setRecalculationState] = useState<
    'idle' | 'recalculating'
  >('idle');
  const [elevationProgress, setElevationProgress] =
    useState<TrackElevationPreparationProgress | null>(null);
  const namingAbort = useRef<AbortController | null>(null);
  const preparationAbort = useRef<AbortController | null>(null);
  const recalculationAbort = useRef<AbortController | null>(null);
  const synchronizedElevationAbort = useRef<AbortController | null>(null);
  const previewSaveInProgress = useRef(false);
  const importGeneration = useRef(0);
  const latestOpenedTrackId = useRef<string | null>(null);
  const latestOpenedTrackWrite = useRef<Promise<void>>(Promise.resolve());
  const renderedTrackId = useRef<string | null>(null);
  const initiallyRestoredTrackId = useRef<string | null>(null);
  const restorationAttempted = useRef(false);

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

  const prepareDownloadedTracks = useCallback(async () => {
    synchronizedElevationAbort.current?.abort();
    const controller = new AbortController();
    synchronizedElevationAbort.current = controller;
    try {
      const downloadedTracks = await database.listLocalTracks();
      for (const summary of downloadedTracks) {
        if (
          summary.calculatedMetrics?.elevationAlgorithmVersion === 4 ||
          summary.contentHash === undefined
        ) {
          continue;
        }
        const content = await database.loadLocalTrackContent(summary.id);
        const prepared = await prepareImportedTrack(
          content.trackPoints.map((points) => ({ points })),
          elevationProvider,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        await database.replaceCalculatedTrackElevation(
          summary.id,
          prepared.calculatedMetrics,
          prepared.calculatedSegments?.map((segment) => segment.points),
          { expectedContentHash: summary.contentHash },
        );
      }
      await reloadSummaries();
    } catch (error) {
      if (controller.signal.aborted) return;
      logger.log({
        level: 'warn',
        name: 'local-track.sync-elevation-preparation.failed',
        data: { reason: error instanceof Error ? error.name : 'unknown' },
      });
    } finally {
      if (synchronizedElevationAbort.current === controller) {
        synchronizedElevationAbort.current = null;
      }
    }
  }, [database, elevationProvider, logger, reloadSummaries]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void reloadSummaries();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      namingAbort.current?.abort();
      synchronizedElevationAbort.current?.abort();
      preparationAbort.current?.abort();
      recalculationAbort.current?.abort();
    };
  }, [reloadSummaries]);

  useEffect(
    () =>
      userData.subscribeTracksChanged(() => {
        void reloadSummaries();
        void prepareDownloadedTracks();
        if (active?.kind !== 'saved') return;
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
      }),
    [active, database, prepareDownloadedTracks, reloadSummaries, userData],
  );

  useEffect(() => {
    if (active?.kind !== 'preview') return undefined;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => {
      window.removeEventListener('beforeunload', preventUnload);
    };
  }, [active?.kind]);

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
    if (active === null) {
      renderedTrackId.current = null;
      mapLayers?.clearImportedTrackGeometry();
      return;
    }
    const trackId =
      active.kind === 'preview'
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
  }, [active, mapLayers]);

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
      if (
        active?.kind === 'preview' &&
        !window.confirm('Discard the current unsaved track and import another file?')
      ) {
        return;
      }
      initiallyRestoredTrackId.current = null;
      namingAbort.current?.abort();
      preparationAbort.current?.abort();
      recalculationAbort.current?.abort();
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
    [active?.kind, elevationProvider, generateName, idGenerator, logger],
  );

  const savePreview = useCallback(async () => {
    if (
      active?.kind !== 'preview' ||
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
      const normalizedName = normalizeLocalTrackName(active.name);
      const savedAt = clock.now().toISOString();
      const content: LocalTrackContent = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        trackId: active.id,
        trackPoints: active.sourceSegments.map((segment) => segment.points),
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
        id: active.id,
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
        current?.kind === 'preview' &&
        current.preparationStatus === 'ready' &&
        current.id === previewId &&
        generation === importGeneration.current
          ? { kind: 'saved', summary, content, draftName: summary.name }
          : current,
      );
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
    const activeId = active.kind === 'preview' ? active.id : active.summary.id;
    const generation = importGeneration.current;
    try {
      const sourceSegments =
        active.kind === 'preview'
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
          if (current?.kind !== 'preview' || current.id !== activeId) return current;
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
    if (active?.kind === 'preview' && !window.confirm('Discard this unsaved track?')) {
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
    setRecalculationState('idle');
    setElevationProgress(null);
    importGeneration.current += 1;
    setImportState('idle');
    namingAbort.current?.abort();
    setActive(null);
    setError(null);
    return true;
  }, [active?.kind, saveLatestOpenedTrackId]);

  const activeSavedTrackId = active?.kind === 'saved' ? active.summary.id : null;

  const selectSaved = useCallback(
    async (summary: LocalTrackSummary) => {
      if (
        active?.kind === 'preview' &&
        !window.confirm('Discard the current unsaved track and open the saved track?')
      ) {
        return;
      }
      initiallyRestoredTrackId.current = null;
      renderedTrackId.current = null;
      preparationAbort.current?.abort();
      recalculationAbort.current?.abort();
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
    [active?.kind, activeSavedTrackId, database, saveLatestOpenedTrackId],
  );

  const setActiveName = useCallback((name: string) => {
    setActive((current) => {
      if (current === null) return null;
      return current.kind === 'preview'
        ? { ...current, name }
        : { ...current, draftName: name };
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
    return normalizedQuery.length === 0
      ? summaries
      : summaries.filter((summary) => summary.normalizedName.includes(normalizedQuery));
  }, [query, summaries]);

  const activeProfile = useMemo(() => elevationProfileForActiveTrack(active), [active]);
  useEffect(
    () => () => {
      mapLayers?.setImportedTrackHighlight(null);
    },
    [mapLayers],
  );
  useEffect(() => {
    const highlightSegments =
      activeProfile === null
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
  }, [activeProfile, mapLayers]);

  const value = useMemo<TracksWorkspaceValue>(
    () => ({
      active,
      activeProfile,
      elevationProgress,
      error,
      filteredSummaries,
      importError: importError?.message ?? null,
      importState,
      importFiles,
      query,
      summaries,
      applyGeneratedName,
      closeActive,
      deleteSaved,
      discardPreview,
      recalculateElevation,
      recalculationState,
      renameActive,
      savePreview,
      selectSaved,
      setActiveName,
      setQuery,
      toggleFavorite,
    }),
    [
      active,
      activeProfile,
      applyGeneratedName,
      elevationProgress,
      closeActive,
      deleteSaved,
      discardPreview,
      error,
      filteredSummaries,
      importError,
      importFiles,
      importState,
      query,
      renameActive,
      recalculateElevation,
      recalculationState,
      savePreview,
      selectSaved,
      setActiveName,
      setQuery,
      summaries,
      toggleFavorite,
    ],
  );

  return <TracksWorkspaceContext value={value}>{children}</TracksWorkspaceContext>;
}

function TrackImportZone() {
  const { importError, importFiles } = useTracksWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLElement>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    const appRoot = document.querySelector('[data-testid="workspace-shell"]');
    if (!(appRoot instanceof HTMLElement)) return undefined;

    const containsTarget = (event: globalThis.DragEvent) =>
      event.relatedTarget instanceof Node && appRoot.contains(event.relatedTarget);
    const hasFiles = (event: globalThis.DragEvent) =>
      event.dataTransfer?.types.includes('Files') ?? false;
    const handleAppDragEnter = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) setDragActive(true);
    };
    const handleAppDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event) || event.dataTransfer === null) return;
      event.preventDefault();
      const target = event.target;
      const insideZone = target instanceof Node && zoneRef.current?.contains(target);
      event.dataTransfer.dropEffect = insideZone === true ? 'copy' : 'none';
    };
    const handleAppDragLeave = (event: globalThis.DragEvent) => {
      if (!hasFiles(event) || containsTarget(event)) return;
      setDragActive(false);
    };
    const handleAppDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragActive(false);
    };
    const handleAppDragEnd = () => {
      setDragActive(false);
    };

    appRoot.addEventListener('dragenter', handleAppDragEnter);
    appRoot.addEventListener('dragover', handleAppDragOver);
    appRoot.addEventListener('dragleave', handleAppDragLeave);
    appRoot.addEventListener('drop', handleAppDrop);
    appRoot.addEventListener('dragend', handleAppDragEnd);
    return () => {
      appRoot.removeEventListener('dragenter', handleAppDragEnter);
      appRoot.removeEventListener('dragover', handleAppDragOver);
      appRoot.removeEventListener('dragleave', handleAppDragLeave);
      appRoot.removeEventListener('drop', handleAppDrop);
      appRoot.removeEventListener('dragend', handleAppDragEnd);
    };
  }, []);

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    void importFiles(event.dataTransfer.files);
  };

  return (
    <Box
      sx={{
        position: 'relative',
        zIndex: dragActive ? 2 : 1,
        minHeight: importError === null ? 52 : 106,
      }}
    >
      <Paper
        ref={zoneRef}
        component="section"
        aria-label="Import track file"
        variant="outlined"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        sx={{
          position: dragActive ? 'absolute' : 'relative',
          inset: '0 0 auto',
          height: dragActive ? 138 : 'auto',
          minHeight: 52,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderStyle: 'dashed',
          borderWidth: 2,
          borderColor: dragActive ? 'primary.main' : 'divider',
          bgcolor: dragActive ? appColors.surface.selected : appColors.surface.subtle,
          boxShadow: dragActive ? '0 12px 28px rgba(2, 48, 71, 0.28)' : 0,
          borderRadius: 1.5,
          transition: (theme) =>
            theme.transitions.create([
              'height',
              'background-color',
              'border-color',
              'box-shadow',
            ]),
        }}
      >
        <Stack
          direction={dragActive ? 'column' : 'row'}
          spacing={dragActive ? 0.75 : 0.75}
          sx={{
            minHeight: 48,
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            px: dragActive ? 1.25 : { xs: 0.75, sm: 1.25 },
            py: dragActive ? 2 : 0.5,
            textAlign: 'center',
          }}
        >
          <UploadFileOutlinedIcon
            color="primary"
            sx={{ fontSize: dragActive ? 36 : 24 }}
          />
          <Typography
            variant="subtitle2"
            noWrap={!dragActive}
            sx={{
              flex: dragActive ? 0 : 1,
              fontSize: dragActive ? undefined : { xs: '0.6875rem', sm: '0.875rem' },
            }}
          >
            Drop GPX, FIT, or KML here
          </Typography>
          {dragActive ? (
            <Typography variant="caption" color="text.secondary">
              Release the file inside this zone
            </Typography>
          ) : (
            <Button
              size="small"
              variant="outlined"
              onClick={() => inputRef.current?.click()}
              sx={{ whiteSpace: 'nowrap', px: { xs: 1, sm: 1.25 } }}
            >
              Browse track file
            </Button>
          )}
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
        {dragActive || importError === null ? null : (
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
    </Box>
  );
}

export function TracksPanel() {
  const {
    active,
    error,
    filteredSummaries,
    query,
    setQuery,
    selectSaved,
    summaries,
    toggleFavorite,
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
              const selected =
                active?.kind === 'saved' && active.summary.id === summary.id;
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
                      onClick={() => void selectSaved(summary)}
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

function downloadText(filename: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
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

function elevationProfileForActiveTrack(
  active: ActiveTrack | null,
): ElevationProfile | null {
  if (active === null) return null;
  if (active.kind === 'preview') {
    return active.preparationStatus === 'ready'
      ? (active.sourceProfile ?? active.calculatedProfile)
      : null;
  }
  const sourceInputs = elevationProfileInputSegments(active.content.trackPoints);
  const sourceProfile =
    sourceInputs === null
      ? null
      : calculateElevationProfile(medianFilterElevationSamples(sourceInputs));
  if (sourceProfile !== null) return sourceProfile;
  const calculatedInputs =
    active.content.calculatedTrackPoints === undefined
      ? null
      : elevationProfileInputSegments(active.content.calculatedTrackPoints);
  return calculatedInputs === null ? null : calculateElevationProfile(calculatedInputs);
}

function TrackElevationAnalysis() {
  const {
    active,
    activeProfile: profile,
    elevationProgress,
    recalculateElevation,
    recalculationState,
  } = useTracksWorkspace();
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
    if (nextSegmentIndex === null || profile === null) {
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
    if (nextSegmentIndex === null || profile === null) {
      setSelectedSegment(null);
      return;
    }
    setSelectedSegment((current) =>
      current?.profile === profile && current.index === nextSegmentIndex
        ? current
        : { profile, index: nextSegmentIndex },
    );
  };
  if (active === null) return null;
  return (
    <Stack spacing={1.5}>
      {(active.kind === 'preview' && active.preparationStatus === 'preparing') ||
      recalculationState === 'recalculating' ? (
        <ElevationPreparationChart progress={elevationProgress} />
      ) : profile === null ? null : (
        <ElevationProfileChart
          profile={profile}
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
      <ClimbsDescentsSection
        recalculating={
          recalculationState === 'recalculating' ||
          (active.kind === 'preview' && active.preparationStatus === 'preparing')
        }
        onRecalculate={() => void recalculateElevation()}
        segments={profile?.segments ?? []}
        activeSegmentIndex={activeSegmentIndex}
        selectedSegmentIndex={selectedSegmentIndex}
        onSegmentHoverChange={onSegmentHoverChange}
        onSegmentSelectionChange={onSegmentSelectionChange}
      />
    </Stack>
  );
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

interface TrackDetailsPaneProps {
  readonly mode: 'mobile' | 'overlay' | 'adjacent';
  readonly onCollapse: () => void;
  readonly onClosed: () => void;
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
    deleteSaved,
    discardPreview,
    renameActive,
    savePreview,
    recalculationState,
    setActiveName,
    toggleFavorite,
  } = useTracksWorkspace();
  const [actionMenuAnchor, setActionMenuAnchor] = useState<HTMLElement | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [confirmingDeleteTrackId, setConfirmingDeleteTrackId] = useState<string | null>(
    null,
  );
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  if (active === null) return null;
  const metrics =
    active.kind === 'saved'
      ? active.summary.metrics
      : active.preparationStatus === 'ready'
        ? active.sourceMetrics
        : null;
  const calculatedMetrics =
    active.kind === 'saved'
      ? (active.summary.calculatedMetrics ?? null)
      : active.preparationStatus === 'ready'
        ? active.calculatedMetrics
        : null;
  const pointCount =
    active.kind === 'saved'
      ? active.summary.pointCount
      : active.preparationStatus === 'ready'
        ? active.sourceSegments.reduce(
            (count, segment) => count + segment.points.length,
            0,
          )
        : active.parsed.pointCount;
  const savedAt = active.kind === 'saved' ? active.summary.savedAt : undefined;
  const segmentCount =
    active.kind === 'saved'
      ? active.summary.segmentCount
      : active.preparationStatus === 'ready'
        ? active.sourceSegments.length
        : active.parsed.segments.length;
  const sourceFilename =
    active.kind === 'saved' ? active.summary.sourceFilename : active.file.name;
  const sourceFormat =
    active.kind === 'saved' ? active.summary.sourceFormat : active.sourceFormat;
  const warnings =
    active.kind === 'saved' ? active.summary.warnings : active.parsed.warnings;
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
              {active.kind === 'preview' ? 'New track' : active.summary.name}
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
                <Tooltip title="Track actions">
                  <IconButton
                    size="small"
                    aria-label="Track actions"
                    onClick={(event) => {
                      setActionMenuAnchor(event.currentTarget);
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
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
                    downloadText(
                      safeTrackFilename(active.summary.name, 'gpx'),
                      'application/gpx+xml',
                      exportTrackAsGpx(active.summary, active.content),
                    );
                    setActionMenuAnchor(null);
                  }}
                >
                  <DownloadOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                  Download GPX
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    downloadText(
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
          {active.kind === 'preview' ? (
            <>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
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
                  Save
                </Button>
              </Stack>
            </>
          ) : null}
          <Typography component="h3" variant="subtitle2">
            Track details
          </Typography>
          {metrics === null ? null : <TrackStats metrics={metrics} />}
          <TrackElevationAnalysis
            key={`elevation:${active.kind === 'preview' ? active.id : active.summary.id}`}
          />
          <TrackMetadata
            calculatedMetrics={calculatedMetrics}
            pointCount={pointCount}
            savedAt={savedAt}
            segmentCount={segmentCount}
            sourceFilename={sourceFilename}
            sourceFormat={sourceFormat}
          />
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
