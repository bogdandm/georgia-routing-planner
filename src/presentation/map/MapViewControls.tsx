import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import {
  CircularProgress,
  ListItemIcon,
  ListItemText,
  Menu,
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

import type { MapLayerPreset, TerrainMode } from '@/presentation/map/mapTypes';

export type TerrainControlState =
  'flat' | 'enabling' | 'terrain' | 'disabling' | 'failed';

interface MapViewControlsProps {
  readonly terrainState: TerrainControlState;
  readonly terrainDisabled: boolean;
  readonly activeLayerPreset: MapLayerPreset | null;
  readonly layerPresetDisabled: boolean;
  readonly hybridOverlayEnabled: boolean;
  readonly hybridOverlayDisabled: boolean;
  readonly onTerrainModeChange: (mode: TerrainMode) => void;
  readonly onLayerPresetChange: (preset: MapLayerPreset) => boolean;
  readonly onHybridOverlayChange: (enabled: boolean) => void;
  readonly onOpenLayersTab: () => void;
}

const layerPresets: readonly {
  readonly label: string;
  readonly value: MapLayerPreset;
}[] = [
  { label: 'Vector OSM', value: 'vector-osm' },
  { label: 'Google Satellite', value: 'google-satellite' },
  { label: 'Bing Aerial', value: 'bing-satellite' },
  { label: 'Esri World Imagery', value: 'esri-satellite' },
  { label: 'NAPR Orthophoto', value: 'napr-orthophoto' },
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
  terrainDisabled,
  activeLayerPreset,
  layerPresetDisabled,
  hybridOverlayEnabled,
  hybridOverlayDisabled,
  onTerrainModeChange,
  onLayerPresetChange,
  onHybridOverlayChange,
  onOpenLayersTab,
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
    if (
      value !== null &&
      !pending &&
      !(terrainDisabled && value === 'terrain') &&
      value !== selectedMode
    ) {
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
          <Tooltip
            title={
              terrainDisabled
                ? '3D terrain is unavailable while Sentinel Mosaic is active.'
                : '3D terrain'
            }
          >
            <span>
              <ToggleButton
                value="terrain"
                aria-label="Show 3D terrain map"
                disabled={pending || terrainDisabled}
                sx={{ width: 40, height: 36, p: 0 }}
              >
                <span>
                  {terrainState === 'enabling' ? (
                    <CircularProgress size={18} aria-hidden />
                  ) : (
                    '3D'
                  )}
                </span>
              </ToggleButton>
            </span>
          </Tooltip>
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
        slotProps={{
          list: { sx: { pb: 0 } },
          paper: { sx: { ml: -1 } },
        }}
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
            sx={{ minHeight: 44, minWidth: 240, px: 2 }}
          >
            <ListItemText primary={preset.label} />
          </MenuItem>
        ))}
        <MenuItem
          aria-checked={hybridOverlayEnabled}
          disabled={hybridOverlayDisabled}
          onClick={() => {
            onHybridOverlayChange(!hybridOverlayEnabled);
          }}
          role="menuitemcheckbox"
          sx={{ minHeight: 44, minWidth: 240, px: 2 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            {hybridOverlayEnabled ? (
              <CheckBoxIcon fontSize="small" />
            ) : (
              <CheckBoxOutlineBlankIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText primary="OSM overlay" />
        </MenuItem>
        <MenuItem
          aria-checked={activeLayerPreset === 'sentinel-2'}
          onClick={() => {
            onLayerPresetChange('sentinel-2');
          }}
          role="menuitemradio"
          selected={activeLayerPreset === 'sentinel-2'}
          sx={{
            display: 'inline-flex',
            justifyContent: 'center',
            minHeight: 40,
            px: 1,
            verticalAlign: 'top',
            width: '50%',
          }}
        >
          Sentinel-2
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuButton(null);
            onOpenLayersTab();
          }}
          role="menuitem"
          sx={{
            borderLeft: 1,
            borderColor: 'divider',
            display: 'inline-flex',
            justifyContent: 'center',
            minHeight: 40,
            px: 1,
            verticalAlign: 'top',
            width: '50%',
          }}
        >
          Layers tab
        </MenuItem>
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
