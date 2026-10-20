import { useLingui } from '@lingui/react/macro';
import { Alert, Box, Typography } from '@mui/material';
import lookupTimeZone from '@photostructure/tz-lookup';
import type { ErrorEvent as MapLibreErrorEvent, Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { AttributionControl, type MapRef } from 'react-map-gl/maplibre';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  satelliteSceneBounds,
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';
import { createBasemapImage } from '@/presentation/map/basemapSymbols';
import {
  baseNativeLayerVisibility,
  isSentinelDirectFallbackError,
  openStreetMapOpacityPaint,
  type MapLibreLayerController,
} from '@/presentation/map/MapLibreLayerController';
import { mapSourceIds } from '@/presentation/map/mapIds';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { createSatelliteCompareMapStyle } from '@/presentation/map/mapStyleFactory';
import type { MapCoordinate } from '@/presentation/map/mapTypes';
import { SatelliteCompareSync } from '@/presentation/map/SatelliteCompareSync';

export interface SatelliteCompareCamera {
  readonly center: MapCoordinate;
  readonly zoom: number;
}

export interface SatelliteCompareMapsProps {
  /** 2–4 scenes, already in display (chronological) order. */
  readonly scenes: readonly SatelliteScene[];
  /** Camera used when the grid mounts. */
  readonly initialCamera: SatelliteCompareCamera;
  /** Called after the shared camera settles (moveend), throttled by nature of moveend. */
  readonly onCameraSettled: (camera: SatelliteCompareCamera) => void;
}

/**
 * Two to four synchronized 2D maps, one per Sentinel-2 scene, in a two-column grid that
 * fills its parent. Panes are keyed by scene, so adding or removing a scene keeps the
 * other panes' maps and the shared camera.
 */
export function SatelliteCompareMaps({
  scenes,
  initialCamera,
  onCameraSettled,
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

  if (mapProviderConfiguration.status !== 'valid' || mapLayers === null) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {t`The map provider configuration is invalid. The basemap was not started. Check the deployment configuration or open developer diagnostics.`}
      </Alert>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gridTemplateRows:
          scenes.length > 2 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
        gap: '2px',
        width: '100%',
        height: '100%',
        bgcolor: 'grey.900',
      }}
    >
      {preferencesRestored
        ? scenes.map((scene, index) => (
            <SatelliteComparePane
              key={satelliteSceneKey(scene)}
              configuration={mapProviderConfiguration.value}
              mapLayers={mapLayers}
              scene={scene}
              showAttribution={index === scenes.length - 1}
              sync={sync}
              onCameraSettled={onCameraSettled}
            />
          ))
        : null}
      {preferencesRestored && scenes.length === 3 ? (
        <Box aria-hidden sx={{ bgcolor: 'grey.200' }} />
      ) : null}
    </Box>
  );
}

interface SatelliteComparePaneProps {
  readonly configuration: MapProviderConfiguration;
  readonly mapLayers: MapLibreLayerController;
  readonly scene: SatelliteScene;
  /** All panes show the same providers, so one compact attribution serves the grid. */
  readonly showAttribution: boolean;
  readonly sync: SatelliteCompareSync;
  readonly onCameraSettled: (camera: SatelliteCompareCamera) => void;
}

