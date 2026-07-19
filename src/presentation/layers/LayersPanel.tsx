import {
  Alert,
  Box,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Stack,
  Typography,
} from '@mui/material';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import type { LogicalMapLayerId } from '@/presentation/map/MapLayerVisibility';
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

const openStreetMapControls = [
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
    description: 'Settlements, peaks, water labels, and hiking places.',
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
      id: 'sentinel',
      title: `Copernicus Sentinel-2 via ${provider?.satellite.label ?? 'satellite catalog'}`,
      description: `Raster rendering by ${provider?.satellite.renderer.id ?? 'configured renderer'}.`,
      controls: sentinelControls,
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

  const changeVisibility = (layerId: LogicalMapLayerId, visible: boolean) => {
    mapLayers?.setLayerVisibility(layerId, visible);
  };

  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
      <Box>
        <Typography component="h2" variant="subtitle2">
          Map visibility
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Changes apply immediately and remain for this session.
        </Typography>
      </Box>
      {mapLayers === null ? (
        <Alert severity="error">Map layer controls are unavailable.</Alert>
      ) : null}
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
          <FormGroup aria-label={`${group.title} layers`} sx={{ mt: 0.5 }}>
            {group.controls.map((control) => {
              const disabled =
                mapLayers === null || (control.requiresScene && !sceneAvailable);
              return (
                <Box
                  key={control.id}
                  sx={{ py: 0.75, borderBottom: 1, borderColor: 'divider' }}
                >
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
      <Box aria-live="polite">
        {state.errorMessage === null ? null : (
          <Alert severity="warning">{state.errorMessage}</Alert>
        )}
      </Box>
    </Stack>
  );
}
