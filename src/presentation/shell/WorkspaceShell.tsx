import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { DeveloperDrawer } from '@/presentation/developer-tools/DeveloperDrawer';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { MapSearchPlaceholder } from '@/presentation/shell/MapSearchPlaceholder';
import { OperationalStatus } from '@/presentation/shell/OperationalStatus';
import { SettingsDialog } from '@/presentation/shell/SettingsDialog';
import { ShareMapDialog } from '@/presentation/shell/ShareMapDialog';
import { useUiStore, type WorkspaceTab } from '@/presentation/shell/uiStore';
import { WorkspaceRail } from '@/presentation/shell/WorkspaceRail';
import { WorkspaceSidebar } from '@/presentation/shell/WorkspaceSidebar';
import {
  workspaceHashForTab,
  workspaceTabFromHash,
} from '@/presentation/shell/workspaceTabLocation';
import { appColors } from '@/presentation/theme/appColors';

interface WorkspaceShellProps {
  readonly mapSurface?: ReactNode;
}

function ControlledFailure(): never {
  throw new Error('Controlled Phase 0 component failure.');
}

export function WorkspaceShell({ mapSurface = <MapWorkspace /> }: WorkspaceShellProps) {
  const { database, logger, mapLayers, storageUsage } = useRuntimeServices();
  const activeTab = useUiStore((state) => state.activeTab);
  const developerDrawerOpen = useUiStore((state) => state.developerDrawerOpen);
  const developerMode = useUiStore((state) => state.developerMode);
  const navigationCollapsed = useUiStore((state) => state.navigationCollapsed);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setDeveloperDrawerOpen = useUiStore((state) => state.setDeveloperDrawerOpen);
  const setDeveloperMode = useUiStore((state) => state.setDeveloperMode);
  const setMapDebugOptions = useUiStore((state) => state.setMapDebugOptions);
  const setNavigationCollapsed = useUiStore((state) => state.setNavigationCollapsed);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const [controlledFailure, setControlledFailure] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    void mapLayers?.restorePersistedState();
  }, [mapLayers]);

  useEffect(() => {
    const restoreTabFromUrl = () => {
      const tab = workspaceTabFromHash(window.location.hash);
      if (tab !== null) setActiveTab(tab);
    };
    restoreTabFromUrl();
    window.addEventListener('hashchange', restoreTabFromUrl);
    window.addEventListener('popstate', restoreTabFromUrl);
    return () => {
      window.removeEventListener('hashchange', restoreTabFromUrl);
      window.removeEventListener('popstate', restoreTabFromUrl);
    };
  }, [setActiveTab]);

  if (controlledFailure) {
    return <ControlledFailure />;
  }

  const persistUiPreferences = async (
    nextDeveloperMode: boolean,
    nextNavigationCollapsed: boolean,
  ) => {
    try {
      await database.saveUiPreferences({
        developerMode: nextDeveloperMode,
        navigationCollapsed: nextNavigationCollapsed,
      });
    } catch {
      logger.log({ level: 'warn', name: 'storage.settings.save-failed' });
    }
  };

  const handleDeveloperModeChange = (value: boolean) => {
    setDeveloperMode(value);
    if (!value) {
      setDeveloperDrawerOpen(false);
      setMapDebugOptions({
        showCollisionBoxes: false,
        showTileBoundaries: false,
      });
    }
    void persistUiPreferences(value, navigationCollapsed);
  };

  const handleNavigationCollapsedChange = (value: boolean) => {
    setNavigationCollapsed(value);
    void persistUiPreferences(developerMode, value);
  };

  const handleSectionChange = (section: WorkspaceTab) => {
    setActiveTab(section);
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = workspaceHashForTab(section);
    window.history.pushState(window.history.state, '', nextUrl);
  };

  return (
    <Box
      sx={{
        height: '100dvh',
        position: 'relative',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <Box component="main" sx={{ position: 'absolute', inset: 0 }}>
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
          {mapSurface}
          <MapSearchPlaceholder />
          <OperationalStatus />
        </Box>
      </Box>

      <Box
        sx={{
          position: 'absolute',
          top: 6,
          left: 6,
          height: navigationCollapsed ? 64 : 'calc(100dvh - 12px)',
          zIndex: 4,
          display: 'flex',
          gap: 0,
          filter: navigationCollapsed
            ? 'drop-shadow(0 6px 9px rgba(0, 0, 0, 0.18))'
            : 'drop-shadow(0 8px 14px rgba(2, 48, 71, 0.2))',
          transition: (theme) =>
            theme.transitions.create(['height', 'filter'], {
              duration: theme.transitions.duration.short,
            }),
        }}
      >
        <WorkspaceRail
          collapsed={navigationCollapsed}
          activeTab={activeTab}
          developerToolsOpen={developerDrawerOpen}
          developerMode={developerMode}
          onSectionChange={handleSectionChange}
          onToggleDeveloperTools={() => {
            setDeveloperDrawerOpen(!developerDrawerOpen);
          }}
          onOpenSettings={() => {
            setSettingsOpen(true);
          }}
          onShare={() => {
            setShareOpen(true);
          }}
          onToggleNavigation={() => {
            handleNavigationCollapsedChange(!navigationCollapsed);
          }}
        />
        <Box
          sx={{
            minWidth: 0,
            width: 'max-content',
            maxWidth: navigationCollapsed ? 0 : 920,
            height: '100%',
            display: 'flex',
            gap: 0,
            opacity: navigationCollapsed ? 0 : 1,
            transform: navigationCollapsed ? 'translateX(-16px)' : 'translateX(0)',
            pointerEvents: navigationCollapsed ? 'none' : 'auto',
            visibility: navigationCollapsed ? 'hidden' : 'visible',
            overflow: 'hidden',
            borderRadius: '0 0 8px 0',
            transition: (theme) =>
              `${theme.transitions.create(['opacity', 'transform', 'max-width'], {
                duration: theme.transitions.duration.short,
              })}, visibility 0s linear ${navigationCollapsed ? '250ms' : '0ms'}`,
          }}
        >
          <WorkspaceSidebar activeTab={activeTab} />
          <Box
            id="satellite-results-pane"
            sx={{
              minHeight: 0,
              height: '100%',
              display: activeTab === 'satellite' ? 'flex' : 'none',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          />
        </Box>
        <Tooltip title={navigationCollapsed ? '' : 'Hide navigation'} placement="right">
          <IconButton
            aria-label={navigationCollapsed ? 'Show navigation' : 'Hide navigation'}
            data-testid="navigation-collapse-toggle"
            onClick={() => {
              handleNavigationCollapsedChange(!navigationCollapsed);
            }}
            size="small"
            sx={{
              position: 'absolute',
              zIndex: 5,
              top: navigationCollapsed ? 6 : 0,
              right: navigationCollapsed ? -30 : -35,
              width: navigationCollapsed ? 88 : 36,
              height: navigationCollapsed ? 52 : 64,
              bgcolor: navigationCollapsed ? 'transparent' : appColors.surface.subtle,
              borderStyle: 'solid',
              borderWidth: 0,
              borderBottomWidth: navigationCollapsed ? 0 : 1,
              borderBottomColor: appColors.brand.sky,
              borderRadius: navigationCollapsed ? '10px' : '0 8px 8px 0',
              boxShadow: 0,
              overflow: 'hidden',
              transition: (theme) =>
                theme.transitions.create(
                  [
                    'top',
                    'right',
                    'width',
                    'height',
                    'background-color',
                    'border-radius',
                    'box-shadow',
                  ],
                  {
                    duration: theme.transitions.duration.short,
                    easing: theme.transitions.easing.easeInOut,
                  },
                ),
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: '0 0 0 auto',
                zIndex: 0,
                width: 36,
                bgcolor: appColors.surface.subtle,
                borderRadius: '0 8px 8px 0',
                opacity: navigationCollapsed ? 1 : 0,
                transition: (theme) =>
                  theme.transitions.create(['opacity', 'border-radius'], {
                    duration: theme.transitions.duration.short,
                  }),
              },
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                bgcolor: appColors.interaction.navigationHoverOverlay,
                opacity: 0,
                pointerEvents: 'none',
                transition: (theme) =>
                  theme.transitions.create('opacity', {
                    duration: theme.transitions.duration.shorter,
                  }),
              },
              '&:hover': {
                bgcolor: navigationCollapsed ? 'transparent' : appColors.surface.subtle,
                boxShadow: 0,
                '&::after': { opacity: 1 },
              },
              '&.Mui-focusVisible': {
                outline: `2px solid ${appColors.brand.amber}`,
                outlineOffset: -2,
              },
              '& .MuiSvgIcon-root': {
                position: 'absolute',
                top: navigationCollapsed ? 16 : 22,
                right: 8,
                zIndex: 2,
                transform: navigationCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: (theme) =>
                  theme.transitions.create('transform', {
                    duration: theme.transitions.duration.short,
                    easing: theme.transitions.easing.easeInOut,
                  }),
              },
              '@media (prefers-reduced-motion: reduce)': {
                transition: 'none',
                '&::before, &::after': { transition: 'none' },
                '& .MuiSvgIcon-root': { transition: 'none' },
              },
            }}
          >
            <ChevronLeftOutlinedIcon fontSize="small" />
            {navigationCollapsed ? (
              <>
                <Tooltip
                  title="Georgia Routing Planner"
                  placement="bottom-start"
                  slotProps={{
                    popper: {
                      modifiers: [{ name: 'offset', options: { offset: [0, 2] } }],
                    },
                  }}
                >
                  <Box
                    aria-hidden="true"
                    component="span"
                    data-testid="collapsed-project-tooltip-target"
                    sx={{
                      position: 'absolute',
                      zIndex: 3,
                      inset: '0 auto 0 0',
                      width: 44,
                    }}
                  />
                </Tooltip>
                <Tooltip title="Show navigation" placement="right">
                  <Box
                    aria-hidden="true"
                    component="span"
                    data-testid="collapsed-show-navigation-tooltip-target"
                    sx={{
                      position: 'absolute',
                      zIndex: 3,
                      inset: '0 0 0 auto',
                      width: 36,
                    }}
                  />
                </Tooltip>
              </>
            ) : null}
          </IconButton>
        </Tooltip>
      </Box>

      <SettingsDialog
        developerMode={developerMode}
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onDeveloperModeChange={handleDeveloperModeChange}
        storageUsage={storageUsage}
      />
      <ShareMapDialog
        open={shareOpen}
        onClose={() => {
          setShareOpen(false);
        }}
      />
      {developerMode ? (
        <DeveloperDrawer
          open={developerDrawerOpen}
          onClose={() => {
            setDeveloperDrawerOpen(false);
          }}
          onTriggerFailure={() => {
            setControlledFailure(true);
          }}
        />
      ) : null}
    </Box>
  );
}
