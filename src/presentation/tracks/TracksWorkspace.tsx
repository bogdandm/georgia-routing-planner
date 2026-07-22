import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Paper,
  Stack,
  TextField,
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
  type ReactNode,
} from 'react';

import type { PlaceSearchResult } from '@/application/ports/PlaceSearchGateway';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { parseGpx, type ParsedGpx, type TrackPoint } from '@/domain/tracks/gpx';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
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
import { requestMapFitBounds } from '@/presentation/map/mapInteractionStore';
import { appColors } from '@/presentation/theme/appColors';

interface PreviewTrack {
  readonly kind: 'preview';
  readonly id: string;
  readonly file: File;
  readonly parsed: ParsedGpx;
  readonly metrics: TrackMetrics;
  readonly name: string;
  readonly namingStatus: 'loading' | 'ready' | 'unavailable';
  readonly generatedName?: string;
  readonly middleAnchorKind?: 'distance-midpoint' | 'dominant-summit';
  readonly startPoi?: PoiCandidate;
  readonly middlePoi?: PoiCandidate;
  readonly endPoi?: PoiCandidate;
  readonly fallbackPoi?: PoiCandidate;
}

interface SavedTrackSelection {
  readonly kind: 'saved';
  readonly summary: LocalTrackSummary;
  readonly content: LocalTrackContent;
  readonly draftName: string;
}

type ActiveTrack = PreviewTrack | SavedTrackSelection;

