import { msg, plural } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  FormGroup,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  supportedContourIntervals,
  type LogicalMapLayerId,
  type TerrainOverlayPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';
import {
  mapLayerStore,
  type MapLayerProblem,
  type TerrainOverlayProblem,
  type WeatherMapProblem,
} from '@/presentation/map/mapLayerStore';
import { satelliteImageryProblemMessage } from '@/presentation/satellite-browser/satelliteProblemMessages';
import { useUiStore } from '@/presentation/shell/uiStore';
import { workspaceHashForTab } from '@/presentation/shell/workspaceTabLocation';

interface LayerControl {
  readonly id: LogicalMapLayerId;
  readonly label: MessageDescriptor;
  readonly description: MessageDescriptor;
  readonly requiresScene: boolean;
}

const googleSatelliteControl = {
  id: 'google-satellite',
  label: msg`Google satellite imagery`,
  description: msg`Google satellite tiles for the current map view.`,
  requiresScene: false,
} as const satisfies LayerControl;

const bingSatelliteControl = {
  id: 'bing-satellite',
  label: msg`Bing aerial imagery`,
  description: msg`Bing aerial tiles for the current map view.`,
  requiresScene: false,
} as const satisfies LayerControl;

const esriSatelliteControl = {
  id: 'esri-satellite',
  label: msg`Esri World Imagery`,
  description: msg`Esri global satellite and aerial imagery.`,
  requiresScene: false,
} as const satisfies LayerControl;

const naprOrthophotoControl = {
  id: 'napr-orthophoto',
  label: msg`NAPR Orthophoto`,
  description: msg`Newest available NAPR orthophoto: 2025, then 2020, then 2016–2017.`,
  requiresScene: false,
} as const satisfies LayerControl;

const sentinelControls = [
  {
    id: 'satellite-imagery',
    label: msg`Satellite imagery`,
    description: msg`The applied Sentinel true-color imagery.`,
    requiresScene: true,
  },
  {
    id: 'scene-footprint',
    label: msg`Scene footprint`,
    description: msg`The actual boundary of the applied scene.`,
    requiresScene: true,
  },
] as const satisfies readonly LayerControl[];

const naturalFeatureControls = [
  {
    id: 'natural-features',
    label: msg`Natural features`,
    description: msg`Vegetation, glaciers, wetlands, rivers, and water bodies.`,
    requiresScene: false,
  },
] as const satisfies readonly LayerControl[];

const navigationAndAccessControls = [
  {
    id: 'restricted-areas',
    label: msg`Restricted areas`,
    description: msg`Red perimeters for provider-identified military land.`,
    requiresScene: false,
  },
  {
    id: 'detail-context',
    label: msg`OSM detail`,
    description: msg`Brownfield land and building footprints from OSM Shortbread.`,
    requiresScene: false,
  },
  {
    id: 'hiking-paths',
    label: msg`Hiking paths`,
    description: msg`Paths, tracks, footways, and steps.`,
    requiresScene: false,
  },
  {
    id: 'roads',
    label: msg`Roads`,
    description: msg`Road lines, casings, and labels.`,
    requiresScene: false,
  },
  {
    id: 'places-and-pois',
    label: msg`Places and POIs`,
    description: msg`Settlements, peaks, and hiking places.`,
    requiresScene: false,
  },
] as const satisfies readonly LayerControl[];

const openStreetMapControls = [
  ...naturalFeatureControls,
  ...navigationAndAccessControls,
] as const satisfies readonly LayerControl[];

const terrainControls = [
  {
    id: 'terrain-relief',
    label: msg`Relief shading`,
    description: msg`Hillshade derived from the configured elevation tiles.`,
    requiresScene: false,
  },
  {
    id: 'elevation-isolines',
    label: msg`Elevation isolines`,
    description: msg`Generated contour lines and labeled index elevations.`,
    requiresScene: false,
  },
] as const satisfies readonly LayerControl[];

