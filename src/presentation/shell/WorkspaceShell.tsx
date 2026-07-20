import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { DeveloperDrawer } from '@/presentation/developer-tools/DeveloperDrawer';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import {
  defaultSatelliteRenderingTuning,
  type SatelliteRenderingTuning,
} from '@/presentation/map/SatelliteImageryMap';
import { MapSearchPlaceholder } from '@/presentation/shell/MapSearchPlaceholder';
import { OperationalStatus } from '@/presentation/shell/OperationalStatus';
import { SettingsDialog } from '@/presentation/shell/SettingsDialog';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
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
  const [renderingTuning, setRenderingTuning] = useState<SatelliteRenderingTuning>(
    () => mapLayers?.getRenderingTuning() ?? defaultSatelliteRenderingTuning,
  );
  const [renderingTuningPending, setRenderingTuningPending] = useState(false);
  const [renderingTuningError, setRenderingTuningError] = useState<string | null>(null);
  const [terrainOverlayCommandError, setTerrainOverlayCommandError] = useState<
    string | null
  >(null);
  const terrainOverlaySnapshot = useStore(
    mapLayerStore,
    (state) => state.terrainOverlays,
  );
  const terrainComputeStatus = useStore(
    mapLayerStore,
    (state) => state.terrainComputeStatus,
  );
  const renderingTuningAbort = useRef<AbortController | null>(null);
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
    let cancelled = false;
    const restoreMapPreferences = async () => {
      await mapLayers?.restorePersistedState();
      if (!cancelled && mapLayers !== null) {
        setRenderingTuning(mapLayers.getRenderingTuning());
      }
    };
    void restoreMapPreferences();
    return () => {
      cancelled = true;
      renderingTuningAbort.current?.abort();
    };
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

  const handleRenderingTuningChange = async (value: SatelliteRenderingTuning) => {
    setRenderingTuning(value);
    if (mapLayers === null) return;
    renderingTuningAbort.current?.abort();
    const controller = new AbortController();
    renderingTuningAbort.current = controller;
    setRenderingTuningPending(true);
    setRenderingTuningError(null);
    try {
      const result = await mapLayers.setRenderingTuning(value, controller.signal);
      if (result.status === 'failed') {
        setRenderingTuning(mapLayers.getRenderingTuning());
        setRenderingTuningError(result.message);
      }
    } finally {
      if (renderingTuningAbort.current === controller) {
        renderingTuningAbort.current = null;
        setRenderingTuningPending(false);
      }
    }
  };

  const handleTerrainOverlayPreferencesChange = (
    value: typeof terrainOverlaySnapshot.preferences,
  ) => {
    if (mapLayers === null) return;
    const result = mapLayers.setTerrainOverlayPreferences(value);
    setTerrainOverlayCommandError(result.status === 'failed' ? result.message : null);
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
          height: navigationCollapsed ? 48 : 'calc(100dvh - 12px)',
          zIndex: 4,
          display: 'flex',
          gap: 0,
          filter: navigationCollapsed
            ? 'none'
            : 'drop-shadow(0 8px 14px rgba(2, 48, 71, 0.2))',
          transition: (theme) =>
            theme.transitions.create('height', {
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
          onLogoClick={() => {
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
            borderRadius: '0 8px 8px 0',
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
                right: -28,
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
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onDeveloperModeChange={handleDeveloperModeChange}
        renderingTuning={renderingTuning}
        renderingTuningPending={renderingTuningPending}
        renderingTuningError={renderingTuningError}
        storageUsage={storageUsage}
        onRenderingTuningDraftChange={setRenderingTuning}
        onRenderingTuningChange={(value) => {
          void handleRenderingTuningChange(value);
        }}
        terrainOverlayPreferences={terrainOverlaySnapshot.preferences}
        terrainComputeStatus={terrainComputeStatus}
        terrainOverlayError={
          terrainOverlayCommandError ?? terrainOverlaySnapshot.message
        }
        onTerrainOverlayPreferencesChange={handleTerrainOverlayPreferencesChange}
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
