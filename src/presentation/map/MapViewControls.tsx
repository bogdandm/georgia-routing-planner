import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import StraightenIcon from '@mui/icons-material/Straighten';
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
  readonly weatherMapEnabled: boolean;
  readonly weatherMapDisabled: boolean;
  readonly measurementActive: boolean;
  readonly onTerrainModeChange: (mode: TerrainMode) => void;
  readonly onLayerPresetChange: (preset: MapLayerPreset) => boolean;
  readonly onHybridOverlayChange: (enabled: boolean) => void;
  readonly onWeatherMapChange: (enabled: boolean) => void;
  readonly onOpenLayersTab: () => void;
  readonly onMeasurementActiveChange: (active: boolean) => void;
}

const layerPresets: readonly {
  readonly label: MessageDescriptor;
  readonly value: MapLayerPreset;
}[] = [
  { label: msg`Vector OSM`, value: 'vector-osm' },
  { label: msg`Google Satellite`, value: 'google-satellite' },
  { label: msg`Bing Aerial`, value: 'bing-satellite' },
  { label: msg`Esri World Imagery`, value: 'esri-satellite' },
  { label: msg`NAPR Orthophoto`, value: 'napr-orthophoto' },
];
// eslint-disable-next-line lingui/no-unlocalized-strings -- Satellite mission name stays invariant.
const sentinelPresetLabel = 'Sentinel-2';

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
  weatherMapEnabled,
  weatherMapDisabled,
  measurementActive,
  onTerrainModeChange,
  onLayerPresetChange,
  onHybridOverlayChange,
  onWeatherMapChange,
  onOpenLayersTab,
  onMeasurementActiveChange,
}: MapViewControlsProps) {
  const { t } = useLingui();
  const [menuButton, setMenuButton] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const pending = terrainState === 'enabling' || terrainState === 'disabling';
  const selectedMode: TerrainMode =
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
          aria-label={t`Map dimension`}
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
            aria-label={t`Show flat 2D map`}
            disabled={pending}
            sx={{ width: 40, height: 36, p: 0 }}
          >
            <Tooltip disableInteractive title={t`Flat map`}>
              <span>
                {terrainState === 'disabling' ? (
                  <CircularProgress size={18} aria-hidden />
                ) : (
                  // eslint-disable-next-line lingui/no-unlocalized-strings -- Technical dimension token.
                  '2D'
                )}
              </span>
            </Tooltip>
          </ToggleButton>
          {/* Interactive tooltips open below and would cover the next button, eating clicks. */}
          <Tooltip
            disableInteractive
            title={
              terrainDisabled
                ? t`3D terrain is unavailable while Sentinel Mosaic is active.`
                : t`3D terrain`
            }
          >
            <span>
              <ToggleButton
                value="terrain"
                aria-label={t`Show 3D terrain map`}
                disabled={pending || terrainDisabled}
                sx={{ width: 40, height: 36, p: 0 }}
              >
                <span>
                  {terrainState === 'enabling' ? (
                    <CircularProgress size={18} aria-hidden />
                  ) : (
                    // eslint-disable-next-line lingui/no-unlocalized-strings -- Technical dimension token.
                    '3D'
                  )}
                </span>
              </ToggleButton>
            </span>
          </Tooltip>
        </ToggleButtonGroup>
        <Tooltip disableInteractive title={t`Choose map layer preset`}>
          <span>
            <ToggleButton
              aria-controls={menuOpen ? menuId : undefined}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={t`Choose map layer preset`}
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
        <Tooltip disableInteractive title={t`Measure distance and elevation`}>
          <ToggleButton
            aria-label={t`Measure distance`}
            onChange={() => {
              onMeasurementActiveChange(!measurementActive);
            }}
            selected={measurementActive}
            sx={{ borderRadius: 0, mt: '-1px', width: 40, height: 36, p: 0 }}
            value="measurement"
          >
            <StraightenIcon fontSize="small" />
          </ToggleButton>
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
            <ListItemText primary={t(preset.label)} />
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
          <ListItemText primary={t`OSM overlay`} />
        </MenuItem>
        <MenuItem
          aria-checked={weatherMapEnabled}
          disabled={weatherMapDisabled}
          onClick={() => {
            onWeatherMapChange(!weatherMapEnabled);
          }}
          role="menuitemcheckbox"
          sx={{ minHeight: 44, minWidth: 240, px: 2 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            {weatherMapEnabled ? (
              <CheckBoxIcon fontSize="small" />
            ) : (
              <CheckBoxOutlineBlankIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={t`Weather`}
            secondary={t`Clouds, precipitation, and wind`}
          />
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
          {sentinelPresetLabel}
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
          {t`Layers tab`}
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
