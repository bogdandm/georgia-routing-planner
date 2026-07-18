import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import SatelliteAltOutlinedIcon from '@mui/icons-material/SatelliteAltOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import {
  AppBar,
  Box,
  Button,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { DeveloperDrawer } from '@/presentation/developer-tools/DeveloperDrawer';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { EmptyState } from '@/presentation/shell/EmptyState';
import { SettingsDialog } from '@/presentation/shell/SettingsDialog';
import { useUiStore, type WorkspaceTab } from '@/presentation/shell/uiStore';

interface WorkspaceShellProps {
  readonly mapSurface?: ReactNode;
}

function ControlledFailure(): never {
  throw new Error('Controlled Phase 0 component failure.');
}

const emptyStates: Record<WorkspaceTab, ReactNode> = {
  tracks: (
    <EmptyState
      icon={<LayersOutlinedIcon fontSize="large" />}
      title="No tracks loaded"
      description="The searchable hiking catalog arrives in Phase 2."
    />
  ),
  plan: (
    <EmptyState
      icon={<RouteOutlinedIcon fontSize="large" />}
      title="No active plan"
      description="Manual waypoint planning arrives in Phase 5."
    />
  ),
  satellite: (
    <EmptyState
      icon={<SatelliteAltOutlinedIcon fontSize="large" />}
      title="No satellite layer"
      description="Sentinel imagery exploration arrives in Phase 6."
    />
  ),
};

export function WorkspaceShell({ mapSurface = <MapWorkspace /> }: WorkspaceShellProps) {
  const { database, logger } = useRuntimeServices();
  const activeTab = useUiStore((state) => state.activeTab);
  const developerDrawerOpen = useUiStore((state) => state.developerDrawerOpen);
  const developerMode = useUiStore((state) => state.developerMode);
  const elevationExpanded = useUiStore((state) => state.elevationExpanded);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setDeveloperDrawerOpen = useUiStore((state) => state.setDeveloperDrawerOpen);
  const setDeveloperMode = useUiStore((state) => state.setDeveloperMode);
  const setElevationExpanded = useUiStore((state) => state.setElevationExpanded);
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

  const handleTabChange = (_event: SyntheticEvent, value: WorkspaceTab) => {
    setActiveTab(value);
  };

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
    }
    void persistDeveloperMode(value);
  };

  return (
    <Box
      sx={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <AppBar position="static" color="primary" elevation={1}>
        <Toolbar>
          <RouteOutlinedIcon sx={{ mr: 1.5 }} />
          <Typography component="h1" variant="h6" sx={{ flexGrow: 1 }}>
            Georgia Routing Planner
          </Typography>
          <Tooltip title="Import becomes available in a later phase">
            <span>
              <Button color="inherit" disabled>
                Import GPX
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="More actions">
            <span>
              <IconButton color="inherit" disabled aria-label="More actions">
                <MoreVertIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Settings">
            <IconButton
              color="inherit"
              aria-label="Open settings"
              onClick={() => {
                setSettingsOpen(true);
              }}
            >
              <SettingsOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box sx={{ minHeight: 0, flex: 1, display: 'flex' }}>
        <Drawer
          variant="permanent"
          sx={{
            width: 288,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: 288,
              position: 'relative',
              boxSizing: 'border-box',
              overflowY: 'auto',
            },
          }}
        >
          <Tabs
            aria-label="Workspace sections"
            orientation="vertical"
            value={activeTab}
            onChange={handleTabChange}
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab
              icon={<LayersOutlinedIcon />}
              iconPosition="start"
              label="Tracks"
              value="tracks"
            />
            <Tab
              icon={<RouteOutlinedIcon />}
              iconPosition="start"
              label="Plan"
              value="plan"
            />
            <Tab
              icon={<SatelliteAltOutlinedIcon />}
              iconPosition="start"
              label="Satellite"
              value="satellite"
            />
          </Tabs>
          {emptyStates[activeTab]}
          {developerMode ? (
            <Box sx={{ px: 2, pb: 2 }}>
              <Button
                fullWidth
                startIcon={<BugReportOutlinedIcon />}
                variant="outlined"
                onClick={() => {
                  setDeveloperDrawerOpen(true);
                }}
              >
                Developer diagnostics
              </Button>
            </Box>
          ) : null}
        </Drawer>

        <Box
          component="main"
          sx={{
            minWidth: 0,
            minHeight: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box sx={{ minHeight: 240, flex: 1, position: 'relative' }}>{mapSurface}</Box>
          <Divider />
          <Paper square elevation={4}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ minHeight: 48, px: 2, alignItems: 'center' }}
            >
              <TimelineOutlinedIcon color="primary" />
              <Typography component="h2" variant="subtitle1" sx={{ flexGrow: 1 }}>
                Elevation profile
              </Typography>
              <IconButton
                aria-label={
                  elevationExpanded
                    ? 'Collapse elevation profile'
                    : 'Expand elevation profile'
                }
                onClick={() => {
                  setElevationExpanded(!elevationExpanded);
                }}
              >
                {elevationExpanded ? <ExpandMoreIcon /> : <ExpandLessIcon />}
              </IconButton>
            </Stack>
            <Collapse in={elevationExpanded}>
              <Box
                sx={{
                  height: 128,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'background.default',
                  color: 'text.secondary',
                }}
              >
                Select a track or build a plan to see elevation.
              </Box>
            </Collapse>
          </Paper>
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
