import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CompareOutlinedIcon from '@mui/icons-material/CompareOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import StraightenIcon from '@mui/icons-material/Straighten';
import {
  CircularProgress,
  ClickAwayListener,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material';
import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { Fragment, useId, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useControl } from 'react-map-gl/maplibre';

import {
  KeyboardShortcutKeys,
  ShortcutTooltipTitle,
} from '@/presentation/KeyboardShortcutKeys';
import {
  basemapPresets,
  type BasemapPreset,
  type MapLayerPreset,
  type TerrainMode,
} from '@/presentation/map/mapTypes';

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
  /** Returns `navigated` when the choice opened a workspace panel instead of the map. */
  readonly onLayerPresetChange: (preset: MapLayerPreset) => 'map' | 'navigated';
  readonly onHybridOverlayChange: (enabled: boolean) => void;
  readonly onWeatherMapChange: (enabled: boolean) => void;
  readonly onOpenLayersTab: () => void;
  /** Opens the satellite image comparison; null hides the button where it is unavailable. */
  readonly onOpenComparison: (() => void) | null;
  readonly onMeasurementActiveChange: (active: boolean) => void;
}

const basemapLabels: Readonly<Record<BasemapPreset, MessageDescriptor>> = {
  'vector-osm': msg`Vector OSM`,
  'google-satellite': msg`Google Satellite`,
  'bing-satellite': msg`Bing Aerial`,
  'esri-satellite': msg`Esri World Imagery`,
  'napr-orthophoto': msg`NAPR Orthophoto`,
  'soviet-topographic': msg`Soviet Topographic`,
};
// eslint-disable-next-line lingui/no-unlocalized-strings -- Satellite mission name stays invariant.
const sentinelPresetLabel = 'Sentinel-2';
const sovietTopographicLegendUrl =
  // eslint-disable-next-line lingui/no-unlocalized-strings -- External reference URL.
  'https://www.planinite.info/Maps/pdf/%D0%A3%D1%81%D0%BB%D0%BE%D0%B2%D0%BD%D1%8B%D0%B5_%D0%B7%D0%BD%D0%B0%D0%BA%D0%B8_%D1%82%D0%BE%D0%BF%D0%BE%D0%B3%D1%80%D0%B0%D1%84%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D1%85_%D0%BA%D0%B0%D1%80%D1%82_%D0%A1%D0%A1%D0%A1%D0%A0-1966.pdf';

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
  onOpenComparison,
  onMeasurementActiveChange,
}: MapViewControlsProps) {
  const { t } = useLingui();
  const [menuButton, setMenuButton] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const pending = terrainState === 'enabling' || terrainState === 'disabling';
  const selectedMode: TerrainMode =
    terrainState === 'terrain' || terrainState === 'enabling' ? 'terrain' : 'flat';
  const menuOpen = menuButton !== null;
  const closeMenu = () => {
    setMenuButton(null);
  };

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
            <Tooltip
              disableInteractive
              title={
                <ShortcutTooltipTitle
                  label={t`Flat map`}
                  shortcut={{ action: 'toggle-terrain' }}
                />
              }
            >
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
              terrainDisabled ? (
                t`3D terrain is unavailable while Sentinel Mosaic is active.`
              ) : (
                <ShortcutTooltipTitle
                  label={t`3D terrain`}
                  shortcut={{ action: 'toggle-terrain' }}
                />
              )
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
        <Tooltip
          disableInteractive
          title={
            <ShortcutTooltipTitle
              label={t`Choose map layer preset`}
              shortcut={{ action: 'next-basemap' }}
            />
          }
        >
          <span>
            <ToggleButton
              aria-controls={menuOpen ? menuId : undefined}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={t`Choose map layer preset`}
              disabled={layerPresetDisabled}
              onClick={(event) => {
                setMenuButton(menuOpen ? null : event.currentTarget);
              }}
              selected={menuOpen}
              sx={{ borderRadius: 0, mt: '-1px', width: 40, height: 36, p: 0 }}
              value="layer-preset"
            >
              <LayersOutlinedIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>
        {onOpenComparison === null ? null : (
          <Tooltip
            disableInteractive
            title={t`Compare images from different dates side by side`}
          >
            <ToggleButton
              aria-label={t`Open image comparison`}
              onChange={onOpenComparison}
              selected={false}
              sx={{ borderRadius: 0, mt: '-1px', width: 40, height: 36, p: 0 }}
              value="comparison"
            >
              <CompareOutlinedIcon fontSize="small" />
            </ToggleButton>
          </Tooltip>
        )}
        <Tooltip
          disableInteractive
          title={
            <ShortcutTooltipTitle
              label={t`Measure distance and elevation`}
              shortcut={{ action: 'toggle-ruler' }}
            />
          }
        >
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
      {/*
        Non-modal and inside the map: map gestures keep working while it is open, a
        pointer press elsewhere closes it without being swallowed, and workspace panels
        drawn above the map also cover it.
      */}
      <Popper
        anchorEl={menuButton}
        disablePortal
        modifiers={[
          { name: 'offset', options: { offset: [0, 8] } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
        open={menuOpen}
        placement="left-start"
      >
        <ClickAwayListener
          // Closes on press rather than click, so a map drag that starts outside closes it too.
          // eslint-disable-next-line lingui/no-unlocalized-strings -- React event prop name.
          mouseEvent="onPointerDown"
          touchEvent={false}
          onClickAway={(event) => {
            // The layer button toggles the chooser itself.
            if (event.target instanceof Node && menuButton?.contains(event.target))
              return;
            closeMenu();
          }}
        >
          {/* Short landscape phone maps clip the map overflow, so the list scrolls instead. */}
          <Paper
            elevation={8}
            sx={{ maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto' }}
          >
            <MenuList
              aria-label={t`Choose map layer preset`}
              autoFocusItem
              // Digit shortcuts keep working while the chooser has focus.
              data-keyboard-shortcuts=""
              id={menuId}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  // Escape here closes only the chooser, not an active map operation.
                  event.preventDefault();
                  event.stopPropagation();
                  closeMenu();
                  menuButton?.focus();
                } else if (event.key === 'Tab') {
                  closeMenu();
                }
              }}
              sx={{ pb: 0 }}
            >
              {basemapPresets.map((preset) => {
                // The symbol guide is a sibling item: a link nested inside a menuitemradio
                // would be an inaccessible nested interactive control.
                const hasLegend = preset === 'soviet-topographic';
                return (
                  <Fragment key={preset}>
                    <MenuItem
                      aria-checked={activeLayerPreset === preset}
                      onClick={() => {
                        onLayerPresetChange(preset);
                      }}
                      role="menuitemradio"
                      selected={activeLayerPreset === preset}
                      sx={
                        hasLegend
                          ? {
                              // Both row halves use one fixed height so their selection and
                              // hover backgrounds line up regardless of their content.
                              display: 'inline-flex',
                              height: 44,
                              minHeight: 44,
                              px: 2,
                              py: 0,
                              verticalAlign: 'top',
                              width: 'calc(100% - 44px)',
                            }
                          : { minHeight: 44, minWidth: 240, px: 2 }
                      }
                    >
                      <ListItemText primary={t(basemapLabels[preset])} />
                      <KeyboardShortcutKeys
                        shortcut={{ action: 'select-basemap', preset }}
                      />
                    </MenuItem>
                    {hasLegend ? (
                      <Tooltip
                        disableInteractive
                        title={t`Topographic map symbols (PDF)`}
                      >
                        <MenuItem
                          aria-label={t`Open topographic map symbols (PDF)`}
                          component="a"
                          href={sovietTopographicLegendUrl}
                          rel="noopener noreferrer"
                          role="menuitem"
                          target="_blank"
                          sx={{
                            display: 'inline-flex',
                            height: 44,
                            justifyContent: 'center',
                            minHeight: 44,
                            p: 0,
                            verticalAlign: 'top',
                            width: 44,
                          }}
                        >
                          <HelpOutlineOutlinedIcon fontSize="small" />
                        </MenuItem>
                      </Tooltip>
                    ) : null}
                  </Fragment>
                );
              })}
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
                <KeyboardShortcutKeys shortcut={{ action: 'toggle-osm-overlay' }} />
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
                  if (onLayerPresetChange('sentinel-2') === 'navigated') closeMenu();
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
                <KeyboardShortcutKeys shortcut={{ action: 'show-sentinel-2' }} />
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeMenu();
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
            </MenuList>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  );
}

export function MapViewControlsControl(props: MapViewControlsProps) {
  const host = useControl(() => new MapViewControlHost(), {
    position: 'top-right',
  });

  return createPortal(<MapViewControls {...props} />, host.element);
}
