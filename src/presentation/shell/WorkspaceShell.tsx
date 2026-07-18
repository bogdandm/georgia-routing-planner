import { Box } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { DeveloperDrawer } from '@/presentation/developer-tools/DeveloperDrawer';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { MapSearchPlaceholder } from '@/presentation/shell/MapSearchPlaceholder';
import { SettingsDialog } from '@/presentation/shell/SettingsDialog';
import { useUiStore } from '@/presentation/shell/uiStore';
import { WorkspaceRail } from '@/presentation/shell/WorkspaceRail';
import { WorkspaceSidebar } from '@/presentation/shell/WorkspaceSidebar';

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

  useEffect(() => {
    let cancelled = false;
    const urlEnabled =
      new URLSearchParams(window.location.search).get('developer') === '1';

    const loadPreferences = async () => {
      try {
        const preferences = await database.loadUiPreferences();
        if (!cancelled) {
          setDeveloperMode(urlEnabled || preferences.developerMode);
        }
      } catch {
        if (!cancelled) {
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
        onSectionChange={setActiveTab}
        onToggleDeveloperTools={() => {
          setDeveloperDrawerOpen(!developerDrawerOpen);
        }}
        onOpenSettings={() => {
          setSettingsOpen(true);
        }}
      />
      <WorkspaceSidebar activeTab={activeTab} />

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
