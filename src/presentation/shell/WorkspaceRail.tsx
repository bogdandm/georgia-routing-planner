import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import SatelliteAltOutlinedIcon from '@mui/icons-material/SatelliteAltOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { Box, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import type { SyntheticEvent } from 'react';

import type { WorkspaceTab } from '@/presentation/shell/uiStore';
import { appColors } from '@/presentation/theme/appColors';

interface WorkspaceRailProps {
  readonly activeTab: WorkspaceTab;
  readonly developerMode: boolean;
  readonly onOpenDeveloperTools: () => void;
  readonly onOpenSettings: () => void;
  readonly onSectionChange: (section: WorkspaceTab) => void;
}

export function WorkspaceRail({
  activeTab,
  developerMode,
  onOpenDeveloperTools,
  onOpenSettings,
  onSectionChange,
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
        width: 64,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        bgcolor: appColors.brand.deepSpace,
        color: appColors.text.inverse,
      }}
    >
      <Tooltip title="Georgia Routing Planner" placement="right">
        <Box
          aria-label="Georgia Routing Planner"
          sx={{
            width: 44,
            height: 36,
            mt: 1.5,
            mx: 'auto',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 1.25,
            bgcolor: appColors.brand.blueGreen,
            color: '#011f2e',
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.18)',
          }}
        >
          <Typography variant="subtitle2" color="inherit" sx={{ fontWeight: 800 }}>
            GR
          </Typography>
        </Box>
      </Tooltip>

      <Tabs
        aria-label="Workspace sections"
        orientation="vertical"
        value={activeTab}
        onChange={handleSectionChange}
        sx={{
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
        <Tab icon={<LayersOutlinedIcon />} label="Tracks" value="tracks" />
        <Tab icon={<SatelliteAltOutlinedIcon />} label="Satellite" value="satellite" />
        <Tab icon={<RouteOutlinedIcon />} label="Plan" value="plan" />
      </Tabs>

      <Stack spacing={0.5} sx={{ mt: 'auto', px: 0.75, pb: 1 }}>
        {developerMode ? (
          <Tooltip title="Developer diagnostics" placement="right">
            <IconButton
              aria-label="Developer diagnostics"
              onClick={onOpenDeveloperTools}
              sx={{ color: 'rgba(255,255,255,0.84)' }}
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
