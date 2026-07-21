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
        <MenuItem value="direct">Direct</MenuItem>
      </Select>
      <FormHelperText>
        {mode === 'auto'
          ? 'Uses TiTiler first and switches to direct pre-rendered Sentinel imagery when it is unavailable.'
          : mode === 'server'
            ? 'Uses only TiTiler. Provider failures do not switch to direct imagery.'
            : 'Reads the pre-rendered 8-bit Sentinel visual asset without contacting TiTiler.'}
      </FormHelperText>
    </FormControl>
  );
}
