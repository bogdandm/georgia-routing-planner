import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  FormGroup,
  Paper,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import {
  defaultSatelliteRenderingTuning,
  type SatelliteRenderingTuning,
} from '@/presentation/map/SatelliteImageryMap';

interface SettingsDialogProps {
  readonly developerMode: boolean;
  readonly onClose: () => void;
  readonly onDeveloperModeChange: (value: boolean) => void;
  readonly onRenderingTuningChange: (value: SatelliteRenderingTuning) => void;
  readonly open: boolean;
  readonly renderingTuning: SatelliteRenderingTuning;
  readonly renderingTuningError: string | null;
  readonly renderingTuningPending: boolean;
}

export function SettingsDialog({
  developerMode,
  onClose,
  onDeveloperModeChange,
  onRenderingTuningChange,
  open,
  renderingTuning,
  renderingTuningError,
  renderingTuningPending,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState(renderingTuning);

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
        width: 'min(600px, calc(100vw - 32px))',
        maxHeight: 'calc(100dvh - 32px)',
        display: 'flex',
        flexDirection: 'column',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <DialogTitle id="settings-panel-title">Settings</DialogTitle>
      <DialogContent dividers>
        <FormGroup>
          <FormControlLabel
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
        </FormGroup>
        <Typography variant="body2" color="text.secondary">
          Developer mode exposes local logs, health checks, and diagnostics export. It
          never uploads data automatically.
        </Typography>

        <Divider sx={{ my: 2 }} />
        <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
          Sentinel imagery stretch
        </Typography>
        <Typography variant="body2" color="text.secondary">
          These values are stored locally and applied to the current and future Sentinel
          scenes. Release a slider to re-render; lower ceilings make terrain brighter
          but may clip the brightest snow.
        </Typography>
        <Stack spacing={1} sx={{ mt: 2 }}>
          <Typography variant="body2">
            Reflectance ceiling: {String(draft.reflectanceMax)}
          </Typography>
          <Slider
            aria-label="Sentinel reflectance ceiling"
            min={3_000}
            max={12_000}
            step={250}
            value={draft.reflectanceMax}
            valueLabelDisplay="auto"
            disabled={renderingTuningPending}
            onChange={(_event, value) => {
              if (typeof value === 'number')
                setDraft({ ...draft, reflectanceMax: value });
            }}
            onChangeCommitted={(_event, value) => {
              if (typeof value === 'number') {
                onRenderingTuningChange({ ...draft, reflectanceMax: value });
              }
            }}
          />
          <Typography variant="body2">Gamma: {draft.gamma.toFixed(2)}</Typography>
          <Slider
            aria-label="Sentinel gamma"
            min={0.5}
            max={3}
            step={0.05}
            value={draft.gamma}
            valueLabelDisplay="auto"
            disabled={renderingTuningPending}
            onChange={(_event, value) => {
              if (typeof value === 'number') setDraft({ ...draft, gamma: value });
            }}
            onChangeCommitted={(_event, value) => {
              if (typeof value === 'number') {
                onRenderingTuningChange({ ...draft, gamma: value });
              }
            }}
          />
          <Typography variant="body2">
            Saturation: {draft.saturation.toFixed(2)}
          </Typography>
          <Slider
            aria-label="Sentinel saturation"
            min={0}
            max={5}
            step={0.05}
            value={draft.saturation}
            valueLabelDisplay="auto"
            disabled={renderingTuningPending}
            onChange={(_event, value) => {
              if (typeof value === 'number') setDraft({ ...draft, saturation: value });
            }}
            onChangeCommitted={(_event, value) => {
              if (typeof value === 'number') {
                onRenderingTuningChange({ ...draft, saturation: value });
              }
            }}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              size="small"
              variant="outlined"
              disabled={renderingTuningPending}
              onClick={() => {
                setDraft(defaultSatelliteRenderingTuning);
                onRenderingTuningChange(defaultSatelliteRenderingTuning);
              }}
            >
              Reset imagery stretch
            </Button>
            {renderingTuningPending ? (
              <Typography variant="caption">Applying…</Typography>
            ) : null}
          </Stack>
          {renderingTuningError === null ? null : (
            <Alert severity="error">{renderingTuningError}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Paper>
  );
}
