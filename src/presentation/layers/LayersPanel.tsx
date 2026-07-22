import {
  Alert,
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  FormGroup,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  supportedContourIntervals,
  type LogicalMapLayerId,
  type TerrainOverlayPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';

interface LayerControl {
  readonly id: LogicalMapLayerId;
  readonly label: string;
  readonly description: string;
  readonly requiresScene: boolean;
}

const sentinelControls = [
  {
    id: 'satellite-imagery',
    label: 'Satellite imagery',
    description: 'The applied Sentinel true-color scene.',
    requiresScene: true,
  },
  {
    id: 'scene-footprint',
    label: 'Scene footprint',
    description: 'The actual boundary of the applied scene.',
    requiresScene: true,
  },
] as const satisfies readonly LayerControl[];

const naturalFeatureControls = [
  {
    id: 'natural-features',
    label: 'Natural features',
    description: 'Vegetation, glaciers, wetlands, rivers, and water bodies.',
    requiresScene: false,
  },
] as const satisfies readonly LayerControl[];

const navigationAndAccessControls = [
  {
    id: 'restricted-areas',
    label: 'Restricted areas',
    description: 'Red perimeters for provider-identified military land.',
    requiresScene: false,
  },
  {
    id: 'hiking-paths',
    label: 'Hiking paths',
    description: 'Paths, tracks, footways, and steps.',
    requiresScene: false,
  },
  {
    id: 'roads',
    label: 'Roads',
    description: 'Road lines, casings, and labels.',
    requiresScene: false,
  },
  {
    id: 'places-and-pois',
    label: 'Places and POIs',
    description: 'Settlements, peaks, and hiking places.',
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
    label: 'Relief shading',
    description: 'Hillshade derived from the configured elevation tiles.',
    requiresScene: false,
  },
  {
    id: 'elevation-isolines',
    label: 'Elevation isolines',
    description: 'Generated contour lines and labeled index elevations.',
    requiresScene: false,
  },
] as const satisfies readonly LayerControl[];

export function LayersPanel() {
  const { mapLayers, mapProviderConfiguration } = useRuntimeServices();
  const state = useStore(mapLayerStore);
  const [terrainOverlayCommandError, setTerrainOverlayCommandError] = useState<
    string | null
  >(null);
  const provider =
    mapProviderConfiguration.status === 'valid' ? mapProviderConfiguration.value : null;
  const groups = [
    {
      id: 'sentinel',
      title: `Copernicus Sentinel-2 via ${provider?.satellite.label ?? 'satellite catalog'}`,
      description: `Raster rendering by ${provider?.satellite.renderer.id ?? 'configured renderer'}.`,
      controls: sentinelControls,
    },
    {
      id: 'terrain',
      title: provider?.terrain.label ?? 'Terrain elevation',
      description: 'Elevation tiles for relief, contours, and 3D terrain.',
      controls: terrainControls,
    },
    {
      id: 'openstreetmap',
      title: `OpenStreetMap via ${provider?.vector.label ?? 'vector tile provider'}`,
      description: 'Vector basemap data styled for hiking and navigation.',
      controls: openStreetMapControls,
    },
  ] as const;
  const sceneAvailable =
    state.appliedImagery.status === 'ready' ||
    state.appliedImagery.status === 'preview' ||
    state.appliedImagery.status === 'hidden' ||
    (state.appliedImagery.status === 'failed' &&
      state.appliedImagery.previousSceneKey !== null);
  const satelliteImageryVisible =
    state.appliedImagery.status === 'ready' ||
    state.appliedImagery.status === 'preview' ||
    ((state.appliedImagery.status === 'loading' ||
      state.appliedImagery.status === 'failed') &&
      state.appliedImagery.previousSceneKey !== null);

  const changeVisibility = (layerId: LogicalMapLayerId, visible: boolean) => {
    mapLayers?.setLayerVisibility(layerId, visible);
  };

  const changeOpenStreetMapOpacity = (_event: Event, value: number | number[]) => {
    if (typeof value === 'number') mapLayers?.setOpenStreetMapOpacity(value / 100);
  };

  const changeTerrainOverlayPreferences = (value: TerrainOverlayPreferences) => {
    if (mapLayers === null) return;
    const result = mapLayers.setTerrainOverlayPreferences(value);
    setTerrainOverlayCommandError(result.status === 'failed' ? result.message : null);
  };

  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
      {mapLayers === null ? (
        <Alert severity="error">Map layer controls are unavailable.</Alert>
      ) : null}
      <Stack spacing={1.5} divider={<Divider flexItem />}>
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
            <Typography variant="caption" color="text.secondary">
              {group.description}
            </Typography>
            {group.id === 'terrain' ? (
              <Stack spacing={0.75} sx={{ mt: 1 }}>
                {state.terrainComputeStatus === 'inline' ? (
                  <Alert severity="warning">
                    Terrain processing is running in compatibility mode. Terrain
                    features remain available, but map movement may be slower.
                  </Alert>
                ) : null}
                <Box>
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={
                      <Switch
                        checked={
                          state.terrainOverlays.preferences.filterInvalidDemPixels
                        }
                        disabled={mapLayers === null}
                        onChange={(event) => {
                          changeTerrainOverlayPreferences({
                            ...state.terrainOverlays.preferences,
                            filterInvalidDemPixels: event.target.checked,
                          });
                        }}
                      />
                    }
                    label="Repair invalid DEM elevation pixels"
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block' }}
                  >
                    Applies the same conservative repair to relief, 3D terrain, and
                    contours without smoothing valid terrain.
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={1.25}
                  sx={{ px: 0.25, alignItems: 'center' }}
                >
                  <Typography
                    id="contour-distance-label"
                    variant="body2"
                    sx={{ minWidth: 104 }}
                  >
                    Contour distance
                  </Typography>
                  <Slider
                    aria-labelledby="contour-distance-label"
                    aria-valuetext={`${String(state.terrainOverlays.preferences.contourIntervalMeters)} metres`}
                    disabled={mapLayers === null}
                    min={0}
                    max={supportedContourIntervals.length - 1}
                    step={1}
                    marks={supportedContourIntervals.map((_value, index) => ({
                      value: index,
                    }))}
                    value={supportedContourIntervals.indexOf(
                      state.terrainOverlays.preferences.contourIntervalMeters,
                    )}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(value) =>
                      `${String(supportedContourIntervals[value])} m`
                    }
                    onChange={(_event, value) => {
                      if (typeof value !== 'number') return;
                      const contourIntervalMeters = supportedContourIntervals[value];
                      if (contourIntervalMeters === undefined) return;
                      changeTerrainOverlayPreferences({
                        ...state.terrainOverlays.preferences,
                        contourIntervalMeters,
                      });
                    }}
                    sx={{ flex: 1, mx: 0.5 }}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ minWidth: 34, textAlign: 'right' }}
                  >
                    {state.terrainOverlays.preferences.contourIntervalMeters} m
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Smaller distances show more minor lines; labeled index contours remain
                  every 200 m.
                </Typography>
                {(terrainOverlayCommandError ?? state.terrainOverlays.message) ? (
                  <Alert severity="warning" role="status">
                    {terrainOverlayCommandError ?? state.terrainOverlays.message}
                  </Alert>
                ) : null}
              </Stack>
            ) : null}
            {group.id === 'openstreetmap' ? (
              <Stack
                direction="row"
                spacing={1.25}
                sx={{ mt: 1, px: 0.25, alignItems: 'center' }}
              >
                <Typography id="openstreetmap-opacity-label" variant="body2">
                  Opacity
                </Typography>
                <Slider
                  aria-labelledby="openstreetmap-opacity-label"
                  disabled={mapLayers === null || !satelliteImageryVisible}
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(state.openStreetMapOpacity * 100)}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${String(value)}%`}
                  onChange={changeOpenStreetMapOpacity}
                  sx={{ flex: 1, mx: 0.5 }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ minWidth: 4, pl: 0.75, textAlign: 'right' }}
                >
                  {Math.round(state.openStreetMapOpacity * 100)}%
                </Typography>
              </Stack>
            ) : null}
            <FormGroup aria-label={`${group.title} layers`} sx={{ mt: 0.5 }}>
              {group.controls.map((control) => {
                const disabled =
                  mapLayers === null || (control.requiresScene && !sceneAvailable);
                return (
                  <Box key={control.id} sx={{ py: 0.75 }}>
                    <FormControlLabel
                      disabled={disabled}
                      control={
                        <Checkbox
                          checked={state.visibility[control.id]}
                          onChange={(event) => {
                            changeVisibility(control.id, event.target.checked);
                          }}
                        />
                      }
                      label={control.label}
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', pl: 4.75, mt: -0.75 }}
                    >
                      {control.requiresScene && !sceneAvailable
                        ? 'Apply a Sentinel scene to enable this layer.'
                        : control.description}
                    </Typography>
                  </Box>
                );
              })}
            </FormGroup>
          </Box>
        ))}
      </Stack>
      <Box aria-live="polite">
        {state.errorMessage === null ? null : (
          <Alert severity="warning">{state.errorMessage}</Alert>
        )}
      </Box>
    </Stack>
  );
}
