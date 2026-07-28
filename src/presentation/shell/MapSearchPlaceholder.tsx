import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Link,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';

import type {
  PlaceSearchKind,
  PlaceSearchResult,
} from '@/application/ports/PlaceSearchGateway';
import type { PlaceSearchProgress } from '@/application/map/SearchPlaces';
import {
  geodesicDistanceKm,
  maximumPlaceSearchRadiusKm,
  maximumPlaceSearchSideKm,
} from '@/application/map/expandPlaceSearchBounds';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { MapViewportBounds } from '@/presentation/map/mapTypes';
import {
  requestMapFitBounds,
  requestMapNavigation,
} from '@/presentation/map/mapInteractionStore';
import { parseCoordinateQuery } from '@/presentation/shell/parseCoordinateQuery';
import { formatPlaceSearchCategory } from '@/presentation/shell/formatPlaceSearchCategory';
import { useUiStore } from '@/presentation/shell/uiStore';
import { useOptionalTracksWorkspace } from '@/presentation/tracks/TracksWorkspace';

function preferredResultPriority(kind: PlaceSearchKind): number {
  switch (kind) {
    case 'settlement':
      return 0;
    case 'administrative-area':
      return 1;
    case 'mountain':
      return 2;
    case 'water':
      return 3;
    case 'other':
      return 4;
  }
}

function distanceFromSearchCenterKm(
  bounds: MapViewportBounds,
  coordinate: { readonly longitude: number; readonly latitude: number },
): number {
  return geodesicDistanceKm(
    (bounds.south + bounds.north) / 2,
    (bounds.west + bounds.east) / 2,
    coordinate.latitude,
    coordinate.longitude,
  );
}

function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) return `${String(Math.round(distanceKm * 1_000))} m away`;
  return `${String(Math.round(distanceKm))} km away`;
}

type SearchRequestState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'success'; readonly results: readonly PlaceSearchResult[] }
  | { readonly status: 'error'; readonly error: unknown };

