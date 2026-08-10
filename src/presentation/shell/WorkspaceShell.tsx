import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import MenuOutlinedIcon from '@mui/icons-material/MenuOutlined';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import type { MarkerSort } from '@/domain/markers/savedMarker';
import { AboutDialog } from '@/presentation/shell/AboutDialog';
import { DeveloperDrawer } from '@/presentation/developer-tools/DeveloperDrawer';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { cancelMarkerPlacement } from '@/presentation/map/mapInteractionStore';
import { MapSearchPlaceholder } from '@/presentation/shell/MapSearchPlaceholder';
import { MarkersWorkspaceProvider } from '@/presentation/markers/MarkersWorkspace';
import { OperationalStatus } from '@/presentation/shell/OperationalStatus';
import { SettingsDialog } from '@/presentation/shell/SettingsDialog';
import { ShareMapDialog } from '@/presentation/shell/ShareMapDialog';
import { RemoteDeletionDialog } from '@/presentation/user/RemoteDeletionDialog';
import { useUiStore, type WorkspaceTab } from '@/presentation/shell/uiStore';
import { WorkspaceRail } from '@/presentation/shell/WorkspaceRail';
import { WorkspaceSidebar } from '@/presentation/shell/WorkspaceSidebar';
import {
  workspaceHashForTab,
  workspaceTabFromHash,
} from '@/presentation/shell/workspaceTabLocation';
import { appColors } from '@/presentation/theme/appColors';
import type { MapFitPadding } from '@/presentation/map/mapTypes';
import {
  TrackDetailsPane,
  TracksWorkspaceProvider,
  useTracksWorkspace,
} from '@/presentation/tracks/TracksWorkspace';
import { CompactTrackSummary } from '@/presentation/tracks/TrackSummary';

const smartphoneViewportQuery = '(width < 900px)';
const auxiliaryOverlayViewportQuery = '(width < 1900px)';
const contextualSidebarWidths = { xs: 420, xl: 464 } as const;

interface WorkspaceShellProps {
  readonly mapSurface?: ReactNode;
}

const mapCameraMargin = 56;

function ControlledFailure(): never {
  throw new Error('Controlled Phase 0 component failure.');
}

