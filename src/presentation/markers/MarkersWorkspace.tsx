import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import EditIcon from '@mui/icons-material/Edit';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PaletteIcon from '@mui/icons-material/Palette';
import SortIcon from '@mui/icons-material/Sort';
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  ClickAwayListener,
  IconButton,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
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
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { useStore } from 'zustand';

import { geodesicDistanceKm } from '@/application/map/expandPlaceSearchBounds';
import {
  defaultWeatherIntervalPreferences,
  selectMarkerWeatherForecast,
  type MarkerWeatherForecast,
  type MarkerWeatherForecastPeriod,
  type WeatherIntervalPreferences,
} from '@/application/weather/MarkerWeatherForecast';
import type { PointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import { PointWeatherForecastError } from '@/application/ports/WeatherForecastGateway';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  SAVED_MARKER_SCHEMA_VERSION,
  normalizeMarkerName,
  type MarkerSort,
  type NormalizedMarkerName,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  consumeMarkerCreationCommand,
  mapInteractionStore,
  requestMapNavigation,
  requestWeatherForecast,
} from '@/presentation/map/mapInteractionStore';
import type { MapCoordinate } from '@/presentation/map/mapTypes';
import {
  markerColorFor,
  markerColorOrder,
  markerIconFor,
} from '@/presentation/markers/markerCatalog';
import { PinheadIcon } from '@/presentation/markers/PinheadIcon';
import { MarkerWeatherSettingsDialog } from '@/presentation/markers/MarkerWeatherSettingsDialog';
import {
  MarkerEditorDialog,
  type MarkerAppearance,
} from '@/presentation/markers/MarkerEditorDialog';
import { useUiStore } from '@/presentation/shell/uiStore';
import { workspaceHashForTab } from '@/presentation/shell/workspaceTabLocation';
import { FloatingHourlyForecastPanel } from '@/presentation/weather/HourlyForecastTable';
import { MonochromeWeatherPeriodIcon } from '@/presentation/weather/WeatherConditionIcon';
import {
  formatWeatherMillimetres,
  formatWeatherTemperatureRange,
} from '@/presentation/weather/weatherFormatters';

type MarkerLoadState = 'loading' | 'ready' | 'failed';

type MarkerEditorDraft =
  | {
      readonly mode: 'create';
      readonly coordinate: MapCoordinate;
      readonly initialName: string;
    }
  | { readonly mode: 'appearance'; readonly marker: SavedMarker };

export type MarkerWeatherForecastState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly forecast: PointWeatherForecast;
      readonly selection: MarkerWeatherForecast;
    }
  | {
      readonly status: 'error';
      readonly code: PointWeatherForecastError['code'];
    };

interface MarkerHourlyForecastRequest {
  readonly markerId: string;
  readonly anchorElement: HTMLElement;
  readonly triggerElement: HTMLElement;
  readonly startTime: string;
  readonly title: string;
}

const markerWeatherRequestConcurrency = 4;
const markerWeatherCellWidth = 80;
const markerWeatherCellHeight = 92;
const markerWeatherPhoneCellWidth = 72;

interface MarkersWorkspaceValue {
  readonly markers: readonly SavedMarker[];
  readonly sortedMarkers: readonly SavedMarker[];
  readonly loadState: MarkerLoadState;
  readonly loadError: string | null;
  readonly notice: string | null;
  readonly mapCenter: MapCoordinate | null;
  readonly retryLoad: () => Promise<void>;
  readonly openAppearanceEditor: (marker: SavedMarker) => void;
  readonly renameMarker: (marker: SavedMarker, name: string) => Promise<void>;
  readonly deleteMarker: (marker: SavedMarker) => Promise<void>;
  readonly weatherPreferences: WeatherIntervalPreferences;
  readonly weatherPreferencesReady: boolean;
  readonly weatherByMarkerId: ReadonlyMap<string, MarkerWeatherForecastState>;
  readonly openWeatherSettings: () => void;
  readonly openWeatherPreview: (
    markerId: string,
    date: string,
    triggerElement: HTMLElement,
  ) => void;
}

const MarkersWorkspaceContext = createContext<MarkersWorkspaceValue | null>(null);

function sortMarkers(
  markers: readonly SavedMarker[],
  sort: MarkerSort,
  mapCenter: MapCoordinate | null,
): readonly SavedMarker[] {
  if (sort === 'created' || (sort === 'distance' && mapCenter === null)) {
    return [...markers].sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt, 'en');
      return byCreatedAt === 0 ? left.id.localeCompare(right.id, 'en') : byCreatedAt;
    });
  }
  if (sort === 'name') {
    return [...markers].sort((left, right) => {
      const byName = left.normalizedName.localeCompare(right.normalizedName, 'en');
      if (byName !== 0) return byName;
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt, 'en');
      return byCreatedAt === 0 ? left.id.localeCompare(right.id, 'en') : byCreatedAt;
    });
  }
  if (sort === 'color') {
    return [...markers].sort((left, right) => {
      const byColor =
        markerColorOrder[left.colorKey] - markerColorOrder[right.colorKey];
      if (byColor !== 0) return byColor;
      const byName = left.normalizedName.localeCompare(right.normalizedName, 'en');
      return byName === 0 ? left.id.localeCompare(right.id, 'en') : byName;
    });
  }
  if (mapCenter === null) return [...markers];
  return [...markers].sort((left, right) => {
    const leftDistance = geodesicDistanceKm(
      mapCenter.latitude,
      mapCenter.longitude,
      left.coordinate[1],
      left.coordinate[0],
    );
    const rightDistance = geodesicDistanceKm(
      mapCenter.latitude,
      mapCenter.longitude,
      right.coordinate[1],
      right.coordinate[0],
    );
    const byDistance = leftDistance - rightDistance;
    if (byDistance !== 0) return byDistance;
    const byName = left.normalizedName.localeCompare(right.normalizedName, 'en');
    return byName === 0 ? left.id.localeCompare(right.id, 'en') : byName;
  });
}

