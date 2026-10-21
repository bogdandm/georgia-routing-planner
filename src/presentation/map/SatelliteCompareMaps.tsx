import { useLingui } from '@lingui/react/macro';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import {
  Alert,
  Box,
  ButtonBase,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import lookupTimeZone from '@photostructure/tz-lookup';
import {
  getMaxParallelImageRequests,
  setMaxParallelImageRequests,
  type ErrorEvent as MapLibreErrorEvent,
  type Map as MapLibreMap,
  type MapSourceDataEvent,
} from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import Map, { AttributionControl, type MapRef } from 'react-map-gl/maplibre';

import type { LogicalMapLayerId } from '@/application/ports/MapLayerPreferencesRepository';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  satelliteSceneBounds,
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';
import { createBasemapImage } from '@/presentation/map/basemapSymbols';
import { createTrackEndpointImage } from '@/presentation/map/trackEndpointIcons';
import {
  baseNativeLayerVisibility,
  isSentinelDirectFallbackError,
  openStreetMapOpacityPaint,
  type MapLibreLayerController,
} from '@/presentation/map/MapLibreLayerController';
import { mapSourceIds } from '@/presentation/map/mapIds';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { satelliteBasemapLabels } from '@/presentation/map/mapShareUrl';
import { createSatelliteCompareMapStyle } from '@/presentation/map/mapStyleFactory';
import type { MapCoordinate } from '@/presentation/map/mapTypes';
import { appColors } from '@/presentation/theme/appColors';
import { SatelliteCompareSync } from '@/presentation/map/SatelliteCompareSync';
import { ComparedSceneDatePicker } from '@/presentation/satellite-browser/SatelliteComparison';
import {
  comparisonBasemaps,
  isComparisonBasemap,
  maximumComparedScenes,
  setComparisonSlot,
  setComparisonTileProgress,
  swapComparisonSlots,
  type ComparisonBasemap,
  type ComparisonSlot,
} from '@/presentation/satellite-browser/satelliteCompareStore';

function basemapAttribution(
  configuration: MapProviderConfiguration,
  basemap: ComparisonBasemap,
): string {
  switch (basemap) {
    case 'google-satellite':
      return configuration.satelliteBasemap.attribution;
    case 'bing-satellite':
      return configuration.bingSatelliteBasemap.attribution;
    case 'esri-satellite':
      return configuration.esriSatelliteBasemap.attribution;
    case 'napr-orthophoto':
      return configuration.naprOrthophoto.attribution;
  }
}

/* eslint-disable lingui/no-unlocalized-strings -- Drag data type and SVG/CSS tokens. */
const slotDragType = 'application/x-trail-planner-comparison-slot';

const pointerCrosshairPath = 'M2 16H11M21 16H30M16 2V11M16 21V30';
/**
 * The real pointer is a large sky-blue crosshair with a center dot, so it stands out
 * from the small white crosshairs that mirror it in the other panes.
 */
const pointerCursor = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<path d="${pointerCrosshairPath}" fill="none" stroke="${appColors.brand.deepSpace}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="${pointerCrosshairPath}" fill="none" stroke="${appColors.brand.sky}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="16" cy="16" r="2.5" fill="${appColors.brand.sky}" stroke="${appColors.brand.deepSpace}" stroke-width="1.5"/>` +
    `</svg>`,
)}") 16 16, crosshair`;
/* eslint-enable lingui/no-unlocalized-strings */

export interface SatelliteCompareCamera {
  readonly center: MapCoordinate;
  readonly zoom: number;
}

export interface SatelliteCompareMapsProps {
  /** Two positions side by side, or four in 2×2; null is a plain map without imagery. */
  readonly slots: readonly ComparisonSlot[];
  /** Camera used when the grid mounts. */
  readonly initialCamera: SatelliteCompareCamera;
  /** Called after the shared camera settles (moveend), throttled by nature of moveend. */
  readonly onCameraSettled: (camera: SatelliteCompareCamera) => void;
  /** A pane switched from TiTiler to browser-rendered imagery. */
  readonly onDirectFallback: () => void;
}

/**
 * Two or four synchronized 2D maps in a two-column grid that fills its parent. Panes are
 * keyed by position, so swapping, picking, or clearing a scene restyles a pane instead
 * of recreating its map.
 */
export function SatelliteCompareMaps({
  slots,
  initialCamera,
  onCameraSettled,
  onDirectFallback,
}: SatelliteCompareMapsProps) {
  const { t } = useLingui();
  const { mapLayers, mapProviderConfiguration } = useRuntimeServices();
  const [sync] = useState(() => new SatelliteCompareSync(initialCamera));
  // A compare link can open the grid before stored layer choices, rendering mode, and
  // imagery tuning are loaded; every pane reads them once when it mounts.
  const [preferencesRestored, setPreferencesRestored] = useState(false);
  useEffect(() => {
    if (mapLayers === null) return undefined;
    let active = true;
    void mapLayers.restorePersistedState().then(() => {
      if (active) setPreferencesRestored(true);
    });
    return () => {
      active = false;
    };
  }, [mapLayers]);

  // MapLibre caps concurrent raster tile requests for the whole page (16), so four panes
  // would queue TiTiler tiles behind each other; each pane gets a single map's budget.
  useEffect(() => {
    const pageLimit = getMaxParallelImageRequests();
    setMaxParallelImageRequests(pageLimit * maximumComparedScenes);
    return () => {
      setMaxParallelImageRequests(pageLimit);
    };
  }, []);

  // Direct rendering belongs to a scene, so a scene dragged to another pane keeps
  // working imagery instead of retrying the unavailable renderer.
  const [directSceneKeys, setDirectSceneKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const reportDirectFallback = useCallback(
    (sceneKey: string) => {
      setDirectSceneKeys((keys) =>
        keys.has(sceneKey) ? keys : new Set([...keys, sceneKey]),
      );
      onDirectFallback();
    },
    [onDirectFallback],
  );

  if (mapProviderConfiguration.status !== 'valid' || mapLayers === null) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {t`The map provider configuration is invalid. The basemap was not started. Check the deployment configuration or open developer diagnostics.`}
      </Alert>
    );
  }
  // One attribution at the grid's bottom-right also credits what only other panes use:
  // Sentinel imagery on scene panes, static imagery on basemap panes, and the DEM behind
  // plain panes' relief and isolines.
  const configuration = mapProviderConfiguration.value;
  const shownBasemaps = new Set(
    slots.filter((slot) => slot !== null).filter(isComparisonBasemap),
  );
  const gridAttributions = [
    ...new Set(
      slots.map((slot) =>
        slot === null
          ? configuration.terrain.attribution
          : isComparisonBasemap(slot)
            ? basemapAttribution(configuration, slot)
            : configuration.satellite.renderer.attribution,
      ),
    ),
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gridTemplateRows:
          slots.length > 2 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
        gap: '2px',
        width: '100%',
        height: '100%',
        bgcolor: 'grey.900',
      }}
    >
      {preferencesRestored
        ? slots.map((image, index) => (
            <SatelliteComparePane
              // Panes are grid positions; a swap restyles them instead of moving maps.
              key={index}
              configuration={configuration}
              index={index}
              mapLayers={mapLayers}
              image={image}
              shownBasemaps={shownBasemaps}
              attributions={index === slots.length - 1 ? gridAttributions : null}
              directFallback={
                image !== null &&
                !isComparisonBasemap(image) &&
                directSceneKeys.has(satelliteSceneKey(image))
              }
              sync={sync}
              onCameraSettled={onCameraSettled}
              onDirectFallback={reportDirectFallback}
            />
          ))
        : null}
    </Box>
  );
}

