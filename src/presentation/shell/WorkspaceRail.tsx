import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import SatelliteAltOutlinedIcon from '@mui/icons-material/SatelliteAltOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
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

const unavailableTabSx = {
  pointerEvents: 'auto !important',
  cursor: 'not-allowed',
  position: 'relative',
  overflow: 'visible',
  opacity: '1 !important',
  color: 'rgba(255, 255, 255, 0.42) !important',
  '&::after': {
    content: 'attr(data-disabled-reason)',
    position: 'absolute',
    top: '50%',
    left: 'calc(100% + 8px)',
    zIndex: 10,
    px: 1,
    py: 0.5,
    borderRadius: 1,
    bgcolor: 'grey.800',
    color: 'common.white',
    fontSize: '0.6875rem',
    fontWeight: 500,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
    opacity: 0,
    transform: 'translate(-4px, -50%)',
    pointerEvents: 'none',
    transition: 'opacity 150ms ease-out, transform 150ms ease-out',
  },
  '&:hover::after': {
    opacity: 1,
    transform: 'translate(0, -50%)',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '&::after': { transition: 'none' },
  },
} as const;

interface WorkspaceRailProps {
  readonly collapsed: boolean;
  readonly activeTab: WorkspaceTab;
  readonly developerToolsOpen: boolean;
  readonly developerMode: boolean;
  readonly onToggleDeveloperTools: () => void;
  readonly onOpenSettings: () => void;
  readonly onShare: () => void;
  readonly onSectionChange: (section: WorkspaceTab) => void;
  readonly onToggleNavigation: () => void;
}

export function WorkspaceRail({
  collapsed,
  activeTab,
  developerToolsOpen,
  developerMode,
  onToggleDeveloperTools,
  onOpenSettings,
  onShare,
  onSectionChange,
  onToggleNavigation,
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
        height: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        bgcolor: collapsed ? 'transparent' : appColors.brand.deepSpace,
        color: appColors.text.inverse,
        borderRadius: collapsed ? 0 : '8px 0 0 8px',
        overflow: 'visible',
        boxShadow: 'none',
        transition: (theme) =>
          collapsed
            ? 'none'
            : theme.transitions.create('background-color', {
                duration: theme.transitions.duration.shorter,
              }),
      }}
    >
      <Box
        data-testid="workspace-logo-control"
        sx={{
          width: 44,
          height: 36,
          flexShrink: 0,
          mt: 1.5,
          ml: 1.25,
          display: 'flex',
          borderRadius: collapsed ? '5px 0 0 5px' : 1.25,
          boxShadow: collapsed ? 'none' : '0 6px 18px rgba(0, 0, 0, 0.18)',
          overflow: 'hidden',
          transition: (theme) =>
            theme.transitions.create('box-shadow', {
              duration: theme.transitions.duration.short,
            }),
          '&:hover': {
            boxShadow: collapsed ? 'none' : '0 8px 22px rgba(0, 0, 0, 0.24)',
          },
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none',
          },
        }}
      >
        <Tooltip
          title="Georgia Routing Planner"
          placement="bottom-start"
          slotProps={{
            popper: {
              modifiers: [{ name: 'offset', options: { offset: [0, 2] } }],
            },
          }}
        >
          <ButtonBase
            aria-hidden={collapsed}
            aria-label="Hide navigation from GR logo"
            data-testid="workspace-logo-mark"
            onClick={onToggleNavigation}
            tabIndex={collapsed ? -1 : 0}
            sx={{
              width: 44,
              height: 36,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              bgcolor: appColors.brand.blueGreenDark,
              color: appColors.text.inverse,
              borderRadius: collapsed ? '5px 0 0 5px' : 1.25,
              pointerEvents: collapsed ? 'none' : 'auto',
              transition: (theme) =>
                theme.transitions.create(['background-color', 'border-radius'], {
                  duration: theme.transitions.duration.short,
                }),
              '&:hover': {
                bgcolor: appColors.brand.blueGreen,
              },
              '@media (prefers-reduced-motion: reduce)': {
                transition: 'none',
              },
            }}
          >
            <Typography variant="subtitle2" color="inherit" sx={{ fontWeight: 800 }}>
              GR
            </Typography>
          </ButtonBase>
        </Tooltip>
      </Box>

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
          overflow: 'visible',
          '& .MuiTabs-scroller, & .MuiTabs-list': {
            overflow: 'visible !important',
          },
          '& .MuiTabs-indicator': {
            left: 0,
            right: 'auto',
            width: 3,
            borderRadius: '0 3px 3px 0',
            bgcolor: appColors.brand.amber,
          },
        }}
      >
        <Tab
          aria-description="Track tools are not available yet"
          data-disabled-reason="Track tools are not available yet"
          disabled
          icon={<RouteOutlinedIcon />}
          label="Tracks"
          sx={unavailableTabSx}
          value="tracks"
        />
        <Tab icon={<SatelliteAltOutlinedIcon />} label="Satellite" value="satellite" />
        <Tab
          aria-description="Saved markers are not available yet"
          data-disabled-reason="Saved markers are not available yet"
          disabled
          icon={<PlaceOutlinedIcon />}
          label="Markers"
          sx={unavailableTabSx}
          value="markers"
        />
        <Tab icon={<LayersOutlinedIcon />} label="Layers" value="layers" />
      </Tabs>

      <Tooltip title="Share map view" placement="right">
        <IconButton
          aria-label="Share map view"
          onClick={onShare}
          sx={{
            mx: 'auto',
            mt: 0.5,
            color: 'rgba(255,255,255,0.84)',
            visibility: collapsed ? 'hidden' : 'visible',
          }}
        >
          <ShareOutlinedIcon />
        </IconButton>
      </Tooltip>

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