const importedTrackControls = [
  {
    id: 'imported-tracks',
    label: msg`Imported tracks`,
    description: msg`The active local GPX preview or saved track.`,
    requiresScene: false,
  },
  {
    id: 'track-elevation-gradient',
    label: msg`Elevation gradient`,
    description: msg`Climb and descent grade colors across the active track.`,
    requiresScene: false,
  },
] as const satisfies readonly LayerControl[];

function terrainOverlayProblemMessage(
  problem: TerrainOverlayProblem,
): MessageDescriptor {
  switch (problem) {
    case 'map-not-ready':
      return msg`The map is not ready yet.`;
    case 'unsupported-contour-interval':
      return msg`Choose a supported contour distance that divides the 200 m index interval.`;
    case 'relief-render-failed':
      return msg`Terrain relief could not be rendered. The base map remains available.`;
    case 'contours-failed':
      return msg`Elevation isolines could not be generated. Relief and the base map remain available.`;
  }
}

function weatherMapProblemMessage(problem: WeatherMapProblem): MessageDescriptor {
  switch (problem) {
    case 'map-not-ready':
      return msg`The map is not ready yet.`;
    case 'provider-unavailable':
      return msg`The weather map provider is unavailable.`;
    case 'data-unavailable':
      return msg`Open-Meteo weather map data is unavailable.`;
    case 'no-forecast-time':
      return msg`Open-Meteo did not provide an available forecast time.`;
    case 'frame-failed':
      return msg`The selected weather frame could not be shown.`;
    case 'not-enabled':
      return msg`Enable the weather map before choosing its time.`;
    case 'time-unavailable':
      return msg`Choose an available weather forecast time.`;
    case 'opacity-out-of-range':
      return msg`Choose an opacity between 0 and 100 percent.`;
  }
}

function mapLayerProblemMessage(problem: MapLayerProblem): MessageDescriptor {
  switch (problem.code) {
    case 'map-not-ready':
      return msg`The map is not ready yet.`;
    case 'weather-hides-terrain':
      return msg`Disable the weather map before enabling terrain overlays.`;
    case 'scene-required':
      return msg`Apply a Sentinel scene before changing it.`;
    case 'preset-requires-scene':
      return msg`Apply a Sentinel scene before choosing this preset.`;
    case 'layer-unavailable':
      return msg`The requested map layer is not available yet.`;
    case 'opacity-out-of-range':
      return msg`Choose an opacity between 0 and 100 percent.`;
    case 'track-geometry-invalid':
      return msg`The imported track geometry is invalid.`;
    case 'track-render-failed':
      return msg`The imported track could not be rendered.`;
    case 'planned-line-geometry-invalid':
      return msg`The planned line geometry is invalid.`;
    case 'planned-line-render-failed':
      return msg`The planned line could not be rendered.`;
    case 'satellite-imagery-failed':
      return satelliteImageryProblemMessage(problem.problem);
    case 'terrain-overlay-failed':
      return terrainOverlayProblemMessage(problem.problem);
  }
}