const markerWeatherWeekdayLabels = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;
const markerWeatherMonthLabels = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function markerWeatherDateParts(date: string): {
  readonly dateLabel: string;
  readonly weekday: string;
} {
  const value = new Date(`${date}T00:00:00.000Z`);
  const weekday = markerWeatherWeekdayLabels[value.getUTCDay()] ?? '';
  const month = markerWeatherMonthLabels[value.getUTCMonth()] ?? '';
  return { weekday, dateLabel: `${value.getUTCDate().toString()} ${month}` };
}

function markerWeatherPreviewStartTime(
  forecast: PointWeatherForecast,
  selected: MarkerWeatherForecastPeriod,
  preferences: WeatherIntervalPreferences,
): string {
  if (preferences.period.kind === 'day') return `${selected.date}T00:00`;
  if (preferences.period.kind === 'custom') {
    return `${selected.date}T${String(preferences.period.startHour).padStart(2, '0')}:00`;
  }
  let foundDaylight = false;
  const nightIndex = forecast.hourly.findIndex((hour) => {
    if (!hour.time.startsWith(`${selected.date}T`)) return false;
    if (hour.isDay) {
      foundDaylight = true;
      return false;
    }
    return foundDaylight;
  });
  const startHour = forecast.hourly[Math.max(0, nightIndex - 6)];
  if (nightIndex < 0 || startHour === undefined) {
    throw new RangeError(`Forecast period ${selected.date} has no hourly boundary.`);
  }
  return startHour.time;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalMarkersWorkspace(): MarkersWorkspaceValue | null {
  return use(MarkersWorkspaceContext);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMarkersWorkspace(): MarkersWorkspaceValue {
  const value = useOptionalMarkersWorkspace();
  if (value === null) throw new Error('Markers workspace is unavailable.');
  return value;
}

export function MarkersWorkspaceProvider({ children }: PropsWithChildren) {
  const {
    clock,
    database,
    idGenerator,
    logger,
    mapLayers,
    mapViewport,
    pointWeatherForecast,
    savedMarkers,
    userData,
  } = useRuntimeServices();
  const activeTab = useUiStore((state) => state.activeTab);
  const markerSort = useUiStore((state) => state.markerSort);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setMobileWorkspaceOpen = useUiStore((state) => state.setMobileWorkspaceOpen);
  const setNavigationCollapsed = useUiStore((state) => state.setNavigationCollapsed);
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
  const [markers, setMarkers] = useState<readonly SavedMarker[]>([]);
  const [loadState, setLoadState] = useState<MarkerLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<MarkerEditorDraft | null>(null);
  const [weatherPreferences, setWeatherPreferences] =
    useState<WeatherIntervalPreferences>(defaultWeatherIntervalPreferences);
  const [weatherPreferencesReady, setWeatherPreferencesReady] = useState(false);
  const [weatherLoadingEnabled, setWeatherLoadingEnabled] = useState(
    activeTab === 'markers',
  );
  const [weatherByMarkerId, setWeatherByMarkerId] = useState<
    ReadonlyMap<string, MarkerWeatherForecastState>
  >(new Map());
  const [weatherSettingsOpen, setWeatherSettingsOpen] = useState(false);
  const [weatherPreview, setWeatherPreview] =
    useState<MarkerHourlyForecastRequest | null>(null);
  const weatherCache = useRef(new Map<string, MarkerWeatherForecastState>());

  const loadMarkers = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const loaded = await savedMarkers.listSavedMarkers();
      setMarkers(loaded);
      setLoadState('ready');
    } catch {
      setLoadState('failed');
      setLoadError('Saved markers could not be loaded.');
    }
  }, [savedMarkers]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMarkers();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadMarkers]);

  useEffect(() => {
    let active = true;
    void database
      .loadWeatherIntervalPreferences()
      .then((preferences) => {
        if (active) setWeatherPreferences(preferences);
      })
      .catch(() => {
        logger.log({
          level: 'warn',
          name: 'storage.marker-weather-preferences.load-failed',
        });
      })
      .finally(() => {
        if (active) setWeatherPreferencesReady(true);
      });
    return () => {
      active = false;
    };
  }, [database, logger]);

  useEffect(() => {
    if (activeTab !== 'markers' || weatherLoadingEnabled) return undefined;
    const timer = window.setTimeout(() => {
      setWeatherLoadingEnabled(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeTab, weatherLoadingEnabled]);

  useEffect(() => {
    if (
      !weatherLoadingEnabled ||
      loadState !== 'ready' ||
      !weatherPreferencesReady ||
      weatherPreferences.weekdays.length === 0
    ) {
      return undefined;
    }

    const controller = new AbortController();
    const preferenceKey = JSON.stringify(weatherPreferences);
    const pending: {
      readonly marker: SavedMarker;
      readonly cacheKey: string;
    }[] = [];
    const initialStates = new Map<string, MarkerWeatherForecastState>();
    for (const marker of markers) {
      const cacheKey = [
        marker.id,
        marker.coordinate[0],
        marker.coordinate[1],
        marker.elevationMeters ?? 'unresolved',
        preferenceKey,
      ].join(':');
      const cached = weatherCache.current.get(cacheKey);
      if (cached === undefined) {
        initialStates.set(marker.id, { status: 'loading' });
        pending.push({ marker, cacheKey });
      } else {
        initialStates.set(marker.id, cached);
      }
    }

    let nextIndex = 0;
    const elevatedMarkers = new Map<string, SavedMarker>();
    const loadNext = async (): Promise<void> => {
      for (;;) {
        const entry = pending[nextIndex];
        nextIndex += 1;
        if (entry === undefined) return;
        const coordinate = {
          longitude: entry.marker.coordinate[0],
          latitude: entry.marker.coordinate[1],
        };
        try {
          const forecast = await pointWeatherForecast.execute(
            entry.marker.elevationMeters === null
              ? { coordinate }
              : { coordinate, elevationMeters: entry.marker.elevationMeters },
            controller.signal,
          );
          controller.signal.throwIfAborted();
          const selection = selectMarkerWeatherForecast(forecast, weatherPreferences);
          if (selection === null) return;
          const readyState: MarkerWeatherForecastState = {
            status: 'ready',
            forecast,
            selection,
          };
          weatherCache.current.set(entry.cacheKey, readyState);
          setWeatherByMarkerId((current) => {
            const next = new Map(current);
            next.set(entry.marker.id, readyState);
            return next;
          });

          if (entry.marker.elevationMeters === null) {
            try {
              const updated = await savedMarkers.saveSavedMarkerElevation(
                entry.marker.id,
                forecast.elevationMeters,
              );
              const elevatedCacheKey = [
                updated.id,
                updated.coordinate[0],
                updated.coordinate[1],
                updated.elevationMeters ?? 'unresolved',
                preferenceKey,
              ].join(':');
              weatherCache.current.set(elevatedCacheKey, readyState);
              elevatedMarkers.set(updated.id, updated);
            } catch {
              logger.log({
                level: 'warn',
                name: 'storage.saved-marker-elevation.save-failed',
              });
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          const failedState: MarkerWeatherForecastState = {
            status: 'error',
            code:
              error instanceof PointWeatherForecastError
                ? error.code
                : 'provider-unavailable',
          };
          setWeatherByMarkerId((current) => {
            const next = new Map(current);
            next.set(entry.marker.id, failedState);
            return next;
          });
        }
      }
    };
    const startTimer = window.setTimeout(() => {
      setWeatherByMarkerId(initialStates);
      const workerCount = Math.min(markerWeatherRequestConcurrency, pending.length);
      const workers = Array.from({ length: workerCount }, () => loadNext());
      void Promise.all(workers).then(() => {
        if (controller.signal.aborted || elevatedMarkers.size === 0) return;
        setMarkers((current) =>
          current.map((marker) => elevatedMarkers.get(marker.id) ?? marker),
        );
        for (const markerId of elevatedMarkers.keys()) {
          void userData.markerChanged(markerId);
        }
      });
    }, 0);
    return () => {
      window.clearTimeout(startTimer);
      controller.abort();
    };
  }, [
    weatherLoadingEnabled,
    loadState,
    logger,
    markers,
    pointWeatherForecast,
    savedMarkers,
    userData,
    weatherPreferences,
    weatherPreferencesReady,
  ]);

  useEffect(
    () => userData.subscribeMarkersChanged(() => void loadMarkers()),
    [loadMarkers, userData],
  );

  useEffect(() => {
    if (
      markerCreationCommand?.target.kind !== 'saved-marker' ||
      loadState !== 'ready'
    ) {
      return;
    }
    const command = markerCreationCommand;
    const timer = window.setTimeout(() => {
      consumeMarkerCreationCommand(command.id);
      setNotice(null);
      setEditorDraft({
        mode: 'create',
        coordinate: { ...command.coordinate },
        initialName: command.suggestedName ?? '',
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadState, markerCreationCommand]);

  useEffect(() => {
    if (loadState !== 'ready') return;
    const layerMarkers =
      activeTab === 'markers' && weatherPreferences.showOnMap
        ? markers.filter(
            (marker) => weatherByMarkerId.get(marker.id)?.status !== 'ready',
          )
        : markers;
    mapLayers?.setSavedMarkers(layerMarkers);
  }, [
    activeTab,
    loadState,
    mapLayers,
    markers,
    weatherByMarkerId,
    weatherPreferences.showOnMap,
  ]);

  useEffect(() => {
    return () => {
      mapLayers?.setSavedMarkers([]);
    };
  }, [mapLayers]);

  const createMarker = useCallback(
    async (name: NormalizedMarkerName, appearance: MarkerAppearance) => {
      const draft = editorDraft;
      if (draft?.mode !== 'create')
        throw new Error('The marker creation draft is unavailable.');
      const timestamp = clock.now().toISOString();
      const marker: SavedMarker = {
        schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
        id: idGenerator.generate(),
        name: name.name,
        normalizedName: name.normalizedName,
        coordinate: [draft.coordinate.longitude, draft.coordinate.latitude],
        elevationMeters: null,
        iconKey: appearance.iconKey,
        colorKey: appearance.colorKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await savedMarkers.saveSavedMarker(marker);
      setMarkers((current) => [...current, marker]);
      setEditorDraft(null);
      void userData.markerChanged(marker.id);
    },
    [clock, editorDraft, idGenerator, savedMarkers, userData],
  );

  const saveAppearance = useCallback(
    async (appearance: MarkerAppearance) => {
      const draft = editorDraft;
      if (draft?.mode !== 'appearance') {
        throw new Error('The marker appearance draft is unavailable.');
      }
      const updated = await savedMarkers.updateSavedMarker(draft.marker.id, {
        name: draft.marker.name,
        normalizedName: draft.marker.normalizedName,
        iconKey: appearance.iconKey,
        colorKey: appearance.colorKey,
        updatedAt: clock.now().toISOString(),
      });
      setMarkers((current) =>
        current.map((marker) => (marker.id === updated.id ? updated : marker)),
      );
      setEditorDraft(null);
      void userData.markerChanged(updated.id);
    },
    [clock, editorDraft, savedMarkers, userData],
  );

  const renameMarker = useCallback(
    async (marker: SavedMarker, name: string) => {
      const normalized = normalizeMarkerName(name);
      const updated = await savedMarkers.updateSavedMarker(marker.id, {
        name: normalized.name,
        normalizedName: normalized.normalizedName,
        iconKey: marker.iconKey,
        colorKey: marker.colorKey,
        updatedAt: clock.now().toISOString(),
      });
      setMarkers((current) =>
        current.map((currentMarker) =>
          currentMarker.id === updated.id ? updated : currentMarker,
        ),
      );
      void userData.markerChanged(updated.id);
    },
    [clock, savedMarkers, userData],
  );

  const deleteMarker = useCallback(
    async (marker: SavedMarker) => {
      await savedMarkers.deleteSavedMarker(marker.id);
      setMarkers((current) =>
        current.filter((currentMarker) => currentMarker.id !== marker.id),
      );
      void userData.markerDeleted(marker.id);
    },
    [savedMarkers, userData],
  );

  const saveWeatherPreferences = useCallback(
    async (preferences: WeatherIntervalPreferences) => {
      await database.saveWeatherIntervalPreferences(preferences);
      weatherCache.current.clear();
      const nextWeather = new Map<string, MarkerWeatherForecastState>();
      if (preferences.weekdays.length > 0) {
        for (const marker of markers) {
          nextWeather.set(marker.id, { status: 'loading' });
        }
      }
      setWeatherByMarkerId(nextWeather);
      setWeatherPreferences({
        ...preferences,
        weekdays: [...preferences.weekdays],
        period: { ...preferences.period },
      });
    },
    [database, markers],
  );

  const openWeatherPreview = useCallback(
    (markerId: string, date: string, triggerElement: HTMLElement) => {
      const weather = weatherByMarkerId.get(markerId);
      if (weather?.status !== 'ready') return;
      const selected = weather.selection.periods.find((period) => period.date === date);
      if (selected === undefined) return;
      const { dateLabel, weekday } = markerWeatherDateParts(selected.date);
      const periodLabel =
        weatherPreferences.period.kind === 'day'
          ? 'Day'
          : weatherPreferences.period.kind === 'night'
            ? 'Night'
            : 'Custom';
      setWeatherPreview({
        markerId,
        anchorElement:
          triggerElement.closest<HTMLElement>('[data-marker-weather-anchor]') ??
          triggerElement,
        triggerElement,
        startTime: markerWeatherPreviewStartTime(
          weather.forecast,
          selected,
          weatherPreferences,
        ),
        title: `24-hour forecast · ${periodLabel} · ${weekday}, ${dateLabel}`,
      });
    },
    [weatherByMarkerId, weatherPreferences],
  );

  const openMarkerInWeather = useCallback(
    (marker: SavedMarker) => {
      const weather = weatherByMarkerId.get(marker.id);
      const elevationMeters =
        marker.elevationMeters ??
        (weather?.status === 'ready' ? weather.forecast.elevationMeters : undefined);
      requestWeatherForecast(
        {
          longitude: marker.coordinate[0],
          latitude: marker.coordinate[1],
        },
        marker.name,
        elevationMeters,
      );
      setActiveTab('weather');
      setMobileWorkspaceOpen(true);
      setNavigationCollapsed(false);
      const nextUrl = new URL(window.location.href);
      nextUrl.hash = workspaceHashForTab('weather');
      window.history.pushState(window.history.state, '', nextUrl);
      setWeatherPreview(null);
    },
    [setActiveTab, setMobileWorkspaceOpen, setNavigationCollapsed, weatherByMarkerId],
  );

  const mapCenter = viewport?.center ?? null;
  const sortedMarkers = useMemo(
    () => sortMarkers(markers, markerSort, mapCenter),
    [mapCenter, markerSort, markers],
  );
  const weatherPreviewMarker =
    weatherPreview === null
      ? undefined
      : markers.find((marker) => marker.id === weatherPreview.markerId);
  const weatherPreviewState =
    weatherPreview === null
      ? undefined
      : weatherByMarkerId.get(weatherPreview.markerId);
  const value = useMemo<MarkersWorkspaceValue>(
    () => ({
      markers,
      sortedMarkers,
      loadState,
      loadError,
      notice,
      mapCenter,
      retryLoad: loadMarkers,
      openAppearanceEditor: (marker) => {
        setEditorDraft({ mode: 'appearance', marker });
      },
      renameMarker,
      deleteMarker,
      weatherPreferences,
      weatherPreferencesReady,
      weatherByMarkerId,
      openWeatherSettings: () => {
        setWeatherSettingsOpen(true);
      },
      openWeatherPreview,
    }),
    [
      deleteMarker,
      loadError,
      loadMarkers,
      loadState,
      markers,
      notice,
      openWeatherPreview,
      renameMarker,
      sortedMarkers,
      mapCenter,
      weatherByMarkerId,
      weatherPreferences,
      weatherPreferencesReady,
    ],
  );

  return (
    <MarkersWorkspaceContext value={value}>
      {children}
      {editorDraft?.mode === 'create' ? (
        <MarkerEditorDialog
          mode="create"
          initialName={editorDraft.initialName}
          open
          onCancel={() => {
            setEditorDraft(null);
          }}
          onSubmit={createMarker}
        />
      ) : null}
      {editorDraft?.mode === 'appearance' ? (
        <MarkerEditorDialog
          mode="appearance"
          marker={editorDraft.marker}
          open
          onCancel={() => {
            setEditorDraft(null);
          }}
          onSubmit={saveAppearance}
        />
      ) : null}
      {weatherSettingsOpen ? (
        <MarkerWeatherSettingsDialog
          open
          preferences={weatherPreferences}
          onClose={() => {
            setWeatherSettingsOpen(false);
          }}
          onSave={saveWeatherPreferences}
        />
      ) : null}
      {weatherPreview !== null &&
      weatherPreviewMarker !== undefined &&
      weatherPreviewState?.status === 'ready' ? (
        <FloatingHourlyForecastPanel
          key={`${weatherPreview.markerId}:${weatherPreview.startTime}`}
          anchorElement={weatherPreview.anchorElement}
          forecast={weatherPreviewState.forecast}
          startTime={weatherPreview.startTime}
          title={weatherPreview.title}
          triggerElement={weatherPreview.triggerElement}
          onClose={() => {
            setWeatherPreview(null);
          }}
          onOpenWeather={() => {
            openMarkerInWeather(weatherPreviewMarker);
          }}
        />
      ) : null}
    </MarkersWorkspaceContext>
  );
}

interface MarkerSortControlProps {
  readonly onMarkerSortChange: (sort: MarkerSort) => Promise<boolean>;
}

const markerSortLabels: Readonly<Record<MarkerSort, string>> = {
  created: 'Newest',
  name: 'Name',
  color: 'Icon color',
  distance: 'Distance from map center',
};

export function MarkerSortControl({ onMarkerSortChange }: MarkerSortControlProps) {
  const markerSort = useUiStore((state) => state.markerSort);
  const [sortSaveError, setSortSaveError] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);

  const chooseSort = async (sort: MarkerSort) => {
    setSortAnchor(null);
    const saved = await onMarkerSortChange(sort);
    setSortSaveError(!saved);
  };

  return (
    <>
      <Tooltip title={`Sort: ${markerSortLabels[markerSort]}`}>
        <IconButton
          size="small"
          aria-label={`Sort markers. Current: ${markerSortLabels[markerSort]}`}
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
        {(Object.keys(markerSortLabels) as MarkerSort[]).map((sort) => (
          <MenuItem
            key={sort}
            selected={sort === markerSort}
            onClick={() => {
              void chooseSort(sort);
            }}
          >
            {markerSortLabels[sort]}
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

const markerDistanceFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
});

function markerDistanceLabel(
  marker: SavedMarker,
  center: MapCoordinate | null,
): string {
  if (center === null) return 'Distance unavailable';
  const distanceKm = geodesicDistanceKm(
    center.latitude,
    center.longitude,
    marker.coordinate[1],
    marker.coordinate[0],
  );
  return `${markerDistanceFormatter.format(distanceKm)} km away`;
}

export function MarkerWeatherSummaryButton({
  map = false,
  markerName,
  onOpen,
  selected,
}: {
  readonly map?: boolean;
  readonly markerName: string;
  readonly onOpen: (triggerElement: HTMLElement) => void;
  readonly selected: MarkerWeatherForecastPeriod;
}) {
  const temperature = formatWeatherTemperatureRange(
    selected.period.temperatureMinCelsius,
    selected.period.temperatureMaxCelsius,
  );
  const precipitation = formatWeatherMillimetres(selected.period.precipitationMm);
  const { weekday } = markerWeatherDateParts(selected.date);
  return (
    <ButtonBase
      aria-label={`Open ${weekday} weather for ${markerName}: ${temperature}, ${precipitation} precipitation`}
      onClick={(event) => {
        onOpen(event.currentTarget);
      }}
      sx={{
        minWidth: map ? 56 : markerWeatherCellWidth,
        minHeight: map ? 62 : markerWeatherCellHeight,
        alignSelf: 'stretch',
        flexDirection: 'column',
        justifyContent: 'center',
        px: map ? 0.5 : 0.75,
        pt: map ? 0 : 0.25,
        pb: 0.25,
        borderLeft: 1,
        borderColor: 'divider',
        color: map ? 'grey.900' : 'text.primary',
        bgcolor: 'transparent',
        '&:hover': {
          bgcolor: map ? 'rgba(0, 0, 0, 0.04)' : 'action.hover',
        },
      }}
    >
      <MonochromeWeatherPeriodIcon
        icon={selected.period.status.primary.icon}
        visibility={selected.period.status.visibility}
        isDay={selected.isDay}
        size={map ? 34 : 48}
      />
      <Typography
        variant="body2"
        sx={{
          color: 'inherit',
          fontSize: map ? '0.65rem' : undefined,
          fontWeight: 700,
          lineHeight: map ? 1.1 : 1.2,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          '@media (width < 900px)': map
            ? undefined
            : { fontSize: '0.75rem', lineHeight: 1.1 },
        }}
      >
        {temperature}
      </Typography>
      <Stack
        direction="row"
        spacing={0.25}
        sx={{ my: 0.5, alignItems: 'center', color: 'info.dark' }}
      >
        <WaterDropOutlinedIcon
          aria-hidden="true"
          sx={{ fontSize: map ? 11 : 13, color: 'inherit' }}
        />
        <Typography
          variant="caption"
          sx={{
            color: 'inherit',
            fontSize: map ? '0.58rem' : undefined,
            fontWeight: 600,
            lineHeight: map ? 1.1 : 1.2,
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
            '@media (width < 900px)': map
              ? undefined
              : { fontSize: '0.65rem', lineHeight: 1.1 },
          }}
        >
          {precipitation}
        </Typography>
      </Stack>
    </ButtonBase>
  );
}

interface MarkersPanelProps {
  readonly onMarkerSelected?: () => void;
}

export function MarkersPanel({ onMarkerSelected }: MarkersPanelProps) {
  const {
    deleteMarker,
    loadError,
    loadState,
    mapCenter,
    notice,
    openAppearanceEditor,
    openWeatherPreview,
    renameMarker,
    retryLoad,
    sortedMarkers,
    weatherByMarkerId,
    weatherPreferences,
  } = useMarkersWorkspace();
  const [actionAnchor, setActionAnchor] = useState<HTMLElement | null>(null);
  const [actionMarker, setActionMarker] = useState<SavedMarker | null>(null);
  const [renameTarget, setRenameTarget] = useState<SavedMarker | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const [markerHoverSuppressed, setMarkerHoverSuppressed] = useState(false);
  const weatherColumnPeriods = useMemo(() => {
    for (const marker of sortedMarkers) {
      const weather = weatherByMarkerId.get(marker.id);
      if (weather?.status === 'ready') return weather.selection.periods;
    }
    return null;
  }, [sortedMarkers, weatherByMarkerId]);

  const startRename = (marker: SavedMarker) => {
    setActionAnchor(null);
    setActionMarker(null);
    setRenameTarget(marker);
    setRenameValue(marker.name);
    setRenameError(null);
  };

  const saveRename = async () => {
    const target = renameTarget;
    if (target === null) return;
    try {
      await renameMarker(target, renameValue);
      setRenameTarget(null);
      setRenameError(null);
    } catch (error) {
      setRenameError(
        error instanceof Error ? error.message : 'The marker could not be renamed.',
      );
    }
  };

  const requestDelete = (marker: SavedMarker) => {
    if (pendingDeleteId !== marker.id) {
      setPendingDeleteId(marker.id);
      return;
    }
    setDeletingId(marker.id);
    setDeleteError(null);
    setActionAnchor(null);
    setActionMarker(null);
    void deleteMarker(marker)
      .catch((error: unknown) => {
        setDeleteError(
          error instanceof Error ? error.message : 'The marker could not be deleted.',
        );
      })
      .finally(() => {
        setDeletingId(null);
        setPendingDeleteId(null);
      });
  };

  return (
    <Stack
      spacing={1.5}
      sx={{
        px: 2,
        pt: 0.5,
        pb: 2,
        '@media (width < 900px)': { px: 1, pb: 1 },
      }}
    >
      {loadState === 'loading' ? (
        <Stack direction="row" spacing={1} role="status" sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography>Loading saved markers</Typography>
        </Stack>
      ) : null}
      {loadState === 'failed' ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void retryLoad()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      ) : null}
      {notice !== null ? <Alert severity="warning">{notice}</Alert> : null}
      {deleteError !== null ? <Alert severity="warning">{deleteError}</Alert> : null}
      {loadState === 'ready' && sortedMarkers.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
          <Typography variant="body2" color="text.secondary">
            No saved markers yet. Use New marker, then choose a point on the map.
          </Typography>
        </Paper>
      ) : null}
      {loadState === 'ready' && sortedMarkers.length > 0 ? (
        <List
          aria-label="Saved markers"
          disablePadding
          sx={{ display: 'grid', gap: 1.5, '@media (width < 900px)': { gap: 1 } }}
        >
          {weatherPreferences.weekdays.length === 0 ? null : (
            <Box
              component="li"
              role="group"
              aria-label="Marker forecast days"
              sx={{
                display: 'grid',
                gridTemplateColumns: `minmax(0, 1fr) repeat(${String(weatherPreferences.weekdays.length)}, ${String(markerWeatherCellWidth)}px)`,
                alignItems: 'center',
                listStyle: 'none',
                mb: -1.25,
                '@media (width < 900px)': {
                  gridTemplateColumns: `minmax(0, 1fr) repeat(${String(weatherPreferences.weekdays.length)}, ${String(markerWeatherPhoneCellWidth)}px)`,
                },
              }}
            >
              <Box aria-hidden />
              {weatherColumnPeriods === null
                ? weatherPreferences.weekdays.map((weekday) => (
                    <Typography
                      key={weekday}
                      variant="caption"
                      color="text.secondary"
                      sx={{ py: 0.5, px: 0, lineHeight: 1.1, textAlign: 'center' }}
                    >
                      {markerWeatherWeekdayLabels[weekday]}
                    </Typography>
                  ))
                : weatherColumnPeriods.map((period) => {
                    const { dateLabel, weekday } = markerWeatherDateParts(period.date);
                    return (
                      <Typography
                        key={period.date}
                        variant="caption"
                        color="text.secondary"
                        sx={{ py: 0.5, px: 0, lineHeight: 1.1, textAlign: 'center' }}
                      >
                        <Box
                          component="span"
                          sx={{ display: 'block', fontWeight: 700 }}
                        >
                          {weekday}
                        </Box>
                        <Box component="span" sx={{ display: 'block' }}>
                          {dateLabel}
                        </Box>
                      </Typography>
                    );
                  })}
            </Box>
          )}
          {sortedMarkers.map((marker) => {
            if (renameTarget?.id === marker.id) {
              return (
                <Paper
                  component="li"
                  key={marker.id}
                  variant="outlined"
                  sx={{ p: 1.5 }}
                >
                  <Stack spacing={1}>
                    <TextField
                      autoFocus
                      size="small"
                      label="Marker name"
                      value={renameValue}
                      onChange={(event) => {
                        setRenameValue(event.target.value);
                        setRenameError(null);
                      }}
                      error={renameError !== null}
                      helperText={renameError}
                      slotProps={{ htmlInput: { maxLength: 200 } }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveRename();
                        if (event.key === 'Escape') setRenameTarget(null);
                      }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button
                        onClick={() => void saveRename()}
                        variant="contained"
                        size="small"
                      >
                        Save
                      </Button>
                      <Button
                        onClick={() => {
                          setRenameTarget(null);
                        }}
                        size="small"
                      >
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              );
            }
            const icon = markerIconFor(marker.iconKey);
            const color = markerColorFor(marker.colorKey);
            const pending = pendingDeleteId === marker.id;
            const deleting = deletingId === marker.id;
            const hovered = hoveredMarkerId === marker.id;
            const weather = weatherByMarkerId.get(marker.id);
            const deleteActionClassName = `marker-row-action${
              pending ? ' marker-row-action--pending' : ''
            }`;
            return (
              <ClickAwayListener
                key={marker.id}
                onClickAway={() => {
                  if (deletingId !== marker.id && actionMarker?.id !== marker.id) {
                    setPendingDeleteId((current) =>
                      current === marker.id ? null : current,
                    );
                  }
                }}
              >
                <Paper
                  component="li"
                  variant="outlined"
                  className={hovered ? 'marker-row--hovered' : undefined}
                  onMouseEnter={() => {
                    if (!markerHoverSuppressed) setHoveredMarkerId(marker.id);
                  }}
                  onMouseMove={() => {
                    setMarkerHoverSuppressed(false);
                    setHoveredMarkerId(marker.id);
                  }}
                  onMouseLeave={() => {
                    setHoveredMarkerId((current) =>
                      current === marker.id ? null : current,
                    );
                    if (deletingId !== marker.id) {
                      setPendingDeleteId((current) =>
                        current === marker.id ? null : current,
                      );
                    }
                  }}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    alignItems: 'stretch',
                    position: 'relative',
                    bgcolor: hovered ? 'action.hover' : 'transparent',
                    '& .MuiListItemButton-root, & .MuiListItemButton-root:hover': {
                      bgcolor: 'transparent',
                    },
                    '& .marker-row-action': {
                      opacity: 0,
                      pointerEvents: 'none',
                      transition: 'opacity 150ms ease-out',
                    },
                    '& .marker-row-action--pending, &:focus-within .marker-row-action, &.marker-row--hovered .marker-row-action':
                      {
                        opacity: 1,
                        pointerEvents: 'auto',
                      },
                    '@media (width < 900px)': {
                      '& .marker-row-action': {
                        opacity: 1,
                        pointerEvents: 'auto',
                      },
                    },
                  }}
                >
                  <ListItemButton
                    onClick={() => {
                      requestMapNavigation({
                        longitude: marker.coordinate[0],
                        latitude: marker.coordinate[1],
                      });
                      onMarkerSelected?.();
                    }}
                    sx={{
                      minWidth: 0,
                      px: 1.5,
                      py: 1.25,
                      '@media (width < 900px)': { px: 1, py: 0.75 },
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={{ xs: 0.5, md: 1.25 }}
                      sx={{
                        alignItems: 'center',
                        minWidth: 0,
                      }}
                    >
                      <Box
                        aria-hidden
                        sx={{
                          width: 36,
                          height: 36,
                          flex: '0 0 36px',
                          display: 'grid',
                          placeItems: 'center',
                          '@media (width < 900px)': {
                            width: 32,
                            flexBasis: 32,
                            transform:
                              weatherPreferences.weekdays.length === 0
                                ? 'none'
                                : 'translateY(-4px)',
                          },
                        }}
                      >
                        <PinheadIcon svg={icon.svg} color={color.value} size={28} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" noWrap>
                          {marker.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {markerDistanceLabel(marker, mapCenter)}
                        </Typography>
                      </Box>
                    </Stack>
                  </ListItemButton>
                  {weatherPreferences.weekdays.length === 0 ? null : (
                    <Box
                      data-marker-weather-anchor
                      role={
                        weather === undefined || weather.status === 'loading'
                          ? 'status'
                          : undefined
                      }
                      aria-label={
                        weather === undefined || weather.status === 'loading'
                          ? `Loading weather for ${marker.name}`
                          : undefined
                      }
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${String(weatherPreferences.weekdays.length)}, ${String(markerWeatherCellWidth)}px)`,
                        alignSelf: 'stretch',
                        borderLeft: 1,
                        borderColor: 'divider',
                        '& > button:first-of-type': { borderLeft: 0 },
                        '@media (width < 900px)': {
                          minWidth: 0,
                          gridTemplateColumns: `repeat(${String(weatherPreferences.weekdays.length)}, ${String(markerWeatherPhoneCellWidth)}px)`,
                          '& > button': { minWidth: 0, width: '100%', px: 0.25 },
                        },
                      }}
                    >
                      {weather?.status === 'ready' ? (
                        weather.selection.periods.map((selected) => (
                          <MarkerWeatherSummaryButton
                            key={selected.date}
                            markerName={marker.name}
                            selected={selected}
                            onOpen={(triggerElement) => {
                              openWeatherPreview(
                                marker.id,
                                selected.date,
                                triggerElement,
                              );
                            }}
                          />
                        ))
                      ) : weather?.status === 'error' ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            gridColumn: '1 / -1',
                            minHeight: markerWeatherCellHeight,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            px: 1,
                          }}
                        >
                          Forecast unavailable
                        </Typography>
                      ) : (
                        weatherPreferences.weekdays.map((weekday, index) => (
                          <Stack
                            key={weekday}
                            spacing={0.75}
                            sx={{
                              minHeight: markerWeatherCellHeight,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderLeft: index === 0 ? 0 : 1,
                              borderColor: 'divider',
                            }}
                          >
                            <CircularProgress size={14} />
                            <Typography variant="caption" color="text.secondary">
                              Loading
                            </Typography>
                          </Stack>
                        ))
                      )}
                    </Box>
                  )}
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      right:
                        weatherPreferences.weekdays.length === 0
                          ? 4
                          : weatherPreferences.weekdays.length *
                              markerWeatherCellWidth +
                            4,
                      zIndex: 1,
                      alignItems: 'center',
                      px: 0.5,
                      transform: 'translateY(-50%)',
                      '@media (width < 900px)': {
                        ...(weatherPreferences.weekdays.length === 0
                          ? {
                              right: 4,
                              flexDirection: 'row',
                              gap: 0.5,
                              px: 0.25,
                            }
                          : {
                              top: 'auto',
                              right: 'auto',
                              bottom: 2,
                              left: 7,
                              flexDirection: 'row',
                              gap: 0,
                              px: 0,
                              transform: 'none',
                            }),
                      },
                    }}
                  >
                    <Tooltip
                      disableHoverListener={markerHoverSuppressed}
                      title="Marker actions"
                    >
                      <IconButton
                        className="marker-row-action"
                        size="small"
                        aria-label={`Marker actions for ${marker.name}`}
                        onClick={(event) => {
                          if (event.detail > 0) {
                            setMarkerHoverSuppressed(true);
                            setHoveredMarkerId(null);
                          }
                          setActionAnchor(event.currentTarget);
                          setActionMarker(marker);
                        }}
                      >
                        <MoreVertIcon
                          sx={{
                            '@media (width < 900px)': {
                              transform:
                                weatherPreferences.weekdays.length === 0
                                  ? 'none'
                                  : 'rotate(90deg)',
                            },
                          }}
                        />
                      </IconButton>
                    </Tooltip>
                    <Tooltip
                      disableHoverListener={markerHoverSuppressed}
                      title={pending ? 'Confirm deletion' : 'Delete marker'}
                    >
                      <IconButton
                        className={deleteActionClassName}
                        size="small"
                        aria-label={
                          pending
                            ? `Confirm deletion of ${marker.name}`
                            : `Delete ${marker.name}`
                        }
                        color={pending ? 'error' : 'default'}
                        disabled={deleting}
                        sx={{
                          '@media (width < 900px)': {
                            display:
                              weatherPreferences.weekdays.length === 0
                                ? 'inline-flex'
                                : 'none',
                          },
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && deletingId !== marker.id) {
                            setPendingDeleteId(null);
                            event.currentTarget.blur();
                          }
                        }}
                        onClick={() => {
                          requestDelete(marker);
                        }}
                      >
                        {pending ? (
                          <DeleteForeverOutlinedIcon fontSize="small" />
                        ) : (
                          <DeleteOutlineIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              </ClickAwayListener>
            );
          })}
        </List>
      ) : null}
      <Menu
        anchorEl={actionAnchor}
        open={actionMarker !== null}
        onClose={() => {
          if (actionMarker !== null && deletingId !== actionMarker.id) {
            setPendingDeleteId((current) =>
              current === actionMarker.id ? null : current,
            );
          }
          setActionAnchor(null);
          setActionMarker(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            if (actionMarker !== null) startRename(actionMarker);
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (actionMarker !== null) openAppearanceEditor(actionMarker);
            setActionAnchor(null);
            setActionMarker(null);
          }}
        >
          <PaletteIcon fontSize="small" sx={{ mr: 1 }} /> Change icon and color
        </MenuItem>
        <MenuItem
          disabled={actionMarker !== null && deletingId === actionMarker.id}
          sx={{
            display: 'none',
            '@media (width < 900px)': {
              display: weatherPreferences.weekdays.length === 0 ? 'none' : 'flex',
            },
            color:
              actionMarker !== null && pendingDeleteId === actionMarker.id
                ? 'error.main'
                : 'inherit',
          }}
          onClick={() => {
            if (actionMarker !== null) requestDelete(actionMarker);
          }}
        >
          {actionMarker !== null && pendingDeleteId === actionMarker.id ? (
            <DeleteForeverOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
          ) : (
            <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} />
          )}
          {actionMarker !== null && pendingDeleteId === actionMarker.id
            ? 'Confirm deletion'
            : 'Delete marker'}
        </MenuItem>
      </Menu>
    </Stack>
  );
}
