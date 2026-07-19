import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import SatelliteAltOutlinedIcon from '@mui/icons-material/SatelliteAltOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import {
  Box,
  ButtonBase,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SyntheticEvent } from 'react';

import type { WorkspaceTab } from '@/presentation/shell/uiStore';
import { appColors } from '@/presentation/theme/appColors';

interface WorkspaceRailProps {
  readonly collapsed: boolean;
  readonly activeTab: WorkspaceTab;
  readonly developerToolsOpen: boolean;
  readonly developerMode: boolean;
  readonly onToggleDeveloperTools: () => void;
  readonly onOpenSettings: () => void;
  readonly onSectionChange: (section: WorkspaceTab) => void;
  readonly onLogoClick: () => void;
}

export function WorkspaceRail({
  collapsed,
  activeTab,
  developerToolsOpen,
  developerMode,
  onToggleDeveloperTools,
  onOpenSettings,
  onSectionChange,
  onLogoClick,
}: WorkspaceRailProps) {
  const handleSectionChange = (_event: SyntheticEvent, value: WorkspaceTab) => {
    onSectionChange(value);
  };

  return (
    <Box
      component="nav"
      aria-label="Workspace navigation"
      sx={{
        position: 'relative',
        zIndex: 4,
        width: collapsed ? 44 : 64,
        height: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        bgcolor: collapsed ? 'transparent' : appColors.brand.deepSpace,
        color: appColors.text.inverse,
        borderRadius: collapsed ? 1.25 : '8px 0 0 8px',
        overflow: collapsed ? 'visible' : 'hidden',
        boxShadow: 'none',
        transition: (theme) =>
          theme.transitions.create(['width', 'background-color'], {
            duration: theme.transitions.duration.shorter,
          }),
      }}
    >
      <Tooltip
        title={collapsed ? 'Show navigation' : 'Hide navigation'}
        placement="right"
      >
        <ButtonBase
          aria-label={collapsed ? 'Show navigation' : 'Hide navigation from GR'}
          onClick={onLogoClick}
          sx={{
            width: 44,
            height: 36,
            mt: collapsed ? 0 : 1.5,
            mx: 'auto',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 1.25,
            bgcolor: appColors.brand.blueGreenDark,
            color: appColors.text.inverse,
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.18)',
            cursor: 'pointer',
          }}
        >
          <Typography variant="subtitle2" color="inherit" sx={{ fontWeight: 800 }}>
            GR
          </Typography>
        </ButtonBase>
      </Tooltip>

      <Tabs
        aria-label="Workspace sections"
        orientation="vertical"
        value={activeTab}
        onChange={handleSectionChange}
        sx={{
          visibility: collapsed ? 'hidden' : 'visible',
          opacity: collapsed ? 0 : 1,
          transition: (theme) => theme.transitions.create('opacity'),
          mt: 1.5,
          '& .MuiTabs-indicator': {
            left: 0,
            right: 'auto',
            width: 3,
            borderRadius: '0 3px 3px 0',
            bgcolor: appColors.brand.amber,
          },
        }}
      >
        <Tab icon={<RouteOutlinedIcon />} label="Tracks" value="tracks" />
        <Tab icon={<SatelliteAltOutlinedIcon />} label="Satellite" value="satellite" />
        <Tab icon={<PlaceOutlinedIcon />} label="Markers" value="markers" />
        <Tab icon={<LayersOutlinedIcon />} label="Layers" value="layers" />
      </Tabs>

      <Stack
        spacing={0.5}
        sx={{
          mt: 'auto',
          px: 0.75,
          pb: 1,
          visibility: collapsed ? 'hidden' : 'visible',
          opacity: collapsed ? 0 : 1,
          transition: (theme) => theme.transitions.create('opacity'),
        }}
      >
        {developerMode ? (
          <Tooltip title="Developer diagnostics" placement="right">
            <IconButton
              aria-label="Developer diagnostics"
              aria-pressed={developerToolsOpen}
              onClick={onToggleDeveloperTools}
              sx={{
                color: 'rgba(255,255,255,0.84)',
                bgcolor: developerToolsOpen ? 'rgba(33,158,188,0.34)' : 'transparent',
              }}
            >
              <BugReportOutlinedIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        <Tooltip title="Settings" placement="right">
          <IconButton
            aria-label="Open settings"
            onClick={onOpenSettings}
            sx={{ color: 'rgba(255,255,255,0.84)' }}
          >
            <SettingsOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}
