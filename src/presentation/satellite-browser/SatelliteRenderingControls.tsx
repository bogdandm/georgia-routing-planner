import { Trans, useLingui } from '@lingui/react/macro';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
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
import {
  mapLayerStore,
  type SatelliteImageryProblem,
} from '@/presentation/map/mapLayerStore';
import { satelliteImageryProblemMessage } from '@/presentation/satellite-browser/satelliteProblemMessages';

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

interface SatelliteRenderModeSelectProps {
  readonly disabled?: boolean;
  readonly onPendingChange?: (pending: boolean) => void;
}

export function SatelliteRenderModeSelect({
  disabled = false,
  onPendingChange,
}: SatelliteRenderModeSelectProps) {
  const { i18n, t } = useLingui();
  const { mapLayers } = useRuntimeServices();
  const labelId = useId();
  const renderingMode = useStore(
    mapLayerStore,
    (state) => state.satelliteRenderingMode,
  );
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<SatelliteImageryProblem | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      const activeRequest = request.current;
      request.current = null;
      activeRequest?.abort();
    },
    [],
  );

  const setRequestPending = (nextPending: boolean) => {
    setPending(nextPending);
    onPendingChange?.(nextPending);
  };

  const changeRenderingMode = (mode: SatelliteRenderingMode) => {
    if (mapLayers === null) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRequestPending(true);
    setProblem(null);
    void mapLayers.setRenderingMode(mode, controller.signal).then((result) => {
      if (result.status === 'failed') setProblem(result.problem);
      if (request.current === controller) {
        request.current = null;
        setRequestPending(false);
      }
    });
  };

  return (
    <Stack spacing={1}>
      <FormControl
        size="small"
        fullWidth
        disabled={disabled || pending || mapLayers === null}
      >
        <InputLabel id={labelId}>
          <Trans>Satellite render</Trans>
        </InputLabel>
        <Select
          labelId={labelId}
          label={t`Satellite render`}
          value={renderingMode}
          onChange={(event) => {
            changeRenderingMode(event.target.value);
          }}
        >
          <MenuItem value="auto">
            <Trans>Auto</Trans>
          </MenuItem>
          <MenuItem value="server">
            <Trans>Server</Trans>
          </MenuItem>
          <MenuItem value="direct">
            <Trans>Direct</Trans>
          </MenuItem>
        </Select>
        <FormHelperText>
          {renderingMode === 'auto'
            ? t`Uses TiTiler first and switches to direct pre-rendered Sentinel imagery when it is unavailable.`
            : renderingMode === 'server'
              ? t`Uses only TiTiler. Provider failures do not switch to direct imagery.`
              : t`Reads the pre-rendered 8-bit Sentinel visual asset without contacting TiTiler.`}
        </FormHelperText>
      </FormControl>
      {problem === null ? null : (
        <Alert severity="error">
          {i18n._(satelliteImageryProblemMessage(problem))}
        </Alert>
      )}
    </Stack>
  );
}

