import AddIcon from '@mui/icons-material/Add';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SortOutlinedIcon from '@mui/icons-material/SortOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  Box,
  Button,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useSyncExternalStore, type ReactNode } from 'react';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';
import { SatelliteBrowser } from '@/presentation/satellite-browser/SatelliteBrowser';
import { LayersPanel } from '@/presentation/layers/LayersPanel';
import type { WorkspaceTab } from '@/presentation/shell/uiStore';
import { appColors } from '@/presentation/theme/appColors';

interface WorkspaceSidebarProps {
  readonly activeTab: WorkspaceTab;
}

interface SidebarDefinition {
  readonly actions: ReactNode;
  readonly title: string;
}

interface EmptyStateProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
}

function EmptyState({ description, icon, title }: EmptyStateProps) {
  return (
    <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
      <Box aria-hidden sx={{ mb: 1, color: 'primary.main' }}>
        {icon}
      </Box>
      <Typography component="h2" variant="subtitle1" color="text.primary">
        {title}
      </Typography>
      <Typography variant="body2">{description}</Typography>
    </Box>
  );
}

function TracksContent() {
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={0.75}>
        <TextField
          fullWidth
          disabled
          size="small"
          aria-label="Search tracks"
          placeholder="Search tracks"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title="Track filters arrive with the catalog">
          <span>
            <IconButton disabled aria-label="Filter tracks">
              <FilterAltOutlinedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Track sorting arrives with the catalog">
          <span>
            <IconButton disabled aria-label="Sort tracks">
              <SortOutlinedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography component="h3" variant="subtitle2" sx={{ flex: 1 }}>
          Folders
        </Typography>
        <Button disabled size="small" startIcon={<AddIcon />}>
          New
        </Button>
      </Stack>
      <Paper variant="outlined" sx={{ bgcolor: appColors.surface.subtle }}>
        <EmptyState
          icon={<FolderOutlinedIcon />}
          title="No track folders yet"
          description="Catalog and personal folder management arrive in a later phase."
        />
      </Paper>

      <Divider />
      <Typography component="h3" variant="subtitle2">
        Track library
      </Typography>
      <EmptyState
        icon={<RouteOutlinedIcon fontSize="large" />}
        title="No tracks loaded"
        description="The searchable hiking catalog and GPX import workflow are not implemented yet."
      />
    </Stack>
  );
}

function MarkersContent() {
  return (
    <Box sx={{ p: 2 }}>
      <EmptyState
        icon={<PlaceOutlinedIcon fontSize="large" />}
        title="No saved markers"
        description="Saved map markers arrive in a later phase."
      />
    </Box>
  );
}

function disabledAction(title: string, child: ReactNode) {
  return (
    <Tooltip title={title}>
      <span>{child}</span>
    </Tooltip>
  );
}

const definitions: Record<WorkspaceTab, SidebarDefinition> = {
  tracks: {
    title: 'Tracks',
    actions: (
      <Stack direction="row" spacing={0.75}>
        {disabledAction(
          'GPX import arrives in a later phase',
          <IconButton disabled size="small" aria-label="Import GPX">
            <UploadFileOutlinedIcon />
          </IconButton>,
        )}
        {disabledAction(
          'Manual planning starts here in a later phase',
          <Button disabled size="small" variant="contained" startIcon={<AddIcon />}>
            Create GPX
          </Button>,
        )}
      </Stack>
    ),
  },
  satellite: {
    title: 'Satellite imagery',
    actions: null,
  },
  markers: {
    title: 'Markers',
    actions: disabledAction(
      'Marker creation arrives in a later phase',
      <Button disabled size="small" variant="contained" startIcon={<AddIcon />}>
        New marker
      </Button>,
    ),
  },
  layers: {
    title: 'Layers',
    actions: null,
  },
};

export function WorkspaceSidebar({ activeTab }: WorkspaceSidebarProps) {
  const { mapDiagnostics } = useRuntimeServices();
  const subscribeToMap = useCallback(
    (listener: () => void) => mapDiagnostics.subscribe(listener),
    [mapDiagnostics],
  );
  const getMapSnapshot = useCallback(
    () => mapDiagnostics.getSnapshot(),
    [mapDiagnostics],
  );
  const mapSnapshot = useSyncExternalStore(
    subscribeToMap,
    getMapSnapshot,
    getMapSnapshot,
  );
  const definition = definitions[activeTab];
  const camera = mapSnapshot?.camera ?? defaultGeorgiaCamera;
  const searchAreaCoordinates = `${camera.latitude.toFixed(4)}, ${camera.longitude.toFixed(4)}`;

  return (
    <Box
      component="aside"
      aria-label={`${definition.title} tools`}
      sx={{
        position: 'relative',
        zIndex: 3,
        width: activeTab === 'satellite' ? { xs: 420, xl: 464 } : { xs: 344, xl: 408 },
        flexShrink: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        borderRadius: 0,
        overflow: 'hidden',
        boxShadow: 'none',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          minHeight: 64,
          px: 2,
          bgcolor: appColors.surface.subtle,
          borderBottom: `1px solid ${appColors.brand.sky}`,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="h1" variant="h6" noWrap>
            {definition.title}
          </Typography>
        </Box>
        {definition.actions}
      </Stack>
      <Box sx={{ minHeight: 0, flex: 1, overflowX: 'hidden', overflowY: 'auto' }}>
        <Box sx={{ display: activeTab === 'tracks' ? 'block' : 'none' }}>
          <TracksContent />
        </Box>
        <Box sx={{ display: activeTab === 'satellite' ? 'block' : 'none' }}>
          <SatelliteBrowser
            active={activeTab === 'satellite'}
            fallbackCoordinates={searchAreaCoordinates}
          />
        </Box>
        <Box sx={{ display: activeTab === 'markers' ? 'block' : 'none' }}>
          <MarkersContent />
        </Box>
        <Box sx={{ display: activeTab === 'layers' ? 'block' : 'none' }}>
          <LayersPanel />
        </Box>
      </Box>
    </Box>
  );
}