interface SceneLabel {
  readonly year: string;
  readonly dayMonth: string;
  readonly date: string;
  readonly time: string;
  readonly cloud: string;
}

/* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
function sceneLabel(scene: SatelliteScene, locale: string): SceneLabel {
  const [west, south, east, north] = satelliteSceneBounds(scene);
  const timeZone = lookupTimeZone((south + north) / 2, (west + east) / 2);
  const acquiredAt = new Date(scene.acquiredAt);
  return {
    year: new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone }).format(
      acquiredAt,
    ),
    dayMonth: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone,
    }).format(acquiredAt),
    date: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone,
    }).format(acquiredAt),
    time: new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
      timeZoneName: 'short',
    }).format(acquiredAt),
    cloud: new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(Math.round(scene.cloudCoverPercent) / 100),
  };
}
/* eslint-enable lingui/no-unlocalized-strings */

interface SatelliteComparePaneProps {
  readonly configuration: MapProviderConfiguration;
  readonly index: number;
  readonly mapLayers: MapLibreLayerController;
  readonly image: ComparisonSlot;
  /** Basemaps shown by any pane; the imagery menu offers the others. */
  readonly shownBasemaps: ReadonlySet<ComparisonBasemap>;
  /** The grid's one attribution control, crediting every pane's providers, or null. */
  readonly attributions: readonly string[] | null;
  /** The scene renders from its visual COG because TiTiler failed for it. */
  readonly directFallback: boolean;
  readonly sync: SatelliteCompareSync;
  readonly onCameraSettled: (camera: SatelliteCompareCamera) => void;
  readonly onDirectFallback: (sceneKey: string) => void;
}