function SatelliteComparePane({
  configuration,
  mapLayers,
  scene: mountedScene,
  showAttribution,
  sync,
  onCameraSettled,
}: SatelliteComparePaneProps) {
  const { i18n, t } = useLingui();
  // The pane key is the scene key, so the scene, its tiles, the layer choices, the
  // overlay opacity, and the start camera are fixed for the pane's lifetime.
  const [pane] = useState(() => {
    const { visibility, openStreetMapOpacity } = mapLayerStore.getState();
    return {
      scene: mountedScene,
      key: satelliteSceneKey(mountedScene),
      tiles: mapLayers.createSceneRasterTiles(mountedScene),
      baseLayerVisibility: baseNativeLayerVisibility(visibility),
      openStreetMapOpacityPaint: openStreetMapOpacityPaint(
        'satellite',
        openStreetMapOpacity,
      ),
      camera: sync.camera,
    };
  });
  const { scene, key, tiles } = pane;
  const [directFallback, setDirectFallback] = useState(false);
  const tileUrl =
    tiles === null ? null : directFallback ? tiles.directTileUrl : tiles.tileUrl;
  const mapStyle = useMemo(
    () =>
      tiles === null || tileUrl === null
        ? null
        : createSatelliteCompareMapStyle(configuration, {
            scene,
            raster: { ...tiles, tileUrl },
            baseLayerVisibility: pane.baseLayerVisibility,
            openStreetMapOpacityPaint: pane.openStreetMapOpacityPaint,
          }),
    [configuration, pane, scene, tileUrl, tiles],
  );

  /* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
  const { year, dayMonth, date, time, cloud } = useMemo(() => {
    const [west, south, east, north] = satelliteSceneBounds(scene);
    const timeZone = lookupTimeZone((south + north) / 2, (west + east) / 2);
    const acquiredAt = new Date(scene.acquiredAt);
    const locale = i18n.locale;
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
  }, [i18n.locale, scene]);
  /* eslint-enable lingui/no-unlocalized-strings */

  const mapLibreLocale = useMemo(
    () => ({
      'AttributionControl.ToggleAttribution': t`Toggle attribution`,
      'Map.Title': t`Map`,
    }),
    [t],
  );

  const crosshairRef = useRef<HTMLDivElement>(null);
  const attachedMap = useRef<MapLibreMap | null>(null);
  const handleMapRef = useCallback(
    (mapRef: MapRef | null) => {
      if (mapRef === null) {
        attachedMap.current = null;
        sync.detach(key);
        return;
      }
      const map = mapRef.getMap();
      attachedMap.current = map;
      // Only center and zoom are shared, so every pane stays north-up and flat.
      map.keyboard.disableRotation();
      map.touchZoomRotate.disableRotation();
      // Basemap icons and line patterns are generated on first use, as on the main map.
      map.setMissingStyleImageResolver(async (imageId) => {
        const pending = createBasemapImage(imageId);
        if (pending === null) return;
        const { image, pixelRatio } = await pending;
        if (attachedMap.current === map && !map.hasImage(imageId)) {
          map.addImage(imageId, image, { pixelRatio });
        }
      });
      sync.attach(key, map, crosshairRef.current);
    },
    [key, sync],
  );

  // `auto` moves this pane alone to direct rendering when TiTiler throttles or does not
  // answer, once; the style change makes MapLibre recreate only the Sentinel source.
  const handleError = (event: MapLibreErrorEvent) => {
    if (
      tiles?.renderingMode === 'auto' &&
      !directFallback &&
      isSentinelDirectFallbackError(event, mapSourceIds.sentinelRasterA, tiles.tileUrl)
    ) {
      setDirectFallback(true);
    }
  };

  return (
    <Box
      component="section"
      aria-label={t`Sentinel-2 image from ${date}`}
      sx={{ position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
    >
      {mapStyle === null ? (
        <Alert severity="warning" sx={{ m: 2, mt: 9 }}>
          {t`This scene has no supported true-color asset.`}
        </Alert>
      ) : (
        <Map
          ref={handleMapRef}
          locale={mapLibreLocale}
          initialViewState={{
            longitude: pane.camera.center.longitude,
            latitude: pane.camera.center.latitude,
            zoom: pane.camera.zoom,
            bearing: 0,
            pitch: 0,
          }}
          mapStyle={mapStyle}
          maxPitch={0}
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
          {showAttribution ? (
            <AttributionControl compact position="bottom-right" />
          ) : null}
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
          width="25"
          height="25"
          viewBox="-12.5 -12.5 25 25"
          style={{ position: 'absolute', left: -12.5, top: -12.5 }}
        >
          <path
            d="M-11 0H-4M4 0H11M0 -11V-4M0 4V11"
            fill="none"
            stroke="rgb(0 0 0 / 75%)"
            strokeLinecap="round"
            strokeWidth={4}
          />
          <path
            d="M-11 0H-4M4 0H11M0 -11V-4M0 4V11"
            fill="none"
            stroke="#FFFFFF"
            strokeLinecap="round"
            strokeWidth={2}
          />
        </svg>
      </Box>
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 1,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          bgcolor: 'rgb(0 0 0 / 64%)',
          color: 'common.white',
          pointerEvents: 'none',
        }}
      >
        <Typography variant="body2" sx={{ lineHeight: 1.3 }}>
          <Box component="span" sx={{ fontWeight: 700 }}>
            {year}
          </Box>{' '}
          {dayMonth}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.85 }}>
          {t`${time} · ${cloud} cloud`}
        </Typography>
      </Box>
    </Box>
  );
}