interface TracksWorkspaceValue {
  readonly active: ActiveTrack | null;
  readonly error: string | null;
  readonly filteredSummaries: readonly LocalTrackSummary[];
  readonly importError: string | null;
  readonly importFiles: (files: FileList | readonly File[]) => Promise<void>;
  readonly query: string;
  readonly summaries: readonly LocalTrackSummary[];
  readonly applyGeneratedName: () => void;
  readonly closeActive: () => void;
  readonly deleteActive: () => Promise<void>;
  readonly discardPreview: () => void;
  readonly savePreview: () => Promise<void>;
  readonly selectSaved: (summary: LocalTrackSummary) => Promise<void>;
  readonly setActiveName: (name: string) => void;
  readonly setQuery: (query: string) => void;
  readonly renameActive: () => Promise<void>;
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

type PreviewTrackBuilder = { -readonly [Key in keyof PreviewTrack]: PreviewTrack[Key] };
type LocalTrackSummaryBuilder = {
  -readonly [Key in keyof LocalTrackSummary]: LocalTrackSummary[Key];
};

function useTracksWorkspace(): TracksWorkspaceValue {
  const value = use(TracksWorkspaceContext);
  if (value === null) throw new Error('Tracks workspace is unavailable.');
  return value;
}

function initialTrackName(file: File, parsed: ParsedGpx): string {
  const embeddedName = parsed.metadata.selectedName ?? parsed.metadata.name;
  if (embeddedName !== undefined && embeddedName.trim().length > 0) {
    return embeddedName.trim();
  }
  const filenameStem = file.name.replace(/\.gpx$/iu, '').trim();
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
  const { clock, database, idGenerator, logger, mapLayers, searchPlaces } =
    useRuntimeServices();
  const [summaries, setSummaries] = useState<readonly LocalTrackSummary[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<ActiveTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<ImportErrorNotice | null>(null);
  const namingAbort = useRef<AbortController | null>(null);
  const renderedTrackId = useRef<string | null>(null);

  const reloadSummaries = useCallback(async () => {
    try {
      setSummaries(await database.listLocalTracks());
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
    };
  }, [reloadSummaries]);

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
    const trackId = active.kind === 'preview' ? active.id : active.summary.id;
    if (renderedTrackId.current === trackId) return;
    const segments =
      active.kind === 'preview'
        ? active.parsed.segments.map((segment) =>
            segment.points.map((point) => point.coordinate),
          )
        : active.content.segments;
    const metrics = active.kind === 'preview' ? active.metrics : active.summary.metrics;
    const result = mapLayers?.setImportedTrackGeometry(segments);
    if (result?.status === 'failed') return;
    renderedTrackId.current = trackId;
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
      { top: 56, right: 56, bottom: 56, left: 840 },
    );
  }, [active, mapLayers]);

  const generateName = useCallback(
    async (preview: PreviewTrack, controller: AbortController) => {
      if (searchPlaces === null) {
        setActive((current) =>
          current?.kind === 'preview' && current.id === preview.id
            ? { ...current, namingStatus: 'unavailable' }
            : current,
        );
        return;
      }
      const segments = preview.parsed.segments;
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
            if (current?.kind !== 'preview' || current.id !== preview.id)
              return current;
            const updated: PreviewTrackBuilder = { ...current, namingStatus: 'ready' };
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
        const loop = isLoop(segments, preview.metrics.distanceMeters);
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
          if (current?.kind !== 'preview' || current.id !== preview.id) return current;
          const updated: PreviewTrackBuilder = {
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
          current?.kind === 'preview' && current.id === preview.id
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
        reportImportError('Choose exactly one GPX file.');
        return;
      }
      const file = selected[0];
      if (!file?.name.toLocaleLowerCase('en').endsWith('.gpx')) {
        reportImportError('Choose a file with the .gpx extension.');
        return;
      }
      if (
        active?.kind === 'preview' &&
        !window.confirm('Discard the current unsaved track and import another file?')
      ) {
        return;
      }
      namingAbort.current?.abort();
      setImportError(null);
      setError(null);
      try {
        const parsed = parseGpx(await file.text());
        const metrics = calculateTrackMetrics(parsed.segments);
        const preview: PreviewTrack = {
          kind: 'preview',
          id: `local:${idGenerator.generate()}`,
          file,
          parsed,
          metrics,
          name: initialTrackName(file, parsed),
          namingStatus: 'loading',
        };
        setActive(preview);
        const controller = new AbortController();
        namingAbort.current = controller;
        void generateName(preview, controller);
      } catch (importError) {
        logger.log({ level: 'warn', name: 'local-track.import.failed' });
        reportImportError(
          importError instanceof Error
            ? importError.message
            : 'The GPX file could not be imported.',
        );
      }
    },
    [active?.kind, generateName, idGenerator, logger],
  );

  const savePreview = useCallback(async () => {
    if (active?.kind !== 'preview') return;
    try {
      const normalizedName = normalizeLocalTrackName(active.name);
      const summary: LocalTrackSummaryBuilder = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        id: active.id,
        ...normalizedName,
        savedAt: clock.now().toISOString(),
        sourceFilename: active.file.name,
        geometryKind: active.parsed.geometryKind,
        pointCount: active.parsed.pointCount,
        segmentCount: active.parsed.segments.length,
        metrics: active.metrics,
        metadata: active.parsed.metadata,
        warnings: active.parsed.warnings,
      };
      if (active.generatedName !== undefined)
        summary.generatedName = active.generatedName;
      if (active.middleAnchorKind !== undefined) {
        summary.middleAnchorKind = active.middleAnchorKind;
      }
      if (active.startPoi !== undefined) summary.startPoi = active.startPoi;
      if (active.middlePoi !== undefined) summary.middlePoi = active.middlePoi;
      if (active.endPoi !== undefined) summary.endPoi = active.endPoi;
      if (active.fallbackPoi !== undefined) summary.fallbackPoi = active.fallbackPoi;
      const content: LocalTrackContent = {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        trackId: active.id,
        originalGpx: active.file,
        segments: active.parsed.segments.map((segment) =>
          segment.points.map((point) => point.coordinate),
        ),
      };
      await database.saveLocalTrack(summary, content);
      namingAbort.current?.abort();
      await reloadSummaries();
      setActive({ kind: 'saved', summary, content, draftName: summary.name });
      setError(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'The track could not be saved.',
      );
    }
  }, [active, clock, database, reloadSummaries]);

  const discardPreview = useCallback(() => {
    if (active?.kind !== 'preview') return;
    namingAbort.current?.abort();
    setActive(null);
    setError(null);
  }, [active?.kind]);

  const closeActive = useCallback(() => {
    if (active?.kind === 'preview' && !window.confirm('Discard this unsaved track?'))
      return;
    namingAbort.current?.abort();
    setActive(null);
  }, [active?.kind]);

  const selectSaved = useCallback(
    async (summary: LocalTrackSummary) => {
      if (
        active?.kind === 'preview' &&
        !window.confirm('Discard the current unsaved track and open the saved track?')
      ) {
        return;
      }
      namingAbort.current?.abort();
      try {
        const content = await database.loadLocalTrackContent(summary.id);
        setActive({ kind: 'saved', summary, content, draftName: summary.name });
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'The track could not be opened.',
        );
      }
    },
    [active?.kind, database],
  );

  const setActiveName = useCallback((name: string) => {
    setActive((current) => {
      if (current === null) return null;
      return current.kind === 'preview'
        ? { ...current, name }
        : { ...current, draftName: name };
    });
  }, []);

  const renameActive = useCallback(async () => {
    if (active?.kind !== 'saved') return;
    try {
      const summary = await database.renameLocalTrack(
        active.summary.id,
        active.draftName,
      );
      setActive({ ...active, summary, draftName: summary.name });
      await reloadSummaries();
      setError(null);
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : 'The track could not be renamed.',
      );
    }
  }, [active, database, reloadSummaries]);

  const deleteActive = useCallback(async () => {
    if (active?.kind !== 'saved') return;
    if (!window.confirm(`Delete “${active.summary.name}” from this browser?`)) return;
    await database.deleteLocalTrack(active.summary.id);
    setActive(null);
    await reloadSummaries();
  }, [active, database, reloadSummaries]);

  const applyGeneratedName = useCallback(() => {
    setActive((current) =>
      current?.kind === 'preview' && current.generatedName !== undefined
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

  const value = useMemo<TracksWorkspaceValue>(
    () => ({
      active,
      error,
      filteredSummaries,
      importError: importError?.message ?? null,
      importFiles,
      query,
      summaries,
      applyGeneratedName,
      closeActive,
      deleteActive,
      discardPreview,
      renameActive,
      savePreview,
      selectSaved,
      setActiveName,
      setQuery,
    }),
    [
      active,
      applyGeneratedName,
      closeActive,
      deleteActive,
      discardPreview,
      error,
      filteredSummaries,
      importError,
      importFiles,
      query,
      renameActive,
      savePreview,
      selectSaved,
      setActiveName,
      summaries,
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
        aria-label="Import GPX file"
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
          spacing={dragActive ? 0.75 : 1}
          sx={{
            minHeight: 48,
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            px: 1.25,
            py: dragActive ? 2 : 0.5,
            textAlign: 'center',
          }}
        >
          <UploadFileOutlinedIcon
            color="primary"
            sx={{ fontSize: dragActive ? 36 : 24 }}
          />
          <Typography variant="subtitle2" sx={{ flex: dragActive ? 0 : 1 }}>
            {dragActive ? 'Drop one GPX file to import' : 'Drop GPX here'}
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
            >
              Browse GPX file
            </Button>
          )}
        </Stack>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".gpx,application/gpx+xml"
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

function formatDistance(meters: number): string {
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.round((seconds % 3_600) / 60);
  return `${String(hours)}h ${String(minutes)}m`;
}

function formatElevation(meters: number): string {
  return `${Math.round(meters).toLocaleString('en')} m`;
}

function averageSpeedKilometersPerHour(metrics: TrackMetrics): number | undefined {
  const elapsedSeconds = metrics.elapsedSeconds;
  if (elapsedSeconds === undefined || elapsedSeconds <= 0) return undefined;
  return (metrics.distanceMeters / elapsedSeconds) * 3.6;
}

interface TrackStatProps {
  readonly emphasized?: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
}

function TrackStat({ emphasized = false, icon, label, value }: TrackStatProps) {
  return (
    <Stack
      component="span"
      direction="row"
      spacing={0.5}
      aria-label={`${label}: ${value}`}
      sx={{ minWidth: 0, alignItems: 'center' }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ display: 'inline-flex', color: 'text.secondary' }}
      >
        {icon}
      </Box>
      <Typography
        component="span"
        variant={emphasized ? 'body2' : 'caption'}
        noWrap
        sx={{ fontWeight: emphasized ? 600 : 400 }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

export function TracksPanel() {
  const { active, error, filteredSummaries, query, setQuery, selectSaved, summaries } =
    useTracksWorkspace();
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
        <Typography component="h2" variant="subtitle2">
          {filteredSummaries.length} saved{' '}
          {filteredSummaries.length === 1 ? 'track' : 'tracks'}
        </Typography>
        {filteredSummaries.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 2, bgcolor: appColors.surface.subtle }}>
            <Typography variant="body2" color="text.secondary">
              {summaries.length === 0
                ? 'Import a GPX file to preview it, then save it in this browser.'
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
              return (
                <Paper key={summary.id} variant="outlined" sx={{ overflow: 'hidden' }}>
                  <ListItemButton
                    selected={
                      active?.kind === 'saved' && active.summary.id === summary.id
                    }
                    onClick={() => void selectSaved(summary)}
                    sx={{ display: 'block', px: 1.5, py: 1.25 }}
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
                          value={formatDuration(elapsedSeconds)}
                        />
                      )}
                      <TrackStat
                        icon={<SwapHorizOutlinedIcon sx={{ fontSize: 16 }} />}
                        label="Distance"
                        value={formatDistance(summary.metrics.distanceMeters)}
                      />
                      {ascentMeters === undefined ? null : (
                        <TrackStat
                          icon={<NorthEastIcon sx={{ fontSize: 16 }} />}
                          label="Elevation gain"
                          value={formatElevation(ascentMeters)}
                        />
                      )}
                    </Stack>
                  </ListItemButton>
                </Paper>
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

interface TrackStatsProps {
  readonly metrics: TrackMetrics;
}

function TrackStats({ metrics }: TrackStatsProps) {
  const stats: TrackStatProps[] = [];
  const elapsedSeconds = metrics.elapsedSeconds;
  if (elapsedSeconds !== undefined) {
    stats.push({
      icon: <TimerOutlinedIcon sx={{ fontSize: 18 }} />,
      label: 'Recorded time',
      value: formatDuration(elapsedSeconds),
    });
  }
  stats.push({
    icon: <SwapHorizOutlinedIcon sx={{ fontSize: 18 }} />,
    label: 'Distance',
    value: formatDistance(metrics.distanceMeters),
  });
  const speedKilometersPerHour = averageSpeedKilometersPerHour(metrics);
  if (speedKilometersPerHour !== undefined) {
    stats.push({
      icon: <SpeedOutlinedIcon sx={{ fontSize: 18 }} />,
      label: 'Average speed',
      value: `${speedKilometersPerHour.toFixed(1)} km/h`,
    });
  }
  if (metrics.ascentMeters !== undefined) {
    stats.push({
      icon: <NorthEastIcon sx={{ fontSize: 18 }} />,
      label: 'Elevation gain',
      value: formatElevation(metrics.ascentMeters),
    });
  }
  if (metrics.descentMeters !== undefined) {
    stats.push({
      icon: <SouthEastIcon sx={{ fontSize: 18 }} />,
      label: 'Elevation loss',
      value: formatElevation(metrics.descentMeters),
    });
  }
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        columnGap: 1.5,
        rowGap: 1.5,
      }}
    >
      {stats.map((stat) => (
        <TrackStat key={stat.label} {...stat} emphasized />
      ))}
    </Box>
  );
}

interface TrackMetadataProps {
  readonly pointCount: number;
  readonly savedAt: string | undefined;
  readonly segmentCount: number;
  readonly sourceFilename: string;
}

function TrackMetadata({
  pointCount,
  savedAt,
  segmentCount,
  sourceFilename,
}: TrackMetadataProps) {
  const pointLabel = `${pointCount.toLocaleString('en')} ${pointCount === 1 ? 'point' : 'points'}`;
  const segmentLabel = `${segmentCount.toLocaleString('en')} ${segmentCount === 1 ? 'segment' : 'segments'}`;
  return (
    <Stack spacing={0.5} sx={{ px: 1 }}>
      <Typography variant="body2">{sourceFilename}</Typography>
      <Typography variant="caption" color="text.secondary">
        {pointLabel} · {segmentLabel}
      </Typography>
      {savedAt === undefined ? null : (
        <Typography variant="caption" color="text.secondary">
          Saved {new Date(savedAt).toLocaleString('en')}
        </Typography>
      )}
    </Stack>
  );
}

export function TrackDetailsPane() {
  const {
    active,
    applyGeneratedName,
    closeActive,
    deleteActive,
    discardPreview,
    renameActive,
    savePreview,
    setActiveName,
  } = useTracksWorkspace();
  if (active === null) return null;
  const metrics = active.kind === 'saved' ? active.summary.metrics : active.metrics;
  const pointCount =
    active.kind === 'saved' ? active.summary.pointCount : active.parsed.pointCount;
  const savedAt = active.kind === 'saved' ? active.summary.savedAt : undefined;
  const segmentCount =
    active.kind === 'saved'
      ? active.summary.segmentCount
      : active.parsed.segments.length;
  const sourceFilename =
    active.kind === 'saved' ? active.summary.sourceFilename : active.file.name;
  const warnings =
    active.kind === 'saved' ? active.summary.warnings : active.parsed.warnings;
  return (
    <Box
      component="aside"
      aria-label="Track details"
      sx={{
        width: { xs: 404, xl: 440 },
        height: '100%',
        minHeight: 0,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: 1,
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
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            component="h2"
            variant="subtitle1"
            noWrap
            sx={{ fontWeight: 700 }}
          >
            {active.kind === 'preview' ? 'New track' : 'Selected track'}
          </Typography>
        </Box>
        <IconButton size="small" aria-label="Close track" onClick={closeActive}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 2 }}>
        <Stack spacing={2}>
          <TextField
            size="small"
            label="Track name"
            value={active.kind === 'preview' ? active.name : active.draftName}
            onChange={(event) => {
              setActiveName(event.target.value);
            }}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          {active.kind === 'preview' ? (
            <>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button size="small" color="inherit" onClick={discardPreview}>
                  Discard
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => void savePreview()}
                >
                  Save
                </Button>
              </Stack>
              <Divider />
              <Typography component="h3" variant="subtitle2">
                English place name
              </Typography>
              {active.namingStatus === 'loading' ? (
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
                <Stack spacing={1}>
                  <TextField
                    size="small"
                    value={active.generatedName}
                    slotProps={{
                      htmlInput: { 'aria-label': 'Generated name' },
                      input: { readOnly: true },
                    }}
                  />
                  <Button size="small" variant="outlined" onClick={applyGeneratedName}>
                    Apply generated name
                  </Button>
                </Stack>
              )}
            </>
          ) : (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => void renameActive()}
              >
                Rename
              </Button>
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineOutlinedIcon />}
                onClick={() => void deleteActive()}
              >
                Delete
              </Button>
            </Stack>
          )}
          <Divider />
          <Typography component="h3" variant="subtitle2">
            Track details
          </Typography>
          <TrackStats metrics={metrics} />
          <TrackMetadata
            pointCount={pointCount}
            savedAt={savedAt}
            segmentCount={segmentCount}
            sourceFilename={sourceFilename}
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
export { useTracksWorkspace };
