import TerrainOutlinedIcon from '@mui/icons-material/TerrainOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import {
  CircularProgress,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material';
import type { MouseEvent } from 'react';

import type { TerrainMode } from '@/presentation/map/mapTypes';

export type TerrainControlState =
  'flat' | 'enabling' | 'terrain' | 'disabling' | 'failed';

interface TerrainModeControlProps {
  readonly state: TerrainControlState;
  readonly onModeChange: (mode: TerrainMode) => void;
}

export function TerrainModeControl({ state, onModeChange }: TerrainModeControlProps) {
  const pending = state === 'enabling' || state === 'disabling';
  const selectedMode = state === 'terrain' || state === 'enabling' ? 'terrain' : 'flat';

  const handleChange = (_event: MouseEvent<HTMLElement>, value: TerrainMode | null) => {
    if (value !== null && !pending && value !== selectedMode) {
      onModeChange(value);
    }
  };

  return (
    <Paper elevation={2} sx={{ position: 'absolute', top: 12, left: 12, zIndex: 1 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        aria-label="Map dimension"
        value={selectedMode}
        onChange={handleChange}
      >
        <ToggleButton value="flat" aria-label="Show flat 2D map" disabled={pending}>
          <Tooltip title="Flat map">
            <span>
              {state === 'disabling' ? (
                <CircularProgress size={18} aria-hidden />
              ) : (
                <MapOutlinedIcon fontSize="small" />
              )}
              <span style={{ marginLeft: 6 }}>2D</span>
            </span>
          </Tooltip>
        </ToggleButton>
        <ToggleButton
          value="terrain"
          aria-label="Show 3D terrain map"
          disabled={pending}
        >
          <Tooltip title="3D terrain">
            <span>
              {state === 'enabling' ? (
                <CircularProgress size={18} aria-hidden />
              ) : (
                <TerrainOutlinedIcon fontSize="small" />
              )}
              <span style={{ marginLeft: 6 }}>3D</span>
            </span>
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>
    </Paper>
  );
}
