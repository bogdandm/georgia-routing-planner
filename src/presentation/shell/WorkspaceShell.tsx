import { Box } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { DeveloperDrawer } from '@/presentation/developer-tools/DeveloperDrawer';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { MapSearchPlaceholder } from '@/presentation/shell/MapSearchPlaceholder';
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
  const { database, logger } = useRuntimeServices();
  const activeTab = useUiStore((state) => state.activeTab);
  const developerDrawerOpen = useUiStore((state) => state.developerDrawerOpen);
  const developerMode = useUiStore((state) => state.developerMode);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setDeveloperDrawerOpen = useUiStore((state) => state.setDeveloperDrawerOpen);
  const setDeveloperMode = useUiStore((state) => state.setDeveloperMode);
  const setMapDebugOptions = useUiStore((state) => state.setMapDebugOptions);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const [controlledFailure, setControlledFailure] = useState(false);
  const developerModeChangedByUser = useRef(false);

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
  }, [database, logger, setDeveloperMode]);

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

  const persistDeveloperMode = async (value: boolean) => {
    try {
      await database.saveUiPreferences({ developerMode: value });
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
    void persistDeveloperMode(value);
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
        display: 'flex',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <WorkspaceRail
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
      />
      <WorkspaceSidebar activeTab={activeTab} />
      {activeTab === 'satellite' ? (
        <Box
          id="satellite-results-pane"
          sx={{ minHeight: 0, display: 'flex', flexShrink: 0 }}
        />
      ) : null}

      <Box component="main" sx={{ minWidth: 0, minHeight: 0, flex: 1 }}>
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
          {mapSurface}
          <MapSearchPlaceholder />
        </Box>
      </Box>

      <SettingsDialog
        developerMode={developerMode}
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onDeveloperModeChange={handleDeveloperModeChange}
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
