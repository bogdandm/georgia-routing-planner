import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
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
  useMemo,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';

import {
  PlaceSearchFailure,
  type PlaceSearchKind,
  type PlaceSearchResult,
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
  requestMapPointInspection,
} from '@/presentation/map/mapInteractionStore';
import { parseCoordinateQuery } from '@/presentation/shell/parseCoordinateQuery';
import { formatPlaceSearchCategory } from '@/presentation/shell/formatPlaceSearchCategory';
import { useUiStore } from '@/presentation/shell/uiStore';
import { useOptionalTracksWorkspace } from '@/presentation/tracks/TracksWorkspace';
const otherResultsMessage = msg({
  message:
    '{otherResultCount, plural, one {Show # other result} other {Show # other results}}',
});

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

type SearchRequestState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'success'; readonly results: readonly PlaceSearchResult[] }
  | { readonly status: 'error'; readonly error: unknown };

type SearchValidationCode =
  | 'out-of-bounds'
  | 'duplicate-axis'
  | 'non-finite'
  | 'minimum-query'
  | 'viewport-unavailable';

// These are MUI/HTML control tokens, not user-visible copy.
/* eslint-disable -- MUI and HTML control tokens, not user-visible copy. */
const autoCompleteOff = 'off';
const warningSeverity = 'warning' as const;
const errorSeverity = 'error' as const;
const infoSeverity = 'info' as const;
const minimumQueryValidation = 'minimum-query' as const;
const viewportUnavailableValidation = 'viewport-unavailable' as const;
/* eslint-enable */