export function LayersPanel() {
  const { i18n, t } = useLingui();
  const { mapLayers, mapProviderConfiguration } = useRuntimeServices();
  // Terrain queue and imagery/weather progress change per tile; the panel only renders
  // these derived fields, so it must not re-render (even hidden) on every tile update.
  const state = useStore(
    mapLayerStore,
    useShallow((layerState) => {
      const { appliedImagery, appliedMosaic, weatherMap } = layerState;
      const mosaicAvailable =
        appliedMosaic.status !== 'empty' && appliedMosaic.sceneKeys.length > 0;
      const sceneAvailable =
        appliedImagery.status === 'ready' ||
        appliedImagery.status === 'preview' ||
        appliedImagery.status === 'hidden' ||
        (appliedImagery.status === 'failed' &&
          appliedImagery.previousSceneKey !== null);
      return {
        sceneAvailable,
        sentinelImageryAvailable: sceneAvailable || mosaicAvailable,
        satelliteImageryVisible:
          mosaicAvailable ||
          appliedImagery.status === 'ready' ||
          appliedImagery.status === 'preview' ||
          ((appliedImagery.status === 'loading' ||
            appliedImagery.status === 'failed') &&
            appliedImagery.previousSceneKey !== null),
        weatherMapEnabled: weatherMap.enabled,
        weatherMapLoading: weatherMap.status === 'loading',
        weatherMapOpacity: weatherMap.opacity,
        weatherMapProblem: weatherMap.problem,
        terrainComputeStatus: layerState.terrainComputeStatus,
        terrainOverlays: layerState.terrainOverlays,
        visibility: layerState.visibility,
        openStreetMapOpacity: layerState.openStreetMapOpacity,
        importedTrackOpacity: layerState.importedTrackOpacity,
        layerProblem: layerState.layerProblem,
      };
    }),
  );
  const setActiveTab = useUiStore((uiState) => uiState.setActiveTab);
  const [terrainOverlayCommandProblem, setTerrainOverlayCommandProblem] =
    useState<TerrainOverlayProblem | null>(null);
  const provider =
    mapProviderConfiguration.status === 'valid' ? mapProviderConfiguration.value : null;
  /* eslint-disable -- Intl option values are locale-independent formatting tokens. */
  const percentFormatter = new Intl.NumberFormat(i18n.locale, { style: 'percent' });
  const meterFormatter = new Intl.NumberFormat(i18n.locale, {
    style: 'unit',
    unit: 'meter',
    unitDisplay: 'short',
  });
  /* eslint-enable */
  const formatPercent = (value: number) => percentFormatter.format(value / 100);
  const groups = [
    {
      id: 'imported-tracks',
      title: t`Local GPX`,
      description: t`Tracks retained only in this browser.`,
      controls: importedTrackControls,
    },
    {
      id: 'satellites',
      title: t`Satellites`,
      description: t`Satellite basemaps and applied observation scenes.`,
      controls: [
        googleSatelliteControl,
        bingSatelliteControl,
        esriSatelliteControl,
        naprOrthophotoControl,
        ...sentinelControls,
      ],
    },
    {
      id: 'terrain',
      title: provider?.terrain.label ?? t`Terrain elevation`,
      description: t`Elevation tiles for relief, contours, and 3D terrain.`,
      controls: terrainControls,
    },
    {
      id: 'openstreetmap',
      title:
        provider === null
          ? t`OpenStreetMap via vector tile provider`
          : t`OpenStreetMap via ${provider.vector.label} + ${provider.detailVector.label}`,
      description: t`Vector basemap data styled for hiking and navigation.`,
      controls: openStreetMapControls,
    },
  ] as const;
  const terrainOverlayProblem =
    terrainOverlayCommandProblem ?? state.terrainOverlays.problem;
  const contourIntervalMeters = state.terrainOverlays.preferences.contourIntervalMeters;
  const satelliteCatalogLabel = provider?.satellite.label ?? t`satellite catalog`;

  const changeVisibility = (layerId: LogicalMapLayerId, visible: boolean) => {
    mapLayers?.setLayerVisibility(layerId, visible);
  };

  // Drags only repaint; the released value is persisted and logged once on commit.
  const changeOpenStreetMapOpacity = (
    value: number | number[],
    change: 'live' | 'commit',
  ) => {
    if (typeof value === 'number') {
      mapLayers?.setOpenStreetMapOpacity(value / 100, change);
    }
  };

  const changeImportedTrackOpacity = (
    value: number | number[],
    change: 'live' | 'commit',
  ) => {
    if (typeof value === 'number')
      mapLayers?.setImportedTrackOpacity(value / 100, change);
  };

  const changeTerrainOverlayPreferences = (value: TerrainOverlayPreferences) => {
    if (mapLayers === null) return;
    const result = mapLayers.setTerrainOverlayPreferences(value);
    setTerrainOverlayCommandProblem(result.status === 'failed' ? result.problem : null);
  };
  const openWeatherTab = () => {
    setActiveTab('weather');
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = workspaceHashForTab('weather');
    window.history.pushState(window.history.state, '', nextUrl);
  };

  const changeWeatherOpacity = (
    value: number | number[],
    change: 'live' | 'commit',
  ) => {
    if (typeof value === 'number') mapLayers?.setWeatherOpacity(value / 100, change);
  };

  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
      {mapLayers === null ? (
        <Alert severity="error">
          <Trans>Map layer controls are unavailable.</Trans>
        </Alert>
      ) : null}
      <Stack spacing={2} divider={<Divider flexItem />}>
        <Box component="section" aria-labelledby="weather-layer-source">
          <Typography id="weather-layer-source" component="h3" variant="subtitle2">
            <Trans>Weather</Trans>
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
          >
            <Trans>
              ECMWF IFS clouds, precipitation, and compact wind arrows from Open-Meteo.
            </Trans>
          </Typography>
          <Box sx={{ px: 1, mt: 1 }}>
            <FormControlLabel
              sx={{ m: 0 }}
              slotProps={{ typography: { variant: 'body2' } }}
              disabled={mapLayers === null || state.weatherMapLoading}
              control={
                <Checkbox
                  size="small"
                  sx={{ p: 0, mr: 1 }}
                  checked={state.weatherMapEnabled}
                  onChange={(event) => {
                    if (event.target.checked) {
                      openWeatherTab();
                      return;
                    }
                    void mapLayers?.setWeatherEnabled(false);
                  }}
                />
              }
              label={
                state.weatherMapEnabled ? t`Weather map visible` : t`Open Weather tab`
              }
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', pl: 3.5, mt: 0.5 }}
            >
              {state.weatherMapEnabled
                ? t`All weather fields use the same metadata-selected forecast frame.`
                : t`Enable the combined weather layer from the Weather tab.`}
            </Typography>
            <Stack
              direction="row"
              spacing={1.25}
              sx={{ mt: 1, pl: 3.5, alignItems: 'center' }}
            >
              <Typography id="weather-opacity-label" variant="body2">
                <Trans>Opacity</Trans>
              </Typography>
              <Slider
                aria-labelledby="weather-opacity-label"
                disabled={mapLayers === null || !state.weatherMapEnabled}
                min={0}
                max={100}
                step={5}
                value={Math.round(state.weatherMapOpacity * 100)}
                valueLabelDisplay="auto"
                valueLabelFormat={formatPercent}
                onChange={(_event, value) => {
                  changeWeatherOpacity(value, 'live');
                }}
                onChangeCommitted={(_event, value) => {
                  changeWeatherOpacity(value, 'commit');
                }}
                sx={{ flex: 1, mx: 0.5 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ minWidth: 34, textAlign: 'right' }}
              >
                {formatPercent(Math.round(state.weatherMapOpacity * 100))}
              </Typography>
            </Stack>
            {state.weatherMapProblem === null ? null : (
              <Alert severity="warning" role="status" sx={{ mt: 1 }}>
                {i18n._(weatherMapProblemMessage(state.weatherMapProblem))}
              </Alert>
            )}
          </Box>
        </Box>
        {groups.map((group) => (
          <Box
            component="section"
            key={group.id}
            aria-labelledby={`${group.id}-layer-source`}
          >
            <Typography
              id={`${group.id}-layer-source`}
              component="h3"
              variant="subtitle2"
            >
              {group.title}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.5 }}
            >
              {group.description}
            </Typography>
            <Box sx={{ px: 1 }}>
              {group.id === 'terrain' &&
              (state.terrainComputeStatus === 'inline' ||
                terrainOverlayProblem !== null) ? (
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {state.terrainComputeStatus === 'inline' ? (
                    <Alert severity="warning">
                      <Trans>
                        Terrain processing is running in compatibility mode. Terrain
                        features remain available, but map movement may be slower.
                      </Trans>
                    </Alert>
                  ) : null}
                  {terrainOverlayProblem === null ? null : (
                    <Alert severity="warning" role="status">
                      {i18n._(terrainOverlayProblemMessage(terrainOverlayProblem))}
                    </Alert>
                  )}
                </Stack>
              ) : null}
              {group.id === 'openstreetmap' ? (
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ mt: 1, alignItems: 'center' }}
                >
                  <Typography id="openstreetmap-opacity-label" variant="body2">
                    <Trans>Opacity</Trans>
                  </Typography>
                  <Slider
                    aria-labelledby="openstreetmap-opacity-label"
                    disabled={
                      mapLayers === null ||
                      (!state.visibility['google-satellite'] &&
                        !state.visibility['bing-satellite'] &&
                        !state.visibility['esri-satellite'] &&
                        !state.visibility['napr-orthophoto'] &&
                        !state.satelliteImageryVisible)
                    }
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(state.openStreetMapOpacity * 100)}
                    valueLabelDisplay="auto"
                    valueLabelFormat={formatPercent}
                    onChange={(_event, value) => {
                      changeOpenStreetMapOpacity(value, 'live');
                    }}
                    onChangeCommitted={(_event, value) => {
                      changeOpenStreetMapOpacity(value, 'commit');
                    }}
                    sx={{ flex: 1, mx: 0.5 }}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ minWidth: 4, pl: 0.5, textAlign: 'right' }}
                  >
                    {formatPercent(Math.round(state.openStreetMapOpacity * 100))}
                  </Typography>
                </Stack>
              ) : null}
              {group.id === 'imported-tracks' ? (
                <Stack
                  direction="row"
                  spacing={1.25}
                  sx={{ mt: 1, px: 0.25, alignItems: 'center' }}
                >
                  <Typography id="imported-tracks-opacity-label" variant="body2">
                    <Trans>Track opacity</Trans>
                  </Typography>
                  <Slider
                    aria-labelledby="imported-tracks-opacity-label"
                    disabled={mapLayers === null}
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(state.importedTrackOpacity * 100)}
                    valueLabelDisplay="auto"
                    valueLabelFormat={formatPercent}
                    onChange={(_event, value) => {
                      changeImportedTrackOpacity(value, 'live');
                    }}
                    onChangeCommitted={(_event, value) => {
                      changeImportedTrackOpacity(value, 'commit');
                    }}
                    sx={{ flex: 1, mx: 0.5 }}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ minWidth: 4, pl: 0.75, textAlign: 'right' }}
                  >
                    {formatPercent(Math.round(state.importedTrackOpacity * 100))}
                  </Typography>
                </Stack>
              ) : null}
              <FormGroup aria-label={t`${group.title} layers`} sx={{ mt: 1, gap: 1.5 }}>
                {group.controls.map((control) => {
                  const requiredImageryAvailable =
                    control.id === 'satellite-imagery'
                      ? state.sentinelImageryAvailable
                      : state.sceneAvailable;
                  const disabled =
                    mapLayers === null ||
                    (group.id === 'terrain' && state.weatherMapEnabled) ||
                    (control.requiresScene && !requiredImageryAvailable);
                  return (
                    <Box key={control.id}>
                      {group.id === 'satellites' &&
                      control.id === 'satellite-imagery' ? (
                        <Typography
                          component="h4"
                          variant="body2"
                          sx={{ mt: 2, mb: 1, fontWeight: 600 }}
                        >
                          <Trans>
                            Copernicus Sentinel-2 via {satelliteCatalogLabel}
                          </Trans>
                        </Typography>
                      ) : null}
                      <FormControlLabel
                        sx={{ m: 0 }}
                        slotProps={{ typography: { variant: 'body2' } }}
                        disabled={disabled}
                        control={
                          <Checkbox
                            size="small"
                            sx={{ p: 0, mr: 1 }}
                            checked={state.visibility[control.id]}
                            onChange={(event) => {
                              changeVisibility(control.id, event.target.checked);
                            }}
                          />
                        }
                        label={i18n._(control.label)}
                      />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', pl: 3.5, mt: 0.5 }}
                      >
                        {group.id === 'terrain' && state.weatherMapEnabled
                          ? t`Weather temporarily hides terrain and restores this setting when disabled.`
                          : control.requiresScene && !requiredImageryAvailable
                            ? control.id === 'satellite-imagery'
                              ? t`Apply Sentinel imagery to enable this layer.`
                              : t`Apply a Sentinel scene to enable this layer.`
                            : i18n._(control.description)}
                      </Typography>
                      {control.id === 'elevation-isolines' ? (
                        <Stack
                          direction="row"
                          spacing={1.5}
                          sx={{ mt: 1, pl: 3.5, alignItems: 'center' }}
                        >
                          <Typography
                            id="contour-distance-label"
                            variant="body2"
                            sx={{ minWidth: 104 }}
                          >
                            <Trans>Isolines distance</Trans>
                          </Typography>
                          <Slider
                            aria-labelledby="contour-distance-label"
                            aria-valuetext={t`${plural(contourIntervalMeters, {
                              one: '# metre',
                              other: '# metres',
                            })}`}
                            disabled={mapLayers === null || state.weatherMapEnabled}
                            min={0}
                            max={supportedContourIntervals.length - 1}
                            step={1}
                            marks={supportedContourIntervals.map((_value, index) => ({
                              value: index,
                            }))}
                            value={supportedContourIntervals.indexOf(
                              contourIntervalMeters,
                            )}
                            valueLabelDisplay="auto"
                            valueLabelFormat={(value) =>
                              meterFormatter.format(
                                supportedContourIntervals[value] ?? 0,
                              )
                            }
                            onChange={(_event, value) => {
                              if (typeof value !== 'number') return;
                              const nextContourIntervalMeters =
                                supportedContourIntervals[value];
                              if (nextContourIntervalMeters === undefined) return;
                              changeTerrainOverlayPreferences({
                                ...state.terrainOverlays.preferences,
                                contourIntervalMeters: nextContourIntervalMeters,
                              });
                            }}
                            sx={{ flex: 1, mx: 0.5 }}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ minWidth: 34, textAlign: 'right' }}
                          >
                            {meterFormatter.format(contourIntervalMeters)}
                          </Typography>
                        </Stack>
                      ) : null}
                    </Box>
                  );
                })}
              </FormGroup>
              {group.id === 'terrain' ? (
                <Box sx={{ mt: 1.5 }}>
                  <FormControlLabel
                    sx={{ m: 0 }}
                    slotProps={{ typography: { variant: 'body2' } }}
                    control={
                      <Checkbox
                        size="small"
                        sx={{ p: 0, mr: 1 }}
                        checked={
                          state.terrainOverlays.preferences.filterInvalidDemPixels
                        }
                        disabled={mapLayers === null || state.weatherMapEnabled}
                        onChange={(event) => {
                          changeTerrainOverlayPreferences({
                            ...state.terrainOverlays.preferences,
                            filterInvalidDemPixels: event.target.checked,
                          });
                        }}
                      />
                    }
                    label={t`Repair invalid DEM elevation pixels`}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', pl: 3.5, mt: 0.5 }}
                  >
                    <Trans>
                      Applies the same conservative repair to relief, 3D terrain, and
                      contours without smoothing valid terrain.
                    </Trans>
                  </Typography>
                </Box>
              ) : null}
            </Box>
          </Box>
        ))}
      </Stack>
      <Box aria-live="polite">
        {state.layerProblem === null ? null : (
          <Alert severity="warning">
            {i18n._(mapLayerProblemMessage(state.layerProblem))}
          </Alert>
        )}
      </Box>
    </Stack>
  );
}
