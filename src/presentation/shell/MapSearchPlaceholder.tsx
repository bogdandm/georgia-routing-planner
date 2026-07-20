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
import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';

import type { MapViewportBounds } from '@/application/ports/MapViewportProvider';
import type { PlaceSearchKind } from '@/application/ports/PlaceSearchGateway';
import type { PlaceSearchProgress } from '@/application/map/SearchPlaces';
import {
  geodesicDistanceKm,
  maximumPlaceSearchRadiusKm,
  maximumPlaceSearchSideKm,
} from '@/application/map/expandPlaceSearchBounds';
import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import {
  requestMapFitBounds,
  requestMapNavigation,
} from '@/presentation/map/mapInteractionStore';
import { parseCoordinateQuery } from '@/presentation/shell/parseCoordinateQuery';
import { formatPlaceSearchCategory } from '@/presentation/shell/formatPlaceSearchCategory';

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

export function MapSearchPlaceholder() {
  const { mapViewport, searchPlaces } = useRuntimeServices();
  const [value, setValue] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState<{
    readonly query: string;
    readonly bounds: MapViewportBounds;
  } | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState<PlaceSearchProgress | null>(
    null,
  );
  const [showOtherResults, setShowOtherResults] = useState(false);
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
  const search = useQuery({
    queryKey: [
      'place-search',
      submittedSearch?.query,
      submittedSearch?.bounds.west,
      submittedSearch?.bounds.south,
      submittedSearch?.bounds.east,
      submittedSearch?.bounds.north,
    ],
    queryFn: ({ signal }) => {
      if (searchPlaces === null || submittedSearch === null) return Promise.resolve([]);
      return searchPlaces.execute(
        submittedSearch.query,
        submittedSearch.bounds,
        signal,
        setSearchProgress,
      );
    },
    enabled: submittedSearch !== null && searchPlaces !== null,
  });
  const visibleResults =
    submittedSearch === null
      ? []
      : search.isSuccess
        ? search.data
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
    setSearchProgress(null);
    setShowOtherResults(false);
    if (coordinateResult.status === 'valid') {
      setSubmittedSearch(null);
      setValidationMessage(null);
      requestMapNavigation({ ...coordinateResult.coordinate, zoom: 13 });
      return;
    }
    if (coordinateResult.status === 'invalid') {
      setSubmittedSearch(null);
      setValidationMessage(coordinateResult.message);
      return;
    }
    const normalized = value.trim();
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
  };

  const closeResults = () => {
    setSubmittedSearch(null);
  };

  const clearSearch = () => {
    setValue('');
    setSubmittedSearch(null);
    setValidationMessage(null);
    setSearchProgress(null);
    setShowOtherResults(false);
  };

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
                    disabled={search.isFetching}
                  >
                    <SearchIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
              endAdornment:
                value.length > 0 ? (
                  <InputAdornment position="end" sx={{ gap: 0.25 }}>
                    {search.isFetching ? (
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
      {search.isError ? (
        <Alert severity="error" sx={{ borderRadius: 0 }}>
          {search.error instanceof Error
            ? search.error.message
            : 'Place search is unavailable. Try again.'}
        </Alert>
      ) : null}
      {submittedSearch !== null ? (
        <Box sx={{ height: 4 }}>
          {search.isFetching && searchProgress?.status === 'expanding' ? (
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
      {search.isSuccess && visibleResults.length === 0 ? (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          {searchProgress?.status === 'exhausted'
            ? `No matching places were found within approximately ${String(Math.round(searchProgress.largerSideKm))} km.`
            : 'No matching places were found.'}
        </Alert>
      ) : null}
      {search.isSuccess &&
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
