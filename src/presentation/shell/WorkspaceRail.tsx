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
  type TabProps,
  Tooltip,
} from '@mui/material';
import type { SyntheticEvent } from 'react';

import type { WorkspaceTab } from '@/presentation/shell/uiStore';
import { appColors } from '@/presentation/theme/appColors';

const unavailableTabSx = {
  pointerEvents: 'auto !important',
  cursor: 'not-allowed',
  opacity: '1 !important',
  color: 'rgba(255, 255, 255, 0.42) !important',
} as const;

type UnavailableWorkspaceTabProps = Omit<TabProps, 'component' | 'disabled'> & {
  readonly reason: string;
};

function UnavailableWorkspaceTab({
  reason,
  ...tabProps
}: UnavailableWorkspaceTabProps) {
  return (
    <Tooltip describeChild title={reason} placement="right">
      <Tab
        {...tabProps}
        aria-description={reason}
        component="div"
        disabled
        sx={unavailableTabSx}
      />
    </Tooltip>
  );
}

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
          onClick={onToggleNavigation}
          tabIndex={collapsed ? -1 : 0}
          sx={{
            position: 'relative',
            width: 52,
            height: 52,
            flexShrink: 0,
            mt: 0.75,
            ml: 0.75,
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            bgcolor: appColors.brand.deepSpace,
            color: appColors.text.inverse,
            borderRadius: collapsed ? '10px 0 0 10px' : 1.25,
            pointerEvents: collapsed ? 'none' : 'auto',
            transition: (theme) =>
              theme.transitions.create('border-radius', {
                duration: theme.transitions.duration.short,
              }),
            '&::after': {
              content: '""',
              position: 'absolute',
              inset: 0,
              bgcolor: appColors.interaction.navigationHoverOverlay,
              opacity: 0,
              pointerEvents: 'none',
              transition: (theme) =>
                theme.transitions.create('opacity', {
                  duration: theme.transitions.duration.shorter,
                }),
            },
            '&:hover::after': { opacity: 1 },
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'none',
              '&::after': { transition: 'none' },
            },
          }}
        >
          <Box
            alt=""
            aria-hidden="true"
            component="img"
            data-testid="project-logo-image"
            draggable={false}
            src={`${import.meta.env.BASE_URL}favicon.png`}
            sx={{ position: 'relative', zIndex: 1, width: 52, height: 52 }}
          />
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
        <Tab icon={<LayersOutlinedIcon />} label="Layers" value="layers" />
        <UnavailableWorkspaceTab
          icon={<PlaceOutlinedIcon />}
          label="Markers"
          reason="Saved markers are not available yet"
          value="markers"
        />
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
