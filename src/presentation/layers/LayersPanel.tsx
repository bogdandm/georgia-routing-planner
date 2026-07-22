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
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { LogicalMapLayerId } from '@/application/ports/MapLayerPreferencesRepository';
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

const importedTrackControls = [
  {
    id: 'imported-tracks',
    label: 'Imported tracks',
    description: 'The active local GPX preview or saved track.',
    requiresScene: false,
  },
] as const satisfies readonly LayerControl[];

export function LayersPanel() {
  const { mapLayers, mapProviderConfiguration } = useRuntimeServices();
  const state = useStore(mapLayerStore);
  const provider =
    mapProviderConfiguration.status === 'valid' ? mapProviderConfiguration.value : null;
  const groups = [
    {
      id: 'imported-tracks',
      title: 'Local GPX',
      description: 'Tracks retained only in this browser.',
      controls: importedTrackControls,
    },
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

  const changeImportedTrackOpacity = (_event: Event, value: number | number[]) => {
    if (typeof value === 'number') mapLayers?.setImportedTrackOpacity(value / 100);
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
            {group.id === 'imported-tracks' ? (
              <Stack
                direction="row"
                spacing={1.25}
                sx={{ mt: 1, px: 0.25, alignItems: 'center' }}
              >
                <Typography id="imported-tracks-opacity-label" variant="body2">
                  Track opacity
                </Typography>
                <Slider
                  aria-labelledby="imported-tracks-opacity-label"
                  disabled={mapLayers === null}
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(state.importedTrackOpacity * 100)}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${String(value)}%`}
                  onChange={changeImportedTrackOpacity}
                  sx={{ flex: 1, mx: 0.5 }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ minWidth: 4, pl: 0.75, textAlign: 'right' }}
                >
                  {Math.round(state.importedTrackOpacity * 100)}%
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
