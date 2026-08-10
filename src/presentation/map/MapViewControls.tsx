import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import {
  Box,
  CircularProgress,
  Menu,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material';
import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { useId, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useControl } from 'react-map-gl/maplibre';

import googleSatelliteHybridPreview from '@/presentation/map/layer-previews/google-satellite-hybrid.png';
import googleSatellitePreview from '@/presentation/map/layer-previews/google-satellite.png';
import naprOrthophotoHybridPreview from '@/presentation/map/layer-previews/napr-orthophoto-hybrid.png';
import naprOrthophotoPreview from '@/presentation/map/layer-previews/napr-orthophoto.png';
import sentinel2HybridPreview from '@/presentation/map/layer-previews/sentinel-2-hybrid.png';
import type { MapLayerPreset, TerrainMode } from '@/presentation/map/mapTypes';
import vectorOsmPreview from '@/presentation/map/layer-previews/vector-osm.png';

export type TerrainControlState =
  'flat' | 'enabling' | 'terrain' | 'disabling' | 'failed';

interface MapViewControlsProps {
  readonly terrainState: TerrainControlState;
  readonly activeLayerPreset: MapLayerPreset | null;
  readonly layerPresetDisabled: boolean;
  readonly onTerrainModeChange: (mode: TerrainMode) => void;
  readonly onLayerPresetChange: (preset: MapLayerPreset) => boolean;
}

const layerPresets: readonly {
  readonly label: string;
  readonly preview: string;
  readonly value: MapLayerPreset;
}[] = [
  {
    label: 'Vector OSM',
    preview: vectorOsmPreview,
    value: 'vector-osm',
  },
  {
    label: 'Google Satellite Hybrid',
    preview: googleSatelliteHybridPreview,
    value: 'google-satellite-hybrid',
  },
  {
    label: 'Google Satellite',
    preview: googleSatellitePreview,
    value: 'google-satellite',
  },
  {
    label: 'NAPR Orthophoto Hybrid',
    preview: naprOrthophotoHybridPreview,
    value: 'napr-orthophoto-hybrid',
  },
  {
    label: 'NAPR Orthophoto',
    preview: naprOrthophotoPreview,
    value: 'napr-orthophoto',
  },
  {
    label: 'Sentinel-2 Hybrid',
    preview: sentinel2HybridPreview,
    value: 'sentinel-2-hybrid',
  },
];

class MapViewControlHost implements IControl {
  readonly element: HTMLDivElement = document.createElement('div');

  constructor() {
    this.element.className = 'maplibregl-ctrl map-view-controls-control';
  }

  onAdd(_map: MapLibreMap): HTMLElement {
    return this.element;
  }

  onRemove(): void {
    this.element.remove();
  }
}

export function MapViewControls({
  terrainState,
  activeLayerPreset,
  layerPresetDisabled,
  onTerrainModeChange,
  onLayerPresetChange,
}: MapViewControlsProps) {
  const [menuButton, setMenuButton] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const pending = terrainState === 'enabling' || terrainState === 'disabling';
  const selectedMode =
    terrainState === 'terrain' || terrainState === 'enabling' ? 'terrain' : 'flat';
  const menuOpen = menuButton !== null;

  const handleTerrainModeChange = (
    _event: MouseEvent<HTMLElement>,
    value: TerrainMode | null,
  ) => {
    if (value !== null && !pending && value !== selectedMode) {
      onTerrainModeChange(value);
    }
  };

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          borderRadius: '0 0 10px 10px',
          overflow: 'hidden',
          width: 40,
        }}
      >
        <ToggleButtonGroup
          exclusive
          orientation="vertical"
          size="small"
          aria-label="Map dimension"
          value={selectedMode}
          onChange={handleTerrainModeChange}
          sx={{
            '& .MuiToggleButtonGroup-firstButton': {
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
            },
            '& .MuiToggleButtonGroup-lastButton': {
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
            },
          }}
        >
          <ToggleButton
            value="flat"
            aria-label="Show flat 2D map"
            disabled={pending}
            sx={{ width: 40, height: 36, p: 0 }}
          >
            <Tooltip title="Flat map">
              <span>
                {terrainState === 'disabling' ? (
                  <CircularProgress size={18} aria-hidden />
                ) : (
                  '2D'
                )}
              </span>
            </Tooltip>
          </ToggleButton>
          <ToggleButton
            value="terrain"
            aria-label="Show 3D terrain map"
            disabled={pending}
            sx={{ width: 40, height: 36, p: 0 }}
          >
            <Tooltip title="3D terrain">
              <span>
                {terrainState === 'enabling' ? (
                  <CircularProgress size={18} aria-hidden />
                ) : (
                  '3D'
                )}
              </span>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Choose map layer preset">
          <span>
            <ToggleButton
              aria-controls={menuOpen ? menuId : undefined}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Choose map layer preset"
              disabled={layerPresetDisabled}
              onClick={(event) => {
                setMenuButton(event.currentTarget);
              }}
              sx={{ borderRadius: 0, mt: '-1px', width: 40, height: 36, p: 0 }}
              value="layer-preset"
            >
              <LayersOutlinedIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>
      </Paper>
      <Menu
        anchorEl={menuButton}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        id={menuId}
        onClose={() => {
          setMenuButton(null);
        }}
        open={menuOpen}
        slotProps={{ paper: { sx: { ml: -1 } } }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        variant="menu"
      >
        {layerPresets.map((preset) => (
          <MenuItem
            aria-checked={activeLayerPreset === preset.value}
            key={preset.value}
            onClick={() => {
              onLayerPresetChange(preset.value);
            }}
            role="menuitemradio"
            selected={activeLayerPreset === preset.value}
            sx={{ minWidth: 300 }}
          >
            <ListItemIcon sx={{ minWidth: 96, mr: 2 }}>
              <Box
                alt=""
                component="img"
                src={preset.preview}
                sx={{ borderRadius: 1, height: 96, width: 96 }}
              />
            </ListItemIcon>
            <ListItemText primary={preset.label} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function MapViewControlsControl(props: MapViewControlsProps) {
  const host = useControl(() => new MapViewControlHost(), {
    position: 'top-right',
  });

  return createPortal(<MapViewControls {...props} />, host.element);
}
