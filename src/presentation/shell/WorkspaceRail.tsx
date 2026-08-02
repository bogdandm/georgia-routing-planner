import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import SatelliteAltOutlinedIcon from '@mui/icons-material/SatelliteAltOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import {
  Badge,
  Box,
  ButtonBase,
  IconButton,
  Stack,
  Tab,
  Tabs,
  type TabProps,
  Tooltip,
} from '@mui/material';
import {
  useCallback,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';

import type { WorkspaceTab } from '@/presentation/shell/uiStore';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
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
  readonly collapsedSummary: ReactNode | null;
  readonly squareEdges: boolean;
  readonly activeTab: WorkspaceTab;
  readonly developerToolsOpen: boolean;
  readonly developerMode: boolean;
  readonly aboutButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onOpenAbout: () => void;
  readonly onOpenTracks: () => void;
  readonly onToggleDeveloperTools: () => void;
  readonly onOpenSettings: () => void;
  readonly onShare: () => void;
  readonly onSectionChange: (section: WorkspaceTab) => void;
  readonly onToggleNavigation: () => void;
}

export function WorkspaceRail({
  collapsed,
  collapsedSummary,
  squareEdges,
  activeTab,
  developerToolsOpen,
  developerMode,
  aboutButtonRef,
  onOpenTracks,
  onToggleDeveloperTools,
  onOpenAbout,
  onOpenSettings,
  onShare,
  onSectionChange,
  onToggleNavigation,
}: WorkspaceRailProps) {
  const { userData } = useRuntimeServices();
  const subscribeUser = useCallback(
    (listener: () => void) => userData.subscribe(listener),
    [userData],
  );
  const getUserSnapshot = useCallback(() => userData.getSnapshot(), [userData]);
  const userSnapshot = useSyncExternalStore(
    subscribeUser,
    getUserSnapshot,
    getUserSnapshot,
  );
  let userLabel = 'User';
  let syncIndicatorColor: string | null = null;
  if (userSnapshot.status === 'signed-in' && userSnapshot.syncEnabled) {
    switch (userSnapshot.syncStatus) {
      case 'syncing':
        userLabel = 'User synchronization in progress';
        syncIndicatorColor = appColors.brand.tigerOrange;
        break;
      case 'error':
        userLabel = 'User synchronization failed';
        syncIndicatorColor = appColors.status.error;
        break;
      case 'success':
        userLabel = 'User synchronization successful';
        syncIndicatorColor = appColors.status.success;
        break;
      case 'idle':
        break;
    }
  }
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
        width: collapsed ? (collapsedSummary === null ? 94 : 414) : 64,
        height: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        bgcolor: collapsed ? 'transparent' : appColors.brand.deepSpace,
        color: appColors.text.inverse,
        borderRadius: squareEdges || collapsed ? 0 : '8px 0 0 8px',
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
      {collapsed ? (
        <Box
          sx={{
            position: 'relative',
            width: collapsedSummary === null ? 88 : 408,
            height: 52,
            flexShrink: 0,
            mt: 0.75,
            ml: 0.75,
            display: 'flex',
            alignItems: 'stretch',
            overflow: 'hidden',
            borderRadius: 1.25,
            bgcolor: 'transparent',
            color: appColors.text.inverse,
            '& .collapsed-navigation-segment::after': {
              content: '""',
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              bgcolor: appColors.interaction.navigationHoverOverlay,
              opacity: 0,
              pointerEvents: 'none',
              transition: (theme) =>
                theme.transitions.create('opacity', {
                  duration: theme.transitions.duration.shorter,
                }),
            },
            '& .collapsed-navigation-segment:hover::after, & .collapsed-navigation-segment.Mui-focusVisible::after':
              { opacity: 1 },
            '& .collapsed-navigation-segment.Mui-focusVisible': {
              outline: `2px solid ${appColors.brand.amber}`,
              outlineOffset: -2,
            },
            '@media (prefers-reduced-motion: reduce)': {
              '& .collapsed-navigation-segment::after': {
                transition: 'none',
              },
            },
          }}
        >
          <Tooltip
            title="Trail Planner"
            placement="bottom-start"
            slotProps={{
              popper: {
                modifiers: [{ name: 'offset', options: { offset: [0, 2] } }],
              },
            }}
          >
            <ButtonBase
              aria-label="Show navigation from Trail Planner logo"
              className="collapsed-navigation-segment"
              onClick={onToggleNavigation}
              sx={{
                position: 'relative',
                zIndex: 1,
                width: 52,
                height: 52,
                flexShrink: 0,
                bgcolor: appColors.brand.deepSpace,
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
          {collapsedSummary === null ? null : (
            <ButtonBase
              aria-label="Open tracks"
              className="collapsed-navigation-segment"
              onClick={onOpenTracks}
              sx={{
                position: 'relative',
                zIndex: 1,
                width: 320,
                height: 52,
                minWidth: 0,
                color: 'inherit',
              }}
            >
              {collapsedSummary}
            </ButtonBase>
          )}
          <Tooltip title="Show navigation" placement="right">
            <ButtonBase
              aria-label="Show navigation"
              className="collapsed-navigation-segment"
              onClick={onToggleNavigation}
              sx={{
                position: 'relative',
                zIndex: 1,
                width: 36,
                height: 52,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                bgcolor: appColors.surface.subtle,
                color: 'text.primary',
              }}
            >
              <ChevronLeftOutlinedIcon
                fontSize="small"
                sx={{ position: 'relative', zIndex: 1, transform: 'rotate(180deg)' }}
              />
            </ButtonBase>
          </Tooltip>
        </Box>
      ) : (
        <Tooltip
          title="Trail Planner"
          placement="bottom-start"
          slotProps={{
            popper: {
              modifiers: [{ name: 'offset', options: { offset: [0, 2] } }],
            },
          }}
        >
          <ButtonBase
            aria-label="Hide navigation from Trail Planner logo"
            onClick={onToggleNavigation}
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
              borderRadius: 1.25,
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
      )}

      <Tabs
        aria-label="Workspace sections"
        orientation="vertical"
        value={activeTab === 'user' ? false : activeTab}
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
        <Tab icon={<SatelliteAltOutlinedIcon />} label="Satellite" value="satellite" />
        <Tab icon={<RouteOutlinedIcon />} label="Tracks" value="tracks" />
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
        <Tooltip title={userLabel} placement="right">
          <IconButton
            aria-busy={userSnapshot.syncStatus === 'syncing'}
            aria-label={userLabel}
            aria-pressed={activeTab === 'user'}
            onClick={() => {
              onSectionChange('user');
            }}
            sx={{
              color: 'rgba(255,255,255,0.84)',
              bgcolor: activeTab === 'user' ? 'rgba(33,158,188,0.34)' : 'transparent',
            }}
          >
            <Badge
              aria-hidden="true"
              invisible={syncIndicatorColor === null}
              overlap="circular"
              variant="dot"
              sx={{
                '& .MuiBadge-badge': {
                  width: 8,
                  height: 8,
                  minWidth: 8,
                  bgcolor: syncIndicatorColor ?? 'transparent',
                  boxShadow: `0 0 0 2px ${appColors.brand.deepSpace}`,
                },
              }}
            >
              <AccountCircleOutlinedIcon />
            </Badge>
          </IconButton>
        </Tooltip>
        <Tooltip title="Settings" placement="right">
          <IconButton
            aria-label="Open settings"
            onClick={onOpenSettings}
            sx={{ color: 'rgba(255,255,255,0.84)' }}
          >
            <SettingsOutlinedIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="About this site" placement="right">
          <IconButton
            ref={aboutButtonRef}
            aria-label="About this site"
            onClick={onOpenAbout}
            sx={{ color: 'rgba(255,255,255,0.84)' }}
          >
            <InfoOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}