function SatelliteComparePane({
  configuration,
  index,
  mapLayers,
  image,
  shownBasemaps,
  attributions,
  directFallback,
  sync,
  onCameraSettled,
  onDirectFallback,
}: SatelliteComparePaneProps) {
  const { i18n, t } = useLingui();
  const key = String(index);
  const scene = image === null || isComparisonBasemap(image) ? null : image;
  const basemap = image !== null && isComparisonBasemap(image) ? image : null;
  // Layer choices, overlay opacity, the drawn track, terrain overlays, and the start
  // camera are read once: the main map's controls are hidden while the grid is open.
  const [mounted] = useState(() => {
    const { visibility, openStreetMapOpacity } = mapLayerStore.getState();
    // Static imagery shows only on a pane that picked it, whatever the main map shows.
    const plainVisibility: Record<LogicalMapLayerId, boolean> = { ...visibility };
    for (const id of comparisonBasemaps) plainVisibility[id] = false;
    // Water and vegetation fills would hide exactly the land cover being compared, and
    // the opaque Soviet topographic scans would hide the imagery itself; a plain map
    // keeps both as the main map shows them.
    const imageryVisibility = {
      ...plainVisibility,
      'natural-features': false,
      'soviet-topographic': false,
    };
    return {
      imageryVisibility,
      sceneLayerVisibility: baseNativeLayerVisibility(imageryVisibility),
      plainLayerVisibility: baseNativeLayerVisibility(plainVisibility),
      openStreetMapOpacityPaint: openStreetMapOpacityPaint(
        'satellite',
        openStreetMapOpacity,
      ),
      overlays: mapLayers.createComparisonOverlays(),
      camera: sync.camera,
    };
  });
  const sceneKey = scene === null ? null : satelliteSceneKey(scene);
  const tiles = useMemo(
    () => (scene === null ? null : mapLayers.createSceneRasterTiles(scene)),
    [mapLayers, scene],
  );
  // `auto` moves a scene alone to direct rendering when TiTiler throttles or does not
  // answer; the style change makes MapLibre recreate only the Sentinel source.
  const tileUrl =
    tiles === null ? null : directFallback ? tiles.directTileUrl : tiles.tileUrl;
  const unsupportedScene = scene !== null && tiles === null;
  const mapStyle = useMemo(
    () =>
      createSatelliteCompareMapStyle(configuration, {
        imagery:
          basemap !== null
            ? { kind: 'basemap' }
            : scene === null || tiles === null || tileUrl === null
              ? null
              : { kind: 'scene', scene, raster: { ...tiles, tileUrl } },
        baseLayerVisibility:
          basemap !== null
            ? baseNativeLayerVisibility({
                ...mounted.imageryVisibility,
                [basemap]: true,
              })
            : scene === null
              ? mounted.plainLayerVisibility
              : mounted.sceneLayerVisibility,
        openStreetMapOpacityPaint: mounted.openStreetMapOpacityPaint,
        overlays: mounted.overlays,
      }),
    [basemap, configuration, mounted, scene, tileUrl, tiles],
  );
  const label = useMemo(
    () => (scene === null ? null : sceneLabel(scene, i18n.locale)),
    [i18n.locale, scene],
  );
  const date = label === null ? null : label.date;
  const basemapName = basemap === null ? null : i18n._(satelliteBasemapLabels[basemap]);

  const mapLibreLocale = useMemo(
    () => ({
      'AttributionControl.ToggleAttribution': t`Toggle attribution`,
      'Map.Title': t`Map`,
    }),
    [t],
  );

  const crosshairRef = useRef<HTMLDivElement>(null);
  const attachedMap = useRef<MapLibreMap | null>(null);
  const [datePicker, setDatePicker] = useState<{
    readonly anchor: HTMLElement;
    readonly viewport: SatelliteSearchViewport;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState(false);
  const [basemapMenu, setBasemapMenu] = useState<HTMLElement | null>(null);

  // Sentinel tiles of the current view, for the sidebar's per-map progress bar. A tile
  // counts as finished once loaded or failed; an aborted tile leaves the count.
  const tileLoad = useRef({
    requested: new Set<string>(),
    finished: new Set<string>(),
  });
  const publishTileProgress = useCallback(
    (complete: boolean) => {
      const { requested, finished } = tileLoad.current;
      setComparisonTileProgress(index, {
        requested: requested.size,
        finished: finished.size,
        complete,
      });
      if (complete) {
        requested.clear();
        finished.clear();
      }
    },
    [index],
  );
  useEffect(() => {
    tileLoad.current.requested.clear();
    tileLoad.current.finished.clear();
    setComparisonTileProgress(index, null);
    return () => {
      setComparisonTileProgress(index, null);
    };
  }, [index, sceneKey]);
  const tileListeners = useRef<readonly { unsubscribe: () => void }[]>([]);

  const handleMapRef = useCallback(
    (mapRef: MapRef | null) => {
      if (mapRef === null) {
        attachedMap.current = null;
        sync.detach(key);
        for (const listener of tileListeners.current) listener.unsubscribe();
        tileListeners.current = [];
        return;
      }
      const map = mapRef.getMap();
      attachedMap.current = map;
      // Only center and zoom are shared, so every pane stays north-up and flat.
      map.keyboard.disableRotation();
      map.touchZoomRotate.disableRotation();
      // Basemap icons, line patterns, and track endpoints are generated on first use,
      // as on the main map.
      map.setMissingStyleImageResolver(async (imageId) => {
        const endpoint = createTrackEndpointImage(imageId);
        const resolved = endpoint ?? (await createBasemapImage(imageId));
        if (resolved === null) return;
        if (attachedMap.current === map && !map.hasImage(imageId)) {
          map.addImage(imageId, resolved.image, { pixelRatio: resolved.pixelRatio });
        }
      });
      sync.attach(key, map, crosshairRef.current);
      // MapLibre types `coord` as always set, but source-level events carry none.
      const sentinelTileKey = (event: MapSourceDataEvent) =>
        event.sourceId === mapSourceIds.sentinelRasterA && 'coord' in event
          ? event.coord.key
          : null;
      /* eslint-disable lingui/no-unlocalized-strings -- MapLibre event names. */
      tileListeners.current = [
        map.on('sourcedataloading', (event) => {
          const tileKey = sentinelTileKey(event);
          if (tileKey === null) return;
          tileLoad.current.requested.add(tileKey);
          publishTileProgress(false);
        }),
        map.on('sourcedata', (event) => {
          const tileKey = sentinelTileKey(event);
          if (tileKey === null) return;
          tileLoad.current.finished.add(tileKey);
          publishTileProgress(false);
        }),
        map.on('sourcedataabort', (event) => {
          const tileKey = sentinelTileKey(event);
          if (tileKey === null) return;
          tileLoad.current.requested.delete(tileKey);
          tileLoad.current.finished.delete(tileKey);
          publishTileProgress(false);
        }),
        // A failed tile raises an error instead of a data event. Cross-origin failures
        // can omit the source ID, so a source-less error counts when its tile is pending.
        map.on('error', (event) => {
          const failure = event as unknown as {
            readonly sourceId?: unknown;
            readonly tile?: { readonly tileID?: { readonly key?: unknown } };
          };
          const tileKey = failure.tile?.tileID?.key;
          if (typeof tileKey !== 'string') return;
          const sentinel =
            failure.sourceId === mapSourceIds.sentinelRasterA ||
            (failure.sourceId === undefined && tileLoad.current.requested.has(tileKey));
          if (!sentinel) return;
          tileLoad.current.finished.add(tileKey);
          publishTileProgress(false);
        }),
        // Idle means every requested tile is settled. With no tile requested, the scene
        // does not reach this view, so there is nothing left to load either.
        map.on('idle', () => {
          if (map.getSource(mapSourceIds.sentinelRasterA) !== undefined) {
            publishTileProgress(true);
          }
        }),
      ];
      /* eslint-enable lingui/no-unlocalized-strings */
    },
    [key, publishTileProgress, sync],
  );

  const handleError = (event: MapLibreErrorEvent) => {
    if (
      sceneKey !== null &&
      tiles?.renderingMode === 'auto' &&
      !directFallback &&
      isSentinelDirectFallbackError(event, mapSourceIds.sentinelRasterA, tiles.tileUrl)
    ) {
      onDirectFallback(sceneKey);
    }
  };

  const openDatePicker = (anchor: HTMLElement) => {
    const map = attachedMap.current;
    if (map === null) return;
    const bounds = map.getBounds();
    const center = map.getCenter();
    setDatePicker({
      anchor,
      viewport: {
        bounds: {
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        },
        center: { longitude: center.lng, latitude: center.lat },
      },
    });
  };

  const acceptsSlotDrop = (event: DragEvent) =>
    event.dataTransfer.types.includes(slotDragType);

  return (
    <Box
      component="section"
      aria-label={
        date !== null
          ? t`Sentinel-2 image from ${date}`
          : (basemapName ?? t`Map without an image`)
      }
      onDragOver={(event) => {
        if (!acceptsSlotDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(true);
      }}
      onDragLeave={(event) => {
        if (!(
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )) {
          setDropTarget(false);
        }
      }}
      onDrop={(event) => {
        setDropTarget(false);
        if (!acceptsSlotDrop(event)) return;
        event.preventDefault();
        swapComparisonSlots(Number(event.dataTransfer.getData(slotDragType)), index);
      }}
      sx={{
        position: 'relative',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        outline: dropTarget ? '3px solid' : 'none',
        outlineColor: 'warning.main',
        outlineOffset: -3,
      }}
    >
      {unsupportedScene ? (
        <Alert severity="warning" sx={{ m: 2, mt: 9 }}>
          {t`This scene has no supported true-color asset.`}
        </Alert>
      ) : (
        <Map
          ref={handleMapRef}
          locale={mapLibreLocale}
          initialViewState={{
            longitude: mounted.camera.center.longitude,
            latitude: mounted.camera.center.latitude,
            zoom: mounted.camera.zoom,
            bearing: 0,
            pitch: 0,
          }}
          mapStyle={mapStyle}
          maxPitch={0}
          // The pane under the pointer shows the sky-blue crosshair; the grab hand marks only
          // the draggable dates.
          cursor={pointerCursor}
          attributionControl={false}
          boxZoom={false}
          dragRotate={false}
          pitchWithRotate={false}
          touchPitch={false}
          reuseMaps={false}
          style={{ width: '100%', height: '100%' }}
          onError={handleError}
          onMove={() => {
            sync.handleMove(key);
          }}
          onMoveEnd={() => {
            const settled = sync.handleMoveEnd(key);
            if (settled !== null) onCameraSettled(settled);
          }}
          onMouseMove={(event) => {
            sync.showPointer(key, event.lngLat);
          }}
          onMouseOut={() => {
            sync.hidePointer();
          }}
        >
          {/* Flush with the bottom edge, as on the main map. */}
          {attributions === null ? null : (
            <AttributionControl
              // The control reads its custom attribution once, so a new set remounts it.
              key={attributions.join('\n')}
              compact={false}
              position="bottom-right"
              customAttribution={[...attributions]}
            />
          )}
        </Map>
      )}
      <Box
        ref={crosshairRef}
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 1,
          display: 'none',
          pointerEvents: 'none',
        }}
      >
        <svg
          width="17"
          height="17"
          viewBox="-8.5 -8.5 17 17"
          style={{ position: 'absolute', left: -8.5, top: -8.5 }}
        >
          <path
            d="M-7 0H-3M3 0H7M0 -7V-3M0 3V7"
            fill="none"
            stroke="rgb(0 0 0 / 75%)"
            strokeLinecap="round"
            strokeWidth={3}
          />
          <path
            d="M-7 0H-3M3 0H7M0 -7V-3M0 3V7"
            fill="none"
            stroke="#FFFFFF"
            strokeLinecap="round"
            strokeWidth={1.5}
          />
        </svg>
      </Box>
      {/* The whole chip drags; the dotted handle and the hover outline show that. */}
      <Box
        draggable={image !== null}
        onDragStart={(event) => {
          event.dataTransfer.setData(slotDragType, String(index));
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setDragImage(event.currentTarget, 16, 16);
        }}
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 1,
          display: 'flex',
          alignItems: 'stretch',
          overflow: 'hidden',
          borderRadius: 1,
          bgcolor: 'rgb(0 0 0 / 64%)',
          color: 'common.white',
          // The grab hand appears only here; the maps themselves show a crosshair.
          cursor: image === null ? 'pointer' : 'grab',
          '&:active': { cursor: image === null ? 'pointer' : 'grabbing' },
          transition: (theme) =>
            theme.transitions.create(['background-color', 'box-shadow'], {
              duration: theme.transitions.duration.shortest,
            }),
          '&:hover, &:focus-within': {
            bgcolor: 'rgb(0 0 0 / 82%)',
            boxShadow: '0 0 0 1px rgb(255 255 255 / 55%)',
          },
          '&:hover .compare-drag-handle': { opacity: 1 },
        }}
      >
        {image === null ? null : (
          <Tooltip title={t`Drag onto another map to swap`} placement="bottom-start">
            <Box
              className="compare-drag-handle"
              aria-hidden
              sx={{
                display: 'flex',
                alignItems: 'center',
                pl: 0.25,
                pr: 0,
                opacity: 0.7,
                cursor: 'inherit',
                '&:hover': { bgcolor: 'rgb(255 255 255 / 12%)' },
              }}
            >
              <DragIndicatorIcon fontSize="small" />
            </Box>
          </Tooltip>
        )}
        <ButtonBase
          aria-label={
            date === null ? t`Pick image date` : t`Change image date, ${date}`
          }
          aria-haspopup="dialog"
          onClick={(event) => {
            openDatePicker(event.currentTarget);
          }}
          sx={{
            pl: 1,
            pr: 0.5,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            textAlign: 'left',
            cursor: 'inherit',
            '&:hover, &.Mui-focusVisible': { bgcolor: 'rgb(255 255 255 / 10%)' },
          }}
        >
          <Box>
            {label !== null ? (
              <SceneLabelText {...label} />
            ) : (
              <Typography
                variant="body2"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  lineHeight: 1.3,
                }}
              >
                <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />
                {basemapName ?? t`Pick image date`}
              </Typography>
            )}
          </Box>
          {/* Shown like a select so the label reads as something that opens a menu. */}
          <ArrowDropDownIcon
            aria-hidden
            sx={{
              fontSize: 22,
              opacity: 0.85,
              transform: datePicker === null ? 'none' : 'rotate(180deg)',
            }}
          />
        </ButtonBase>
        <Tooltip title={t`Static satellite imagery`}>
          <ButtonBase
            aria-label={t`Choose static satellite imagery`}
            aria-haspopup="menu"
            aria-expanded={basemapMenu !== null}
            onClick={(event) => {
              setBasemapMenu(event.currentTarget);
            }}
            sx={{
              px: 0.75,
              borderLeft: '1px solid rgb(255 255 255 / 24%)',
              cursor: 'pointer',
              '&:hover, &.Mui-focusVisible': { bgcolor: 'rgb(255 255 255 / 10%)' },
            }}
          >
            <LayersOutlinedIcon fontSize="small" />
          </ButtonBase>
        </Tooltip>
      </Box>
      <Menu
        anchorEl={basemapMenu}
        open={basemapMenu !== null}
        onClose={() => {
          setBasemapMenu(null);
        }}
        slotProps={{ list: { 'aria-label': t`Choose static satellite imagery` } }}
      >
        {comparisonBasemaps.map((candidate) => (
          <MenuItem
            key={candidate}
            role="menuitemradio"
            aria-checked={candidate === basemap}
            selected={candidate === basemap}
            // A basemap shown by another pane would only duplicate it.
            disabled={candidate !== basemap && shownBasemaps.has(candidate)}
            onClick={() => {
              setComparisonSlot(index, candidate);
              setBasemapMenu(null);
            }}
            sx={{ minHeight: 44, minWidth: 240, px: 2 }}
          >
            <ListItemText primary={i18n._(satelliteBasemapLabels[candidate])} />
          </MenuItem>
        ))}
      </Menu>
      <Popover
        open={datePicker !== null}
        anchorEl={datePicker?.anchor ?? null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        onClose={() => {
          setDatePicker(null);
        }}
      >
        {datePicker === null ? null : (
          <ComparedSceneDatePicker
            slotIndex={index}
            scene={scene}
            viewport={datePicker.viewport}
            onClose={() => {
              setDatePicker(null);
            }}
          />
        )}
      </Popover>
    </Box>
  );
}

function SceneLabelText({ year, dayMonth, time, cloud }: SceneLabel) {
  const { t } = useLingui();
  return (
    <>
      <Typography variant="body2" sx={{ lineHeight: 1.3 }}>
        <Box component="span" sx={{ fontWeight: 700 }}>
          {year}
        </Box>{' '}
        {dayMonth}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.85 }}>
        {t`${time} · ${cloud} cloud`}
      </Typography>
    </>
  );
}
