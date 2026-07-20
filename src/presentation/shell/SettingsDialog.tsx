import {
  Alert,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import type { StorageUsageReader } from '@/application/ports/StorageUsageReader';
import {
  defaultSatelliteRenderingTuning,
  type SatelliteRenderingTuning,
} from '@/presentation/map/SatelliteImageryMap';
import { StorageUsagePanel } from '@/presentation/shell/StorageUsagePanel';
import {
  supportedContourIntervals,
  type TerrainOverlayPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';

type SettingsTab = 'general' | 'rendering' | 'storage';

interface SettingsDialogProps {
  readonly developerMode: boolean;
  readonly onClose: () => void;
  readonly onDeveloperModeChange: (value: boolean) => void;
  readonly onRenderingTuningChange: (value: SatelliteRenderingTuning) => void;
  readonly onRenderingTuningDraftChange: (value: SatelliteRenderingTuning) => void;
  readonly open: boolean;
  readonly renderingTuning: SatelliteRenderingTuning;
  readonly renderingTuningError: string | null;
  readonly renderingTuningPending: boolean;
  readonly storageUsage: StorageUsageReader;
  readonly terrainOverlayError: string | null;
  readonly terrainOverlayPreferences: TerrainOverlayPreferences;
  readonly onTerrainOverlayPreferencesChange: (
    value: TerrainOverlayPreferences,
  ) => void;
}

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

export function SettingsDialog({
  developerMode,
  onClose,
  onDeveloperModeChange,
  onRenderingTuningChange,
  onRenderingTuningDraftChange,
  open,
  renderingTuning,
  renderingTuningError,
  renderingTuningPending,
  storageUsage,
  terrainOverlayError,
  terrainOverlayPreferences,
  onTerrainOverlayPreferencesChange,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  if (!open) return null;

  return (
    <Paper
      role="dialog"
      aria-modal="false"
      aria-labelledby="settings-panel-title"
      elevation={8}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      sx={{
        position: 'fixed',
        zIndex: (theme) => theme.zIndex.modal,
        top: '50%',
        left: '50%',
        width: 'min(560px, calc(100vw - 24px))',
        maxHeight: 'calc(100dvh - 24px)',
        display: 'flex',
        flexDirection: 'column',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <DialogTitle id="settings-panel-title" sx={{ px: 2, py: 1.25 }}>
        Settings
      </DialogTitle>
      <Tabs
        value={activeTab}
        onChange={(_event, value: SettingsTab) => {
          setActiveTab(value);
        }}
        aria-label="Settings tabs"
        sx={{
          minHeight: 42,
          px: 1,
          borderTop: 1,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTabs-flexContainer': { gap: 0.25 },
          '& .MuiTab-root': {
            flex: '0 0 auto',
            minWidth: 0,
            minHeight: 42,
            mx: 0,
            mb: 0,
            px: 1.25,
            py: 1,
            borderRadius: 0,
            bgcolor: 'transparent',
            color: 'text.primary',
            fontSize: '0.875rem',
            fontWeight: 600,
            textTransform: 'none',
          },
          '& .MuiTab-root.Mui-selected': {
            bgcolor: 'transparent',
            color: 'primary.main',
          },
          '& .MuiTab-root.Mui-focusVisible': {
            outline: 'none',
            boxShadow: 'inset 0 -4px 0 rgba(33, 158, 188, 0.3)',
          },
          '& .MuiTabs-indicator': {
            height: 2,
            borderRadius: 0,
            bgcolor: 'info.main',
          },
        }}
      >
        <Tab disableRipple value="general" label="General" />
        <Tab disableRipple value="rendering" label="Rendering" />
        <Tab disableRipple value="storage" label="Storage" />
      </Tabs>

      <DialogContent sx={{ minHeight: 240, px: 2, py: 1.5 }}>
        {activeTab === 'general' ? (
          <Stack spacing={0.75} role="tabpanel" aria-label="General settings">
            <FormControlLabel
              sx={{ m: 0 }}
              control={
                <Switch
                  checked={developerMode}
                  onChange={(event) => {
                    onDeveloperModeChange(event.target.checked);
                  }}
                />
              }
              label="Enable developer diagnostics"
            />
            <Typography variant="body2" color="text.secondary">
              Exposes local logs, health checks, and diagnostics export. Nothing is
              uploaded automatically.
            </Typography>
          </Stack>
        ) : null}

        {activeTab === 'rendering' ? (
          <Stack spacing={1} role="tabpanel" aria-label="Rendering settings">
            <Box>
              <Typography component="h3" variant="subtitle2">
                Sentinel imagery stretch
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Stored locally. Release a slider to replace the active raster; lower
                ceilings brighten terrain but can clip bright snow.
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
                disabled={renderingTuningPending}
                onChange={(_event, value) => {
                  if (typeof value === 'number') {
                    onRenderingTuningDraftChange({
                      ...renderingTuning,
                      reflectanceMax: value,
                    });
                  }
                }}
                onChangeCommitted={(_event, value) => {
                  if (typeof value === 'number') {
                    onRenderingTuningChange({
                      ...renderingTuning,
                      reflectanceMax: value,
                    });
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
                disabled={renderingTuningPending}
                onChange={(_event, value) => {
                  if (typeof value === 'number') {
                    onRenderingTuningDraftChange({ ...renderingTuning, gamma: value });
                  }
                }}
                onChangeCommitted={(_event, value) => {
                  if (typeof value === 'number') {
                    onRenderingTuningChange({ ...renderingTuning, gamma: value });
                  }
                }}
              />
            </Box>

            <Box>
              <SliderLabel
                label="Saturation"
                value={renderingTuning.saturation.toFixed(2)}
              />
              <Slider
                aria-label="Sentinel saturation"
                min={0}
                max={5}
                step={0.05}
                value={renderingTuning.saturation}
                valueLabelDisplay="auto"
                disabled={renderingTuningPending}
                onChange={(_event, value) => {
                  if (typeof value === 'number') {
                    onRenderingTuningDraftChange({
                      ...renderingTuning,
                      saturation: value,
                    });
                  }
                }}
                onChangeCommitted={(_event, value) => {
                  if (typeof value === 'number') {
                    onRenderingTuningChange({ ...renderingTuning, saturation: value });
                  }
                }}
              />
            </Box>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button
                size="small"
                variant="outlined"
                disabled={renderingTuningPending}
                onClick={() => {
                  onRenderingTuningDraftChange(defaultSatelliteRenderingTuning);
                  onRenderingTuningChange(defaultSatelliteRenderingTuning);
                }}
              >
                Reset stretch
              </Button>
              {renderingTuningPending ? (
                <Typography variant="caption">Applying…</Typography>
              ) : null}
            </Stack>
            {renderingTuningError === null ? null : (
              <Alert severity="error">{renderingTuningError}</Alert>
            )}

            <Box sx={{ pt: 0.5 }}>
              <Typography component="h3" variant="subtitle2">
                Terrain overlays
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Minor contours use the selected spacing. Emphasized, labeled index
                contours remain every 200 m and appear from zoom 11.
              </Typography>
            </Box>

            <Box>
              <FormControlLabel
                sx={{ m: 0 }}
                control={
                  <Switch
                    checked={terrainOverlayPreferences.filterInvalidDemPixels}
                    onChange={(event) => {
                      onTerrainOverlayPreferencesChange({
                        ...terrainOverlayPreferences,
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
                Enabled by default. Applies the same conservative repair to relief, 3D
                terrain, and elevation isolines without smoothing valid terrain.
              </Typography>
            </Box>

            <FormControl size="small" fullWidth>
              <InputLabel id="contour-distance-label">Contour distance</InputLabel>
              <Select
                labelId="contour-distance-label"
                label="Contour distance"
                value={terrainOverlayPreferences.contourIntervalMeters}
                onChange={(event) => {
                  onTerrainOverlayPreferencesChange({
                    ...terrainOverlayPreferences,
                    contourIntervalMeters: event.target.value,
                  });
                }}
              >
                {supportedContourIntervals.map((interval) => (
                  <MenuItem key={interval} value={interval}>
                    {interval} m
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                Smaller distances show more minor lines while keeping 200 m labels.
              </FormHelperText>
            </FormControl>

            <Box>
              <FormControlLabel
                sx={{ m: 0 }}
                control={
                  <Switch
                    checked={terrainOverlayPreferences.shadeAboveSatellite}
                    onChange={(event) => {
                      onTerrainOverlayPreferencesChange({
                        ...terrainOverlayPreferences,
                        shadeAboveSatellite: event.target.checked,
                      });
                    }}
                  />
                }
                label="Show relief shading above satellite imagery"
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block' }}
              >
                When enabled, low-contrast terrain shadows remain visible over the
                selected satellite scene. Contours always stay above both.
              </Typography>
            </Box>
            {terrainOverlayError === null ? null : (
              <Alert severity="warning" role="status">
                {terrainOverlayError}
              </Alert>
            )}
          </Stack>
        ) : null}

        {activeTab === 'storage' ? (
          <Box role="tabpanel" aria-label="Storage usage settings">
            <StorageUsagePanel reader={storageUsage} />
          </Box>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 1.5, py: 0.75 }}>
        <Button size="small" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Paper>
  );
}