export function SatelliteRenderingControls() {
  const { i18n, t } = useLingui();
  const { mapLayers } = useRuntimeServices();
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
  const [modePending, setModePending] = useState(false);
  const [renderingProblem, setRenderingProblem] =
    useState<SatelliteImageryProblem | null>(null);
  const [terrainOverlayFailed, setTerrainOverlayFailed] = useState(false);
  const renderingRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      renderingRequest.current?.abort();
    },
    [],
  );

  const commitRenderingTuning = (tuning: SatelliteRenderingTuning) => {
    setRenderingTuningDraft(tuning);
    if (mapLayers === null) return;
    renderingRequest.current?.abort();
    const controller = new AbortController();
    renderingRequest.current = controller;
    setRenderingPending(true);
    setRenderingProblem(null);
    void mapLayers.setRenderingTuning(tuning, controller.signal).then((result) => {
      if (result.status === 'failed') setRenderingProblem(result.problem);
      if (renderingRequest.current === controller) {
        renderingRequest.current = null;
        setRenderingPending(false);
        setRenderingTuningDraft(null);
      }
    });
  };

  const controlsPending = renderingPending || modePending;
  const reflectanceFormatter = new Intl.NumberFormat(i18n.locale);
  const ratioFormatter = new Intl.NumberFormat(i18n.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formatReflectance = (value: number) => reflectanceFormatter.format(value);
  const formatRatio = (value: number) => ratioFormatter.format(value);

  return (
    <Stack spacing={1.5}>
      <SatelliteRenderModeSelect
        disabled={renderingPending}
        onPendingChange={setModePending}
      />

      {renderingProblem === null ? null : (
        <Alert severity="error">
          {i18n._(satelliteImageryProblemMessage(renderingProblem))}
        </Alert>
      )}

      <Box>
        <FormControlLabel
          sx={{ m: 0 }}
          slotProps={{ typography: { variant: 'body2' } }}
          control={
            <Checkbox
              size="small"
              sx={{ p: 0, mr: 1 }}
              checked={terrainOverlayPreferences.shadeAboveSatellite}
              disabled={mapLayers === null || controlsPending}
              onChange={(event) => {
                if (mapLayers === null) return;
                const result = mapLayers.setTerrainOverlayPreferences({
                  ...terrainOverlayPreferences,
                  shadeAboveSatellite: event.target.checked,
                });
                setTerrainOverlayFailed(result.status === 'failed');
              }}
            />
          }
          label={t`Show relief shading above satellite imagery`}
        />
      </Box>
      {terrainOverlayFailed ? (
        <Alert severity="warning" role="status">
          <Trans>Relief shading could not be updated. Try again.</Trans>
        </Alert>
      ) : null}

      <Accordion
        disableGutters
        elevation={0}
        sx={{
          borderBlock: 1,
          borderColor: 'divider',
          '&::before': { display: 'none' },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{ px: 0, minHeight: 44, '& .MuiAccordionSummary-content': { my: 1 } }}
        >
          <Typography component="h3" variant="subtitle2">
            <Trans>Sentinel imagery stretch</Trans>
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0, pt: 0 }}>
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              <Trans>
                Stored locally. Release a slider to replace the active raster; lower
                ceilings brighten terrain but can clip bright snow.
              </Trans>
            </Typography>

            <Box>
              <SliderLabel
                label={t`Reflectance ceiling`}
                value={formatReflectance(renderingTuning.reflectanceMax)}
              />
              <Slider
                aria-label={t`Sentinel reflectance ceiling`}
                min={3_000}
                max={12_000}
                step={250}
                value={renderingTuning.reflectanceMax}
                valueLabelDisplay="auto"
                valueLabelFormat={formatReflectance}
                disabled={mapLayers === null || controlsPending}
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
                    commitRenderingTuning({
                      ...renderingTuning,
                      reflectanceMax: value,
                    });
                  }
                }}
              />
            </Box>

            <Box>
              <SliderLabel
                label={t`Gamma`}
                value={formatRatio(renderingTuning.gamma)}
              />
              <Slider
                aria-label={t`Sentinel gamma`}
                min={0.5}
                max={3}
                step={0.05}
                value={renderingTuning.gamma}
                valueLabelDisplay="auto"
                valueLabelFormat={formatRatio}
                disabled={mapLayers === null || controlsPending}
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
              <SliderLabel
                label={t`Saturation`}
                value={formatRatio(renderingTuning.saturation)}
              />
              <Slider
                aria-label={t`Sentinel saturation`}
                min={0}
                max={5}
                step={0.05}
                value={renderingTuning.saturation}
                valueLabelDisplay="auto"
                valueLabelFormat={formatRatio}
                disabled={mapLayers === null || controlsPending}
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
                disabled={mapLayers === null || controlsPending}
                onClick={() => {
                  setRenderingTuningDraft(defaultSatelliteRenderingTuning);
                  commitRenderingTuning(defaultSatelliteRenderingTuning);
                }}
              >
                <Trans>Reset stretch</Trans>
              </Button>
              {renderingPending ? (
                <Typography variant="caption">
                  <Trans>Applying…</Trans>
                </Typography>
              ) : null}
            </Stack>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}