export function MapSearchPlaceholder() {
  const { i18n, t } = useLingui();
  /* eslint-disable -- Intl option values are locale-independent formatting tokens. */
  const integerFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 0 }),
    [i18n.locale],
  );
  const meterFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.locale, {
        style: 'unit',
        unit: 'meter',
        unitDisplay: 'short',
        maximumFractionDigits: 0,
      }),
    [i18n.locale],
  );
  const kilometerFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.locale, {
        style: 'unit',
        unit: 'kilometer',
        unitDisplay: 'short',
        maximumFractionDigits: 0,
      }),
    [i18n.locale],
  );
  /* eslint-enable */
  const { mapViewport, searchPlaces } = useRuntimeServices();
  const tracksWorkspace = useOptionalTracksWorkspace();
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setMobileWorkspaceOpen = useUiStore((state) => state.setMobileWorkspaceOpen);
  const [value, setValue] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState<{
    readonly query: string;
    readonly bounds: MapViewportBounds;
  } | null>(null);
  const [validationCode, setValidationCode] = useState<SearchValidationCode | null>(
    null,
  );
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
  const otherResultCount = otherResults.length;
  const otherResultsToggleLabel = showOtherResults
    ? t`Hide other results`
    : i18n._({ ...otherResultsMessage, values: { otherResultCount } });
  const validationMessage =
    validationCode === null
      ? null
      : validationCode === 'out-of-bounds'
        ? t`Coordinates are outside valid map bounds.`
        : validationCode === 'duplicate-axis'
          ? t`Use one latitude and one longitude label.`
          : validationCode === 'non-finite'
            ? t`Enter two finite coordinate values.`
            : validationCode === 'minimum-query'
              ? t`Enter at least two characters or a coordinate pair.`
              : t`Wait for the map viewport to become ready, then search again.`;
  let searchFailureMessage: string | null = null;
  if (searchRequest.status === 'error') {
    if (searchRequest.error instanceof PlaceSearchFailure) {
      switch (searchRequest.error.code) {
        case 'rate-limited':
          searchFailureMessage = t`Place search is temporarily rate-limited. Try again shortly.`;
          break;
        case 'timeout':
          searchFailureMessage = t`Place search timed out. Try again.`;
          break;
        case 'network':
          searchFailureMessage = t`Place search could not contact the provider. Check the connection and try again.`;
          break;
        case 'invalid-response':
        case 'provider':
          searchFailureMessage = t`Place search is unavailable. Try again.`;
          break;
      }
    } else {
      searchFailureMessage = t`Place search is unavailable. Try again.`;
    }
  }

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const coordinateResult = parseCoordinateQuery(value);
    setSubmittedSearch(null);
    setSearchRequest({ status: 'idle' });
    setSearchProgress(null);
    setShowOtherResults(false);
    if (coordinateResult.status === 'valid') {
      setValidationCode(null);
      requestMapNavigation({ ...coordinateResult.coordinate, zoom: 13 });
      return;
    }
    if (coordinateResult.status === 'invalid') {
      setValidationCode(coordinateResult.code);
      return;
    }
    const normalized = value.trim();
    setLocalSubmittedQuery(normalized);
    if (normalized.length < 2) {
      setValidationCode(minimumQueryValidation);
      return;
    }
    if (viewport === null) {
      setValidationCode(viewportUnavailableValidation);
      return;
    }
    setValidationCode(null);
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
    setValidationCode(null);
    setSearchProgress(null);
    setShowOtherResults(false);
    setLocalSubmittedQuery('');
  };
  /* eslint-disable -- Search normalization and ordering are locale-independent. */
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
  /* eslint-enable */
  const expandedRadius =
    searchProgress?.status === 'expanding'
      ? integerFormatter.format(Math.round(searchProgress.largerSideKm / 2))
      : null;
  const maximumRadius = integerFormatter.format(maximumPlaceSearchRadiusKm);
  const exhaustedDistance =
    searchProgress?.status === 'exhausted'
      ? kilometerFormatter.format(Math.round(searchProgress.largerSideKm))
      : null;

  return (
    <Paper
      component="section"
      aria-label={t`Map search`}
      elevation={4}
      sx={{
        position: 'absolute',
        top: 6,
        right: 54,
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
          placeholder={t`Search places or coordinates`}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          slotProps={{
            htmlInput: {
              'aria-label': t`Search places or coordinates`,
              autoComplete: autoCompleteOff,
              spellCheck: false,
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <IconButton
                    type="submit"
                    size="small"
                    aria-label={t`Search map`}
                    disabled={isFetching}
                  >
                    <SearchIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </InputAdornment>
              ),
              endAdornment:
                value.length > 0 ? (
                  <InputAdornment position="end" sx={{ gap: 0.25 }}>
                    {isFetching ? (
                      <CircularProgress size={18} aria-label={t`Searching places`} />
                    ) : null}
                    <IconButton
                      type="button"
                      size="small"
                      aria-label={t`Clear map search`}
                      onClick={clearSearch}
                    >
                      <CloseIcon sx={{ fontSize: 20 }} />
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
        <Alert severity={warningSeverity} sx={{ borderRadius: 0 }}>
          {validationMessage}
        </Alert>
      ) : null}
      {searchPlaces === null ? (
        <Alert severity={errorSeverity} sx={{ borderRadius: 0 }}>
          <Trans>
            Place search provider configuration is unavailable. Coordinate entry still
            works.
          </Trans>
        </Alert>
      ) : null}
      {searchFailureMessage === null ? null : (
        <Alert severity={errorSeverity} sx={{ borderRadius: 0 }}>
          {searchFailureMessage}
        </Alert>
      )}
      {submittedSearch !== null ? (
        <Box sx={{ height: 4 }}>
          {isFetching && searchProgress?.status === 'expanding' ? (
            <LinearProgress
              variant="determinate"
              value={Math.min(
                100,
                (searchProgress.largerSideKm / maximumPlaceSearchSideKm) * 100,
              )}
              aria-label={t`Expanding place search area`}
              aria-valuetext={
                expandedRadius === null
                  ? undefined
                  : t`${expandedRadius} of ${maximumRadius} kilometres`
              }
              sx={{ width: '100%', height: 4 }}
            />
          ) : null}
        </Box>
      ) : null}
      {searchRequest.status === 'success' && visibleResults.length === 0 ? (
        <Alert severity={infoSeverity} sx={{ borderRadius: 0 }}>
          {exhaustedDistance === null
            ? t`No matching places were found.`
            : t`No matching places were found within approximately ${exhaustedDistance}.`}
        </Alert>
      ) : null}
      {searchRequest.status === 'success' &&
      visibleResults.length > 0 &&
      preferredResults.length === 0 &&
      !showOtherResults ? (
        <Alert severity={infoSeverity} sx={{ borderRadius: 0 }}>
          <Trans>No geographic matches found.</Trans>
        </Alert>
      ) : null}
      {displayedResults.length > 0 && submittedSearch !== null ? (
        <List
          dense
          aria-label={t`Place search results`}
          sx={{ py: 0, maxHeight: 320, overflowY: 'auto' }}
        >
          {displayedResults.map((result) => {
            const category = formatPlaceSearchCategory(result.category, i18n);
            const distanceKm = distanceFromSearchCenterKm(
              submittedSearch.bounds,
              result.coordinate,
            );
            const distance =
              distanceKm < 1
                ? meterFormatter.format(Math.round(distanceKm * 1_000))
                : kilometerFormatter.format(Math.round(distanceKm));
            return (
              <ListItemButton
                key={result.id}
                onClick={() => {
                  if (result.bounds === null) {
                    requestMapNavigation({ ...result.coordinate, zoom: 13 });
                  } else {
                    requestMapFitBounds(result.bounds, 13);
                  }
                  requestMapPointInspection(result.coordinate, {
                    refreshNearbyPoiOnIdle: true,
                  });
                  closeResults();
                }}
              >
                <ListItemText
                  primary={result.label}
                  secondary={t`${category} · ${distance}`}
                  slotProps={{ primary: { noWrap: true } }}
                />
              </ListItemButton>
            );
          })}
        </List>
      ) : null}
      {localTrackResults.length > 0 ? (
        <List dense aria-label={t`Local track search results`} sx={{ py: 0 }}>
          {localTrackResults.map((summary) => (
            <ListItemButton
              key={summary.id}
              onClick={() => {
                setActiveTab('tracks');
                setMobileWorkspaceOpen(true);
                void tracksWorkspace?.selectSaved(summary);
              }}
            >
              <ListItemText primary={summary.name} secondary={t`Saved local track`} />
            </ListItemButton>
          ))}
          <Button
            size="small"
            onClick={() => {
              tracksWorkspace?.setQuery(localSubmittedQuery);
              setActiveTab('tracks');
              setMobileWorkspaceOpen(true);
            }}
            sx={{ mx: 1, textTransform: 'none' }}
          >
            <Trans>Search all saved tracks</Trans>
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
          {otherResultsToggleLabel}
        </Button>
      ) : null}
      {visibleResults.length > 0 ? (
        <Typography variant="caption" sx={{ display: 'block', px: 2, py: 1 }}>
          <Trans>
            Search data ©{' '}
            <Link href="https://www.openstreetmap.org/copyright" target="_blank">
              OpenStreetMap contributors
            </Link>
          </Trans>
        </Typography>
      ) : null}
    </Paper>
  );
}