function WorkspaceShellContent({ mapSurface }: WorkspaceShellProps) {
  const {
    database,
    geocodingProviderConfiguration,
    logger,
    mapLayers,
    mapProviderConfiguration,
    storageUsage,
  } = useRuntimeServices();
  const activeTab = useUiStore((state) => state.activeTab);
  const developerDrawerOpen = useUiStore((state) => state.developerDrawerOpen);
  const developerMode = useUiStore((state) => state.developerMode);
  const elevationGradeLegendDismissed = useUiStore(
    (state) => state.elevationGradeLegendDismissed,
  );
  const markerSort = useUiStore((state) => state.markerSort);
  const navigationCollapsed = useUiStore((state) => state.navigationCollapsed);
  const mobileWorkspaceOpen = useUiStore((state) => state.mobileWorkspaceOpen);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setDeveloperDrawerOpen = useUiStore((state) => state.setDeveloperDrawerOpen);
  const setDeveloperMode = useUiStore((state) => state.setDeveloperMode);
  const setElevationGradeLegendDismissed = useUiStore(
    (state) => state.setElevationGradeLegendDismissed,
  );
  const setMapDebugOptions = useUiStore((state) => state.setMapDebugOptions);
  const setMarkerSort = useUiStore((state) => state.setMarkerSort);
  const setNavigationCollapsed = useUiStore((state) => state.setNavigationCollapsed);
  const setMobileWorkspaceOpen = useUiStore((state) => state.setMobileWorkspaceOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const [controlledFailure, setControlledFailure] = useState(false);
  const smartphoneViewport = useMediaQuery(smartphoneViewportQuery);
  const auxiliaryOverlayViewport = useMediaQuery(auxiliaryOverlayViewportQuery);
  const workspaceShellRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const contextualSidebarRef = useRef<HTMLDivElement>(null);
  const aboutTriggerRef = useRef<HTMLButtonElement>(null);
  const theme = useTheme();
  const contextualSidebarWidth = useMediaQuery(theme.breakpoints.up('xl'))
    ? contextualSidebarWidths.xl
    : contextualSidebarWidths.xs;
  const getNavigationPadding = useCallback((): MapFitPadding | undefined => {
    if (smartphoneViewport) return undefined;
    const workspaceShell = workspaceShellRef.current;
    const navigation = navigationRef.current;
    if (workspaceShell === null || navigation === null) return undefined;
    const workspaceBounds = workspaceShell.getBoundingClientRect();
    const navigationBounds = navigation.getBoundingClientRect();
    const contextualSidebar = contextualSidebarRef.current;
    const sidebarWidthShortfall =
      !navigationCollapsed && contextualSidebar !== null
        ? Math.max(
            contextualSidebarWidth - contextualSidebar.getBoundingClientRect().width,
            0,
          )
        : 0;
    const top = Math.min(mapCameraMargin, workspaceBounds.height / 2);
    const left = Math.min(
      Math.max(
        navigationBounds.right -
          workspaceBounds.left +
          sidebarWidthShortfall +
          mapCameraMargin,
        mapCameraMargin,
      ),
      Math.max(workspaceBounds.width - mapCameraMargin, 0),
    );
    if (left === 0) return undefined;
    return { top, right: mapCameraMargin, bottom: top, left };
  }, [contextualSidebarWidth, navigationCollapsed, smartphoneViewport]);
  const [shareOpen, setShareOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [satellitePaneOpen, setSatellitePaneOpen] = useState(false);
  const [mobileTrackDetailsExpandedKey, setMobileTrackDetailsExpandedKey] = useState<
    string | null
  >(null);
  const importPreparingRef = useRef(false);
  const {
    active: activeTrack,
    activeProfile,
    importState,
    recalculationState,
    savePreview,
    setActiveName,
  } = useTracksWorkspace();
  useEffect(() => {
    void mapLayers?.restorePersistedState();
  }, [mapLayers]);
  const activeTrackKey =
    activeTrack === null
      ? null
      : activeTrack.kind === 'preview'
        ? `preview:${activeTrack.id}`
        : `saved:${activeTrack.summary.id}`;
  const mobileTrackDetailsExpanded =
    activeTrackKey !== null && mobileTrackDetailsExpandedKey === activeTrackKey;
  const activeTrackPreparing =
    activeTrack?.kind === 'preview' && activeTrack.preparationStatus === 'preparing';
  const activeTrackMetrics =
    activeTrack === null
      ? null
      : activeTrack.kind === 'preview'
        ? activeTrack.preparationStatus === 'ready'
          ? activeTrack.sourceMetrics
          : null
        : activeTrack.summary.metrics;
  useEffect(() => {
    if (!smartphoneViewport) return;
    const animationFrame = window.requestAnimationFrame(() => {
      setMobileTrackDetailsExpandedKey(null);
      if (activeTrackKey !== null) setMobileWorkspaceOpen(false);
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeTrackKey, setMobileWorkspaceOpen, smartphoneViewport]);

  useEffect(() => {
    if (!smartphoneViewport || activeTab === 'tracks') return;
    const animationFrame = window.requestAnimationFrame(() => {
      setMobileTrackDetailsExpandedKey(null);
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeTab, smartphoneViewport]);

  useEffect(() => {
    if (activeTab !== 'markers') cancelMarkerPlacement();
  }, [activeTab]);

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

  const persistUiPreferences = useCallback(
    async (
      nextDeveloperMode: boolean,
      nextNavigationCollapsed: boolean,
      nextElevationGradeLegendDismissed: boolean,
      nextMarkerSort: typeof markerSort,
    ): Promise<boolean> => {
      try {
        await database.saveUiPreferences({
          developerMode: nextDeveloperMode,
          navigationCollapsed: nextNavigationCollapsed,
          elevationGradeLegendDismissed: nextElevationGradeLegendDismissed,
          markerSort: nextMarkerSort,
        });
        return true;
      } catch {
        logger.log({ level: 'warn', name: 'storage.settings.save-failed' });
        return false;
      }
    },
    [database, logger],
  );

  const handleSectionChange = useCallback(
    (section: WorkspaceTab) => {
      setActiveTab(section);
      const nextUrl = new URL(window.location.href);
      nextUrl.hash = workspaceHashForTab(section);
      window.history.pushState(window.history.state, '', nextUrl);
    },
    [setActiveTab],
  );

  const handleNavigationCollapsedChange = useCallback(
    (value: boolean) => {
      setNavigationCollapsed(value);
      void persistUiPreferences(
        developerMode,
        value,
        elevationGradeLegendDismissed,
        markerSort,
      );
    },
    [
      developerMode,
      elevationGradeLegendDismissed,
      markerSort,
      persistUiPreferences,
      setNavigationCollapsed,
    ],
  );

  const handleDeveloperModeChange = (value: boolean) => {
    setDeveloperMode(value);
    if (!value) {
      setDeveloperDrawerOpen(false);
      setMapDebugOptions({
        showCollisionBoxes: false,
        showTileBoundaries: false,
      });
    }
    void persistUiPreferences(
      value,
      navigationCollapsed,
      elevationGradeLegendDismissed,
      markerSort,
    );
  };

  const handleElevationGradeLegendDismissedChange = (value: boolean) => {
    setElevationGradeLegendDismissed(value);
    void persistUiPreferences(developerMode, navigationCollapsed, value, markerSort);
  };

  const handleMarkerSortChange = async (value: MarkerSort): Promise<boolean> => {
    setMarkerSort(value);
    return persistUiPreferences(
      developerMode,
      navigationCollapsed,
      elevationGradeLegendDismissed,
      value,
    );
  };

  useEffect(() => {
    if (importState !== 'preparing') {
      importPreparingRef.current = false;
      return;
    }
    if (importPreparingRef.current) return;
    importPreparingRef.current = true;

    if (activeTab !== 'tracks') handleSectionChange('tracks');
    if (smartphoneViewport) {
      setMobileWorkspaceOpen(true);
    } else if (navigationCollapsed) {
      handleNavigationCollapsedChange(false);
    }
  }, [
    activeTab,
    handleNavigationCollapsedChange,
    handleSectionChange,
    importState,
    navigationCollapsed,
    setMobileWorkspaceOpen,
    smartphoneViewport,
  ]);

  if (controlledFailure) {
    return <ControlledFailure />;
  }

  const renderedMapSurface = mapSurface ?? (
    <MapWorkspace
      getNavigationPadding={getNavigationPadding}
      onElevationGradeLegendDismissedChange={handleElevationGradeLegendDismissedChange}
    />
  );

  const handleOpenActiveTrackDetails = () => {
    if (!smartphoneViewport || activeTrackKey === null) return;
    setMobileTrackDetailsExpandedKey(activeTrackKey);
    setMobileWorkspaceOpen(true);
  };
  const auxiliaryOverlay = smartphoneViewport || auxiliaryOverlayViewport;
  const activeTrackExists = activeTrack !== null;
  const activeTrackOpen = activeTab === 'tracks' && activeTrackExists;
  const trackDetailsOpen =
    activeTrackOpen && (!smartphoneViewport || mobileTrackDetailsExpanded);
  const satelliteResultsOpen = activeTab === 'satellite' && satellitePaneOpen;
  const auxiliaryOpen = trackDetailsOpen || satelliteResultsOpen;
  const mobileTrackDisclosureOpen =
    smartphoneViewport &&
    activeTrackExists &&
    !mobileWorkspaceOpen &&
    !mobileTrackDetailsExpanded;
  const desktopNavigationCollapsed = !smartphoneViewport && navigationCollapsed;
  const collapsedTrackSummary =
    desktopNavigationCollapsed && activeTrackMetrics !== null ? (
      <CompactTrackSummary metrics={activeTrackMetrics} profile={activeProfile} />
    ) : null;

  return (
    <Box
      ref={workspaceShellRef}
      data-testid="workspace-shell"
      sx={{
        height: '100dvh',
        position: 'relative',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <Box
        component="main"
        aria-hidden={smartphoneViewport && mobileWorkspaceOpen}
        sx={{
          position: 'absolute',
          inset: 0,
          visibility: smartphoneViewport && mobileWorkspaceOpen ? 'hidden' : 'visible',
          pointerEvents: smartphoneViewport && mobileWorkspaceOpen ? 'none' : 'auto',
        }}
      >
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
          {renderedMapSurface}
          <MapSearchPlaceholder />
          <OperationalStatus />
        </Box>
      </Box>

      <IconButton
        aria-controls="mobile-workspace"
        aria-expanded={mobileWorkspaceOpen}
        aria-label="Open workspace"
        onClick={() => {
          setMobileWorkspaceOpen(true);
        }}
        sx={{
          position: 'absolute',
          top: 6,
          left: 6,
          zIndex: 4,
          width: 52,
          height: 52,
          display: smartphoneViewport && !mobileWorkspaceOpen ? 'inline-flex' : 'none',
          bgcolor: appColors.brand.deepSpace,
          color: appColors.text.inverse,
        }}
      >
        <MenuOutlinedIcon />
      </IconButton>

      <Paper
        elevation={4}
        sx={{
          position: 'absolute',
          zIndex: 5,
          right: 12,
          bottom: 'max(12px, env(safe-area-inset-bottom))',
          left: 12,
          display: mobileTrackDisclosureOpen ? 'block' : 'none',
          height: activeTrack?.kind === 'preview' ? 120 : 56,
          bgcolor: 'background.paper',
          overflow: 'hidden',
        }}
      >
        {activeTrack?.kind === 'preview' ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ height: 64, px: 1.5, py: 1.5, alignItems: 'center' }}
          >
            <TextField
              fullWidth
              size="small"
              label="Track name"
              value={activeTrack.name}
              slotProps={{ htmlInput: { maxLength: 200 } }}
              onChange={(event) => {
                setActiveName(event.target.value);
              }}
              sx={{ minWidth: 0, flex: 1 }}
            />
            <Button
              variant="contained"
              disabled={
                activeTrack.preparationStatus !== 'ready' ||
                recalculationState === 'recalculating' ||
                activeTrack.name.trim().length === 0
              }
              onClick={() => void savePreview()}
              sx={{ flexShrink: 0 }}
            >
              Save
            </Button>
          </Stack>
        ) : null}
        <ButtonBase
          aria-label={
            activeTrack?.kind === 'preview'
              ? 'Expand unsaved track details'
              : 'Expand track details'
          }
          onClick={() => {
            if (activeTrackKey !== null) {
              setMobileTrackDetailsExpandedKey(activeTrackKey);
            }
            if (activeTab !== 'tracks') handleSectionChange('tracks');
            setMobileWorkspaceOpen(true);
          }}
          sx={{
            position: 'relative',
            width: '100%',
            height: 56,
            minHeight: 56,
            overflow: 'hidden',
            borderRadius: 'inherit',
          }}
        >
          {activeTrackPreparing ? (
            <Stack
              role="status"
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <CircularProgress size={18} />
              <Typography variant="body2">Preparing terrain and elevation…</Typography>
            </Stack>
          ) : activeTrackMetrics !== null ? (
            <CompactTrackSummary
              showExpandIndicator
              metrics={activeTrackMetrics}
              profile={activeProfile}
            />
          ) : null}
        </ButtonBase>
      </Paper>

      <Box
        ref={navigationRef}
        id={smartphoneViewport ? 'mobile-workspace' : undefined}
        aria-hidden={smartphoneViewport && !mobileWorkspaceOpen}
        sx={{
          position: 'absolute',
          inset: smartphoneViewport ? 0 : undefined,
          top: smartphoneViewport ? undefined : 6,
          left: smartphoneViewport ? undefined : 6,
          width: smartphoneViewport ? '100%' : undefined,
          height: smartphoneViewport
            ? '100dvh'
            : desktopNavigationCollapsed
              ? 64
              : 'calc(100dvh - 12px)',
          zIndex: smartphoneViewport && !mobileWorkspaceOpen ? 3 : 4,
          display: 'flex',
          gap: 0,
          bgcolor: smartphoneViewport ? 'background.paper' : 'transparent',
          filter: smartphoneViewport
            ? 'none'
            : desktopNavigationCollapsed
              ? 'drop-shadow(0 6px 9px rgba(0, 0, 0, 0.18))'
              : 'drop-shadow(0 8px 14px rgba(2, 48, 71, 0.2))',
          visibility: smartphoneViewport && !mobileWorkspaceOpen ? 'hidden' : 'visible',
          opacity: smartphoneViewport && !mobileWorkspaceOpen ? 0 : 1,
          pointerEvents: smartphoneViewport && !mobileWorkspaceOpen ? 'none' : 'auto',
          ...(smartphoneViewport && !mobileWorkspaceOpen
            ? {
                '& *': {
                  visibility: 'hidden',
                  pointerEvents: 'none',
                },
              }
            : {}),
          transition: (theme) =>
            theme.transitions.create(['height', 'filter', 'opacity'], {
              duration: theme.transitions.duration.short,
            }),
        }}
      >
        <Box
          aria-hidden={smartphoneViewport && auxiliaryOpen}
          sx={{
            display: smartphoneViewport && !mobileWorkspaceOpen ? 'none' : 'block',
            visibility:
              smartphoneViewport && (!mobileWorkspaceOpen || auxiliaryOpen)
                ? 'hidden'
                : 'visible',
            pointerEvents:
              smartphoneViewport && (!mobileWorkspaceOpen || auxiliaryOpen)
                ? 'none'
                : 'auto',
          }}
        >
          <WorkspaceRail
            collapsed={desktopNavigationCollapsed}
            collapsedSummary={collapsedTrackSummary}
            squareEdges={smartphoneViewport}
            activeTab={activeTab}
            developerToolsOpen={developerDrawerOpen}
            developerMode={developerMode}
            aboutButtonRef={aboutTriggerRef}
            onOpenTracks={() => {
              handleSectionChange('tracks');
              handleNavigationCollapsedChange(false);
            }}
            onSectionChange={handleSectionChange}
            onToggleDeveloperTools={() => {
              setDeveloperDrawerOpen(!developerDrawerOpen);
            }}
            onOpenAbout={() => {
              setAboutOpen(true);
            }}
            onOpenSettings={() => {
              setSettingsOpen(true);
            }}
            onShare={() => {
              setShareOpen(true);
            }}
            onToggleNavigation={() => {
              if (smartphoneViewport) {
                setMobileWorkspaceOpen(false);
                return;
              }
              handleNavigationCollapsedChange(!navigationCollapsed);
            }}
          />
        </Box>
        <Box
          ref={contextualSidebarRef}
          aria-hidden={auxiliaryOverlay && auxiliaryOpen}
          sx={{
            minWidth: 0,
            width: smartphoneViewport ? 'auto' : contextualSidebarWidths,
            maxWidth: desktopNavigationCollapsed
              ? 0
              : smartphoneViewport
                ? 'none'
                : contextualSidebarWidths,
            height: '100%',
            flex: smartphoneViewport ? 1 : '0 0 auto',
            opacity: desktopNavigationCollapsed ? 0 : 1,
            transform: desktopNavigationCollapsed
              ? 'translateX(-16px)'
              : 'translateX(0)',
            display: smartphoneViewport && !mobileWorkspaceOpen ? 'none' : 'block',
            pointerEvents:
              smartphoneViewport && !mobileWorkspaceOpen
                ? 'none'
                : desktopNavigationCollapsed || (auxiliaryOverlay && auxiliaryOpen)
                  ? 'none'
                  : 'auto',
            visibility:
              smartphoneViewport && !mobileWorkspaceOpen
                ? 'hidden'
                : desktopNavigationCollapsed || (auxiliaryOverlay && auxiliaryOpen)
                  ? 'hidden'
                  : 'visible',
            overflow: 'hidden',
            borderRadius: smartphoneViewport ? 0 : '0 0 8px 0',
            transition: (theme) =>
              `${theme.transitions.create(['opacity', 'transform', 'max-width'], {
                duration: theme.transitions.duration.short,
              })}, visibility 0s linear ${desktopNavigationCollapsed ? '250ms' : '0ms'}`,
          }}
        >
          <WorkspaceSidebar
            activeTab={activeTab}
            auxiliaryOverlay={auxiliaryOverlay}
            fullWidth={smartphoneViewport}
            onMarkerSortChange={handleMarkerSortChange}
            onSatellitePaneOpenChange={setSatellitePaneOpen}
            onOpenActiveTrackDetails={handleOpenActiveTrackDetails}
            onShowMap={() => {
              setMobileWorkspaceOpen(false);
            }}
          />
        </Box>
        <Box
          sx={
            smartphoneViewport
              ? {
                  position: 'absolute',
                  inset: 0,
                  zIndex: 6,
                  display: !mobileWorkspaceOpen || !auxiliaryOpen ? 'none' : 'flex',
                  pointerEvents: mobileWorkspaceOpen && auxiliaryOpen ? 'auto' : 'none',
                  width: '100%',
                  height: '100%',
                }
              : auxiliaryOverlayViewport
                ? {
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 64,
                    zIndex: 5,
                    display:
                      auxiliaryOpen && !desktopNavigationCollapsed ? 'flex' : 'none',
                    width: contextualSidebarWidths,
                  }
                : {
                    position: 'relative',
                    display:
                      auxiliaryOpen && !desktopNavigationCollapsed ? 'flex' : 'none',
                    height: '100%',
                    minHeight: 0,
                    flexShrink: 0,
                  }
          }
        >
          {trackDetailsOpen ? (
            <TrackDetailsPane
              mode={
                smartphoneViewport
                  ? 'mobile'
                  : auxiliaryOverlayViewport
                    ? 'overlay'
                    : 'adjacent'
              }
              onCollapse={() => {
                setMobileTrackDetailsExpandedKey(null);
                setMobileWorkspaceOpen(false);
              }}
              onClosed={() => {
                setMobileTrackDetailsExpandedKey(null);
                setMobileWorkspaceOpen(false);
              }}
            />
          ) : null}
          <Box
            id="satellite-results-pane"
            aria-hidden={!satelliteResultsOpen}
            sx={{
              display: satelliteResultsOpen ? 'flex' : 'none',
              height: '100%',
              minHeight: 0,
              overflow: 'hidden',
              width: auxiliaryOverlay ? '100%' : 'auto',
            }}
          />
        </Box>
        {!smartphoneViewport && !navigationCollapsed ? (
          <Tooltip title="Hide navigation" placement="right">
            <IconButton
              aria-label="Hide navigation"
              data-testid="navigation-collapse-toggle"
              onClick={() => {
                handleNavigationCollapsedChange(true);
              }}
              size="small"
              sx={{
                position: 'absolute',
                zIndex: 5,
                top: 0,
                right: -35,
                width: 36,
                height: 64,
                bgcolor: appColors.surface.subtle,
                borderStyle: 'solid',
                borderWidth: 0,
                borderBottomWidth: 1,
                borderBottomColor: appColors.brand.sky,
                borderRadius: '0 8px 8px 0',
                boxShadow: 0,
                overflow: 'hidden',
                transition: (theme) =>
                  theme.transitions.create(['background-color', 'border-radius'], {
                    duration: theme.transitions.duration.short,
                    easing: theme.transitions.easing.easeInOut,
                  }),
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
                  bgcolor: appColors.surface.subtle,
                  boxShadow: 0,
                  '&::after': { opacity: 1 },
                },
                '&.Mui-focusVisible': {
                  outline: `2px solid ${appColors.brand.amber}`,
                  outlineOffset: -2,
                },
                '& .MuiSvgIcon-root': {
                  position: 'relative',
                  zIndex: 2,
                },
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                  '&::after': { transition: 'none' },
                },
              }}
            >
              <ChevronLeftOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>

      <AboutDialog
        geocodingProviderConfiguration={geocodingProviderConfiguration}
        mapProviderConfiguration={mapProviderConfiguration}
        open={aboutOpen}
        onClose={() => {
          setAboutOpen(false);
        }}
        triggerRef={aboutTriggerRef}
      />
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
      <RemoteDeletionDialog />
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

export function WorkspaceShell(props: WorkspaceShellProps) {
  return (
    <TracksWorkspaceProvider>
      <MarkersWorkspaceProvider>
        <WorkspaceShellContent {...props} />
      </MarkersWorkspaceProvider>
    </TracksWorkspaceProvider>
  );
}
