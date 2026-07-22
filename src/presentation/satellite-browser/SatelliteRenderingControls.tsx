import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';

import {
  defaultSatelliteRenderingTuning,
  type SatelliteRenderingMode,
  type SatelliteRenderingTuning,
} from '@/application/ports/MapLayerPreferencesRepository';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';

function SliderLabel({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2">{label}</Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

export function SatelliteRenderingControls() {
  const { mapLayers } = useRuntimeServices();
  const labelId = useId();
  const renderingMode = useStore(
    mapLayerStore,
    (state) => state.satelliteRenderingMode,
  );
  const persistedTuning = useStore(
    mapLayerStore,
    (state) => state.satelliteRenderingTuning,
  );
  const terrainOverlayPreferences = useStore(
    mapLayerStore,
    (state) => state.terrainOverlays.preferences,
  );
  const [renderingTuningDraft, setRenderingTuningDraft] =
    useState<SatelliteRenderingTuning | null>(null);
  const renderingTuning = renderingTuningDraft ?? persistedTuning;
  const [renderingPending, setRenderingPending] = useState(false);
  const [renderingError, setRenderingError] = useState<string | null>(null);
  const [terrainOverlayError, setTerrainOverlayError] = useState<string | null>(null);
  const renderingRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      renderingRequest.current?.abort();
    },
    [],
  );

  const changeRenderingMode = (mode: SatelliteRenderingMode) => {
    if (mapLayers === null) return;
    renderingRequest.current?.abort();
    const controller = new AbortController();
    renderingRequest.current = controller;
    setRenderingPending(true);
    setRenderingError(null);
    void mapLayers.setRenderingMode(mode, controller.signal).then((result) => {
      if (result.status === 'failed') setRenderingError(result.message);
      if (renderingRequest.current === controller) {
        renderingRequest.current = null;
        setRenderingPending(false);
        setRenderingTuningDraft(null);
      }
    });
  };

  const commitRenderingTuning = (tuning: SatelliteRenderingTuning) => {
    setRenderingTuningDraft(tuning);
    if (mapLayers === null) return;
    renderingRequest.current?.abort();
    const controller = new AbortController();
    renderingRequest.current = controller;
    setRenderingPending(true);
    setRenderingError(null);
    void mapLayers.setRenderingTuning(tuning, controller.signal).then((result) => {
      if (result.status === 'failed') {
        setRenderingError(result.message);
      }
      if (renderingRequest.current === controller) {
        renderingRequest.current = null;
        setRenderingPending(false);
        setRenderingTuningDraft(null);
      }
    });
  };

  return (
    <Stack spacing={1}>
      <FormControl size="small" fullWidth disabled={mapLayers === null}>
        <InputLabel id={labelId}>Satellite render</InputLabel>
        <Select
          labelId={labelId}
          label="Satellite render"
          value={renderingMode}
          onChange={(event) => {
            changeRenderingMode(event.target.value);
          }}
        >
          <MenuItem value="auto">Auto</MenuItem>
          <MenuItem value="server">Server</MenuItem>
          <MenuItem value="direct">Direct</MenuItem>
        </Select>
        <FormHelperText>
          {renderingMode === 'auto'
            ? 'Uses TiTiler first and switches to direct pre-rendered Sentinel imagery when it is unavailable.'
            : renderingMode === 'server'
              ? 'Uses only TiTiler. Provider failures do not switch to direct imagery.'
              : 'Reads the pre-rendered 8-bit Sentinel visual asset without contacting TiTiler.'}
        </FormHelperText>
      </FormControl>

      <Box sx={{ pt: 0.5 }}>
        <Typography component="h3" variant="subtitle2">
          Sentinel imagery stretch
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Stored locally. Release a slider to replace the active raster; lower ceilings
          brighten terrain but can clip bright snow.
        </Typography>
      </Box>

      <Box>
        <SliderLabel
          label="Reflectance ceiling"
          value={String(renderingTuning.reflectanceMax)}
        />
        <Slider
          aria-label="Sentinel reflectance ceiling"
          min={3_000}
          max={12_000}
          step={250}
          value={renderingTuning.reflectanceMax}
          valueLabelDisplay="auto"
          disabled={mapLayers === null || renderingPending}
          onChange={(_event, value) => {
            if (typeof value === 'number') {
              setRenderingTuningDraft({
                ...renderingTuning,
                reflectanceMax: value,
              });
            }
          }}
          onChangeCommitted={(_event, value) => {
            if (typeof value === 'number') {
              commitRenderingTuning({ ...renderingTuning, reflectanceMax: value });
            }
          }}
        />
      </Box>

      <Box>
        <SliderLabel label="Gamma" value={renderingTuning.gamma.toFixed(2)} />
        <Slider
          aria-label="Sentinel gamma"
          min={0.5}
          max={3}
          step={0.05}
          value={renderingTuning.gamma}
          valueLabelDisplay="auto"
          disabled={mapLayers === null || renderingPending}
          onChange={(_event, value) => {
            if (typeof value === 'number') {
              setRenderingTuningDraft({ ...renderingTuning, gamma: value });
            }
          }}
          onChangeCommitted={(_event, value) => {
            if (typeof value === 'number') {
              commitRenderingTuning({ ...renderingTuning, gamma: value });
            }
          }}
        />
      </Box>

      <Box>
        <SliderLabel label="Saturation" value={renderingTuning.saturation.toFixed(2)} />
        <Slider
          aria-label="Sentinel saturation"
          min={0}
          max={5}
          step={0.05}
          value={renderingTuning.saturation}
          valueLabelDisplay="auto"
          disabled={mapLayers === null || renderingPending}
          onChange={(_event, value) => {
            if (typeof value === 'number') {
              setRenderingTuningDraft({ ...renderingTuning, saturation: value });
            }
          }}
          onChangeCommitted={(_event, value) => {
            if (typeof value === 'number') {
              commitRenderingTuning({ ...renderingTuning, saturation: value });
            }
          }}
        />
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          variant="outlined"
          disabled={mapLayers === null || renderingPending}
          onClick={() => {
            setRenderingTuningDraft(defaultSatelliteRenderingTuning);
            commitRenderingTuning(defaultSatelliteRenderingTuning);
          }}
        >
          Reset stretch
        </Button>
        {renderingPending ? <Typography variant="caption">Applying…</Typography> : null}
      </Stack>
      {renderingError === null ? null : (
        <Alert severity="error">{renderingError}</Alert>
      )}

      <Box sx={{ pt: 0.5 }}>
        <FormControlLabel
          sx={{ m: 0 }}
          control={
            <Switch
              checked={terrainOverlayPreferences.shadeAboveSatellite}
              disabled={mapLayers === null}
              onChange={(event) => {
                if (mapLayers === null) return;
                const result = mapLayers.setTerrainOverlayPreferences({
                  ...terrainOverlayPreferences,
                  shadeAboveSatellite: event.target.checked,
                });
                setTerrainOverlayError(
                  result.status === 'failed' ? result.message : null,
                );
              }}
            />
          }
          label="Show relief shading above satellite imagery"
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Keeps low-contrast terrain shadows visible over the selected satellite scene.
          Contours always stay above both.
        </Typography>
      </Box>
      {terrainOverlayError === null ? null : (
        <Alert severity="warning" role="status">
          {terrainOverlayError}
        </Alert>
      )}
    </Stack>
  );
}
