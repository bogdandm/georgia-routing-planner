import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { DeveloperDrawer } from '@/presentation/developer-tools/DeveloperDrawer';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { MapSearchPlaceholder } from '@/presentation/shell/MapSearchPlaceholder';
import { OperationalStatus } from '@/presentation/shell/OperationalStatus';
import { SettingsDialog } from '@/presentation/shell/SettingsDialog';
import { useUiStore, type WorkspaceTab } from '@/presentation/shell/uiStore';
import { WorkspaceRail } from '@/presentation/shell/WorkspaceRail';
import { WorkspaceSidebar } from '@/presentation/shell/WorkspaceSidebar';
import {
  workspaceHashForTab,
  workspaceTabFromHash,
} from '@/presentation/shell/workspaceTabLocation';

interface WorkspaceShellProps {
  readonly mapSurface?: ReactNode;
}

function ControlledFailure(): never {
  throw new Error('Controlled Phase 0 component failure.');
}

export function WorkspaceShell({ mapSurface = <MapWorkspace /> }: WorkspaceShellProps) {
  const { database, logger, mapLayers } = useRuntimeServices();
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
  const developerModeChangedByUser = useRef(false);
  const navigationChangedByUser = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const urlEnabled =
      new URLSearchParams(window.location.search).get('developer') === '1';

    const loadPreferences = async () => {
      try {
        const preferences = await database.loadUiPreferences();
        if (!cancelled && !developerModeChangedByUser.current) {
          setDeveloperMode(urlEnabled || preferences.developerMode);
        }
        if (!cancelled && !navigationChangedByUser.current) {
          setNavigationCollapsed(preferences.navigationCollapsed);
        }
      } catch {
        if (!cancelled && !developerModeChangedByUser.current) {
          setDeveloperMode(urlEnabled);
        }
        logger.log({ level: 'warn', name: 'storage.settings.load-failed' });
      }
    };

    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, [database, logger, setDeveloperMode, setNavigationCollapsed]);

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
    developerModeChangedByUser.current = true;
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
    navigationChangedByUser.current = true;
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
          bottom: navigationCollapsed ? 'auto' : 6,
          height: navigationCollapsed ? 60 : 'auto',
          zIndex: 4,
          display: 'flex',
          gap: 0,
          filter: navigationCollapsed
            ? 'none'
            : 'drop-shadow(0 8px 14px rgba(2, 48, 71, 0.2))',
          transition: (theme) =>
            theme.transitions.create(['height', 'bottom'], {
              duration: theme.transitions.duration.shorter,
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
          onLogoClick={() => {
            if (navigationCollapsed) handleNavigationCollapsedChange(false);
          }}
        />
        <Box
          sx={{
            minWidth: 0,
            height: '100%',
            display: 'flex',
            gap: 0,
            opacity: navigationCollapsed ? 0 : 1,
            transform: navigationCollapsed ? 'translateX(-16px)' : 'translateX(0)',
            pointerEvents: navigationCollapsed ? 'none' : 'auto',
            visibility: navigationCollapsed ? 'hidden' : 'visible',
            transition: (theme) => theme.transitions.create(['opacity', 'transform']),
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
              borderRadius: '0 8px 8px 0',
            }}
          />
        </Box>
        {navigationCollapsed ? null : (
          <Tooltip title="Hide navigation" placement="right">
            <IconButton
              aria-label="Hide navigation"
              onClick={() => {
                handleNavigationCollapsedChange(true);
              }}
              size="small"
              sx={{
                position: 'absolute',
                top: 12,
                right: -18,
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
                boxShadow: 2,
                '&:hover': { bgcolor: 'background.paper' },
              }}
            >
              <ChevronLeftOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <SettingsDialog
        developerMode={developerMode}
        navigationCollapsed={navigationCollapsed}
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onDeveloperModeChange={handleDeveloperModeChange}
        onNavigationCollapsedChange={handleNavigationCollapsedChange}
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
