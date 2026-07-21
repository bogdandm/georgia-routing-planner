import {
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material';
import { useId } from 'react';

import type { SatelliteRenderingMode } from '@/application/ports/MapLayerPreferencesRepository';

interface SatelliteRenderingModeSelectProps {
  readonly mode: SatelliteRenderingMode;
  readonly onChange: (mode: SatelliteRenderingMode) => void;
}

/** Shared rendering-mode control used by Settings and the Satellite sidebar. */
export function SatelliteRenderingModeSelect({
  mode,
  onChange,
}: SatelliteRenderingModeSelectProps) {
  const labelId = useId();
  return (
    <FormControl size="small" fullWidth>
      <InputLabel id={labelId}>Satellite render</InputLabel>
      <Select
        labelId={labelId}
        label="Satellite render"
        value={mode}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <MenuItem value="auto">Auto</MenuItem>
        <MenuItem value="server">Server</MenuItem>
        <MenuItem value="browser">Browser</MenuItem>
      </Select>
      <FormHelperText>
        {mode === 'auto'
          ? 'Uses the server first and switches to browser rendering after rate-limit or CORS-hidden failures.'
          : mode === 'server'
            ? 'Uses only the hosted renderer. Rate-limit failures are not retried or rendered locally.'
            : 'Reads and renders imagery locally without contacting the hosted tile renderer.'}
      </FormHelperText>
    </FormControl>
  );
}