export function MapSearchPlaceholder() {
  const { mapViewport, searchPlaces } = useRuntimeServices();
  const tracksWorkspace = useOptionalTracksWorkspace();
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const [value, setValue] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState<{
    readonly query: string;
    readonly bounds: MapViewportBounds;
  } | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState<PlaceSearchProgress | null>(
    null,
  );
  const [searchRequest, setSearchRequest] = useState<SearchRequestState>({
    status: 'idle',
  });
  const [showOtherResults, setShowOtherResults] = useState(false);
  const [localSubmittedQuery, setLocalSubmittedQuery] = useState('');
  const subscribeToViewport = useCallback(
    (listener: () => void) => mapViewport.subscribe(listener),
    [mapViewport],
  );
  const readViewport = useCallback(
    () => mapViewport.getViewportSnapshot(),
    [mapViewport],
  );
  const viewport = useSyncExternalStore(
    subscribeToViewport,
    readViewport,
    readViewport,
  );
  useEffect(() => {
    if (searchPlaces === null || submittedSearch === null) return;

    const controller = new AbortController();
    void searchPlaces
      .execute(
        submittedSearch.query,
        submittedSearch.bounds,
        controller.signal,
        (progress) => {
          if (!controller.signal.aborted) setSearchProgress(progress);
        },
      )
      .then((results) => {
        if (!controller.signal.aborted) {
          setSearchRequest({ status: 'success', results });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSearchRequest({ status: 'error', error });
      });

    return () => {
      controller.abort();
    };
  }, [searchPlaces, submittedSearch]);

  const isFetching = searchRequest.status === 'loading';
  const visibleResults =
    submittedSearch === null
      ? []
      : searchRequest.status === 'success'
        ? searchRequest.results
        : (searchProgress?.results ?? []);
  const preferredResults = visibleResults
    .filter((result) => result.kind !== 'other')
    .toSorted(
      (left, right) =>
        preferredResultPriority(left.kind) - preferredResultPriority(right.kind),
    );
  const otherResults = visibleResults.filter((result) => result.kind === 'other');
  const displayedResults = showOtherResults
    ? [...preferredResults, ...otherResults]
    : preferredResults;

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const coordinateResult = parseCoordinateQuery(value);
    setSubmittedSearch(null);
    setSearchRequest({ status: 'idle' });
    setSearchProgress(null);
    setShowOtherResults(false);
    if (coordinateResult.status === 'valid') {
      setValidationMessage(null);
      requestMapNavigation({ ...coordinateResult.coordinate, zoom: 13 });
      return;
    }
    if (coordinateResult.status === 'invalid') {
      setValidationMessage(coordinateResult.message);
      return;
    }
    const normalized = value.trim();
    setLocalSubmittedQuery(normalized);
    if (normalized.length < 2) {
      setValidationMessage('Enter at least two characters or a coordinate pair.');
      return;
    }
    if (viewport === null) {
      setValidationMessage(
        'Wait for the map viewport to become ready, then search again.',
      );
      return;
    }
    setValidationMessage(null);
    setSubmittedSearch({ query: normalized, bounds: viewport.bounds });
    if (searchPlaces !== null) setSearchRequest({ status: 'loading' });
  };

  const closeResults = () => {
    setSubmittedSearch(null);
    setSearchRequest({ status: 'idle' });
  };

  const clearSearch = () => {
    setValue('');
    setSubmittedSearch(null);
    setSearchRequest({ status: 'idle' });
    setValidationMessage(null);
    setSearchProgress(null);
    setShowOtherResults(false);
    setLocalSubmittedQuery('');
  };
  const localTrackResults =
    localSubmittedQuery.length < 2
      ? []
      : (tracksWorkspace?.summaries ?? [])
          .filter((summary) =>
            summary.normalizedName.includes(
              localSubmittedQuery.toLocaleLowerCase('en'),
            ),
          )
          .toSorted((left, right) => right.savedAt.localeCompare(left.savedAt, 'en'))
          .slice(0, 2);

  return (
    <Paper
      component="section"
      aria-label="Map search"
      elevation={4}
      sx={{
        position: 'absolute',
        top: 6,
        right: 47,
        zIndex: 3,
        width: 360,
        maxWidth: 'calc(100% - 144px)',
        borderRadius: 1.25,
        overflow: 'hidden',
      }}
    >
      <form autoComplete="off" onSubmit={submit}>
        <TextField
          fullWidth
          hiddenLabel
          size="small"
          value={value}
          placeholder="Search places or coordinates"
          onChange={(event) => {
            setValue(event.target.value);
          }}
          slotProps={{
            htmlInput: {
              'aria-label': 'Search places or coordinates',
              autoComplete: 'off',
              spellCheck: false,
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <IconButton
                    type="submit"
                    size="small"
                    aria-label="Search map"
                    disabled={isFetching}
                  >
                    <SearchIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
              endAdornment:
                value.length > 0 ? (
                  <InputAdornment position="end" sx={{ gap: 0.25 }}>
                    {isFetching ? (
                      <CircularProgress size={18} aria-label="Searching places" />
                    ) : null}
                    <IconButton
                      type="button"
                      size="small"
                      aria-label="Clear map search"
                      onClick={clearSearch}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': { height: 42, alignItems: 'center' },
            '& .MuiOutlinedInput-root.Mui-focused': {
              backgroundColor: 'rgba(33, 158, 188, 0.06)',
            },
            '& .MuiInputBase-input': { py: 0 },
            '& .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
              border: 0,
            },
          }}
        />
      </form>
      {validationMessage !== null ? (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          {validationMessage}
        </Alert>
      ) : null}
      {searchPlaces === null ? (
        <Alert severity="error" sx={{ borderRadius: 0 }}>
          Place search provider configuration is unavailable. Coordinate entry still
          works.
        </Alert>
      ) : null}
      {searchRequest.status === 'error' ? (
        <Alert severity="error" sx={{ borderRadius: 0 }}>
          {searchRequest.error instanceof Error
            ? searchRequest.error.message
            : 'Place search is unavailable. Try again.'}
        </Alert>
      ) : null}
      {submittedSearch !== null ? (
        <Box sx={{ height: 4 }}>
          {isFetching && searchProgress?.status === 'expanding' ? (
            <LinearProgress
              variant="determinate"
              value={Math.min(
                100,
                (searchProgress.largerSideKm / maximumPlaceSearchSideKm) * 100,
              )}
              aria-label="Expanding place search area"
              aria-valuetext={`${String(Math.round(searchProgress.largerSideKm / 2))} of ${String(maximumPlaceSearchRadiusKm)} kilometres`}
              sx={{ width: '100%', height: 4 }}
            />
          ) : null}
        </Box>
      ) : null}
      {searchRequest.status === 'success' && visibleResults.length === 0 ? (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          {searchProgress?.status === 'exhausted'
            ? `No matching places were found within approximately ${String(Math.round(searchProgress.largerSideKm))} km.`
            : 'No matching places were found.'}
        </Alert>
      ) : null}
      {searchRequest.status === 'success' &&
      visibleResults.length > 0 &&
      preferredResults.length === 0 &&
      !showOtherResults ? (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          No geographic matches found.
        </Alert>
      ) : null}
      {displayedResults.length > 0 && submittedSearch !== null ? (
        <List
          dense
          aria-label="Place search results"
          sx={{ py: 0, maxHeight: 320, overflowY: 'auto' }}
        >
          {displayedResults.map((result) => (
            <ListItemButton
              key={result.id}
              onClick={() => {
                if (result.bounds === null) {
                  requestMapNavigation({ ...result.coordinate, zoom: 13 });
                } else {
                  requestMapFitBounds(result.bounds, 13);
                }
                closeResults();
              }}
            >
              <ListItemText
                primary={result.label}
                secondary={`${formatPlaceSearchCategory(result.category)} · ${formatDistance(
                  distanceFromSearchCenterKm(submittedSearch.bounds, result.coordinate),
                )}`}
                slotProps={{ primary: { noWrap: true } }}
              />
            </ListItemButton>
          ))}
        </List>
      ) : null}
      {localTrackResults.length > 0 ? (
        <List dense aria-label="Local track search results" sx={{ py: 0 }}>
          {localTrackResults.map((summary) => (
            <ListItemButton
              key={summary.id}
              onClick={() => {
                setActiveTab('tracks');
                void tracksWorkspace?.selectSaved(summary);
              }}
            >
              <ListItemText primary={summary.name} secondary="Saved local track" />
            </ListItemButton>
          ))}
          <Button
            size="small"
            onClick={() => {
              tracksWorkspace?.setQuery(localSubmittedQuery);
              setActiveTab('tracks');
            }}
            sx={{ mx: 1, textTransform: 'none' }}
          >
            Search all saved tracks
          </Button>
        </List>
      ) : null}
      {otherResults.length > 0 ? (
        <Button
          size="small"
          onClick={() => {
            setShowOtherResults((current) => !current);
          }}
          sx={{ mx: 1, my: 0.25, textTransform: 'none' }}
        >
          {showOtherResults
            ? 'Hide other results'
            : `Show ${String(otherResults.length)} other result${otherResults.length === 1 ? '' : 's'}`}
        </Button>
      ) : null}
      {visibleResults.length > 0 ? (
        <Typography variant="caption" sx={{ display: 'block', px: 2, py: 1 }}>
          Search data ©{' '}
          <Link href="https://www.openstreetmap.org/copyright" target="_blank">
            OpenStreetMap contributors
          </Link>
        </Typography>
      ) : null}
    </Paper>
  );
}
