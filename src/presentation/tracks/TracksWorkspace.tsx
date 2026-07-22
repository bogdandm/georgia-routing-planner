import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SearchIcon from '@mui/icons-material/Search';
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
  type PropsWithChildren,
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
  return {
    label: shortLabel,
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
        const anchors = loop
          ? [middlePoint.coordinate]
          : [
              segment.points[0]?.coordinate,
              middlePoint.coordinate,
              segment.points[segment.points.length - 1]?.coordinate,
            ].filter(
              (coordinate): coordinate is readonly [number, number] =>
                coordinate !== undefined,
            );
        const candidates: (PoiCandidate | undefined)[] = [];
        for (const coordinate of anchors) {
          const result = await searchPlaces.reverse(
            { longitude: coordinate[0], latitude: coordinate[1] },
            controller.signal,
          );
          candidates.push(toPoiCandidate(result, coordinate, lookedUpAt));
        }
        const [startPoi, middlePoi, endPoi] = loop
          ? [undefined, candidates[0], undefined]
          : candidates;
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
      const selected = Array.from(files);
      if (selected.length !== 1) {
        setError('Choose exactly one GPX file.');
        return;
      }
      const file = selected[0];
      if (!file?.name.toLocaleLowerCase('en').endsWith('.gpx')) {
        setError('Choose a file with the .gpx extension.');
        return;
      }
      if (
        active?.kind === 'preview' &&
        !window.confirm('Discard the current unsaved track and import another file?')
      ) {
        return;
      }
      namingAbort.current?.abort();
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
        setError(
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

export function TrackImportAction() {
  const { importFiles } = useTracksWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Tooltip title="Import one GPX file">
        <IconButton
          aria-label="Import GPX"
          size="small"
          onClick={() => inputRef.current?.click()}
        >
          <UploadFileOutlinedIcon />
        </IconButton>
      </Tooltip>
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
    </>
  );
}

function formatDistance(meters: number): string {
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return 'Unavailable';
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.round((seconds % 3_600) / 60);
  return `${String(hours)}h ${String(minutes)}m`;
}

export function TracksPanel() {
  const { active, error, filteredSummaries, query, setQuery, selectSaved, summaries } =
    useTracksWorkspace();
  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
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
        <List disablePadding aria-label="Saved tracks">
          {filteredSummaries.map((summary) => (
            <Paper
              key={summary.id}
              variant="outlined"
              sx={{ mb: 1, overflow: 'hidden' }}
            >
              <ListItemButton
                selected={active?.kind === 'saved' && active.summary.id === summary.id}
                onClick={() => void selectSaved(summary)}
                sx={{ display: 'block', px: 1.5, py: 1.25 }}
              >
                <Typography variant="subtitle2">{summary.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDistance(summary.metrics.distanceMeters)} ·{' '}
                  {formatDuration(summary.metrics.elapsedSeconds)}
                </Typography>
              </ListItemButton>
            </Paper>
          ))}
        </List>
      )}
      <Alert severity="info" icon={<SaveOutlinedIcon />}>
        Saved local tracks stay in this browser.
      </Alert>
    </Stack>
  );
}

function DetailsGrid({ summary }: { readonly summary: LocalTrackSummary }) {
  const rows = [
    ['Distance', formatDistance(summary.metrics.distanceMeters)],
    ['Recorded time', formatDuration(summary.metrics.elapsedSeconds)],
    ['Points', summary.pointCount.toLocaleString('en')],
    ['Segments', summary.segmentCount.toLocaleString('en')],
    [
      'Ascent',
      summary.metrics.ascentMeters === undefined
        ? 'Unavailable'
        : `${Math.round(summary.metrics.ascentMeters).toLocaleString('en')} m`,
    ],
    [
      'Descent',
      summary.metrics.descentMeters === undefined
        ? 'Unavailable'
        : `${Math.round(summary.metrics.descentMeters).toLocaleString('en')} m`,
    ],
    ['Saved', new Date(summary.savedAt).toLocaleString('en')],
  ] as const;
  return (
    <Box
      component="dl"
      sx={{ m: 0, display: 'grid', gridTemplateColumns: '120px 1fr', gap: 1 }}
    >
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
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
  const summary =
    active.kind === 'saved'
      ? active.summary
      : ({
          schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
          id: active.id,
          name: active.name,
          normalizedName: active.name.toLocaleLowerCase('en'),
          savedAt: new Date().toISOString(),
          sourceFilename: active.file.name,
          geometryKind: active.parsed.geometryKind,
          pointCount: active.parsed.pointCount,
          segmentCount: active.parsed.segments.length,
          metrics: active.metrics,
          metadata: active.parsed.metadata,
          warnings: active.parsed.warnings,
        } satisfies LocalTrackSummary);
  return (
    <Box
      component="aside"
      aria-label="Track details"
      sx={{
        width: { xs: 360, xl: 408 },
        flexShrink: 0,
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        overflowY: 'auto',
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
        <Typography component="h2" variant="h6" sx={{ flex: 1 }}>
          {active.kind === 'preview' ? 'New track' : 'Selected track'}
        </Typography>
        <IconButton aria-label="Close track" onClick={closeActive}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Stack spacing={2} sx={{ p: 2 }}>
        <TextField
          label="Track name"
          value={active.kind === 'preview' ? active.name : active.draftName}
          onChange={(event) => {
            setActiveName(event.target.value);
          }}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        {active.kind === 'preview' ? (
          <>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => void savePreview()}>
                Save
              </Button>
              <Button color="inherit" onClick={discardPreview}>
                Discard
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
                  Looking up up to three representative places…
                </Typography>
              </Stack>
            ) : active.generatedName === undefined ? (
              <Typography variant="body2" color="text.secondary">
                No generated name is available. Saving is unaffected.
              </Typography>
            ) : (
              <Stack spacing={1}>
                <TextField
                  label="Generated name"
                  value={active.generatedName}
                  slotProps={{ input: { readOnly: true } }}
                />
                <Button variant="outlined" onClick={applyGeneratedName}>
                  Apply generated name
                </Button>
              </Stack>
            )}
          </>
        ) : (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => void renameActive()}>
              Rename
            </Button>
            <Button
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
        <DetailsGrid summary={summary} />
        {summary.segmentCount > 1 ? (
          <Alert severity="info">
            Independent segments are not joined; totals exclude gaps.
          </Alert>
        ) : null}
        {summary.warnings.length > 0 ? (
          <Alert severity="warning">
            Imported with {summary.warnings.length} validation{' '}
            {summary.warnings.length === 1 ? 'warning' : 'warnings'}.
          </Alert>
        ) : null}
      </Stack>
    </Box>
  );
}

export function TrackDropOverlay() {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute',
        inset: 12,
        zIndex: 20,
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'rgba(2, 48, 71, 0.82)',
        border: `3px dashed ${appColors.brand.sky}`,
        borderRadius: 2,
        color: 'white',
        pointerEvents: 'none',
      }}
    >
      <Stack spacing={1} sx={{ alignItems: 'center' }}>
        <UploadFileOutlinedIcon sx={{ fontSize: 56 }} />
        <Typography variant="h5">Drop one GPX file to import</Typography>
      </Stack>
    </Box>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { useTracksWorkspace };
