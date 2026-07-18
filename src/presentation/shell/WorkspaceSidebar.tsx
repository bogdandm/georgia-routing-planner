import AddIcon from '@mui/icons-material/Add';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import SatelliteAltOutlinedIcon from '@mui/icons-material/SatelliteAltOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SortOutlinedIcon from '@mui/icons-material/SortOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useSyncExternalStore, type ReactNode } from 'react';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { EmptyState } from '@/presentation/shell/EmptyState';
import { defaultGeorgiaCamera } from '@/presentation/map/mapTypes';
import type { WorkspaceTab } from '@/presentation/shell/uiStore';
import { appColors } from '@/presentation/theme/appColors';

interface WorkspaceSidebarProps {
  readonly activeTab: WorkspaceTab;
}

interface SidebarDefinition {
  readonly actions: ReactNode;
  readonly title: string;
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

interface SatelliteContentProps {
  readonly coordinates: string;
}

function SatelliteContent({ coordinates }: SatelliteContentProps) {
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Select
        fullWidth
        size="small"
        value="viewport"
        inputProps={{ 'aria-label': 'Search area source' }}
        renderValue={() => (
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ minWidth: 58, fontWeight: 700 }}>
              Viewport
            </Typography>
            <Divider orientation="vertical" flexItem />
            <Typography variant="body2" color="text.secondary" noWrap>
              {coordinates}
            </Typography>
          </Stack>
        )}
      >
        <MenuItem value="viewport">Viewport</MenuItem>
        <MenuItem value="marker" disabled>
          Marker
        </MenuItem>
      </Select>

      <Divider />
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography component="h3" variant="subtitle2" sx={{ flex: 1 }}>
          Date range
        </Typography>
        <Chip size="small" label="Not configured" />
      </Stack>
      <Paper
        variant="outlined"
        sx={{ p: 2, display: 'flex', gap: 1.5, bgcolor: appColors.surface.subtle }}
      >
        <CalendarMonthOutlinedIcon color="primary" />
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            Acquisition calendar
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Date and cloud filters arrive with imagery search.
          </Typography>
        </Box>
      </Paper>

      <Divider />
      <Typography component="h3" variant="subtitle2">
        Sentinel options
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <ToggleButtonGroup disabled exclusive fullWidth size="small" value="l2a">
          <ToggleButton value="l1c">L1C</ToggleButton>
          <ToggleButton value="l2a">L2A</ToggleButton>
        </ToggleButtonGroup>
        <Chip
          size="small"
          label="Cloud ≤ 25%"
          sx={{
            bgcolor: appColors.tag.teal.background,
            color: appColors.tag.teal.foreground,
          }}
        />
      </Stack>
      <Button disabled fullWidth variant="contained" startIcon={<SearchIcon />}>
        Search images
      </Button>

      <EmptyState
        icon={<SatelliteAltOutlinedIcon fontSize="large" />}
        title="Imagery search is not available yet"
        description="The map remains usable while the Sentinel workflow is deferred."
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

function LayersContent() {
  return (
    <Box sx={{ p: 2 }}>
      <EmptyState
        icon={<LayersOutlinedIcon fontSize="large" />}
        title="Layer controls are not available yet"
        description="Map layer visibility and ordering arrive in a later phase."
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
    actions: disabledAction(
      'More imagery actions arrive with imagery search',
      <IconButton disabled size="small" aria-label="More satellite actions">
        <MoreVertIcon />
      </IconButton>,
    ),
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
        width: { xs: 344, xl: 408 },
        flexShrink: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        boxShadow: '4px 0 18px rgba(2, 48, 71, 0.1)',
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
      <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto' }}>
        {activeTab === 'tracks' ? <TracksContent /> : null}
        {activeTab === 'satellite' ? (
          <SatelliteContent coordinates={searchAreaCoordinates} />
        ) : null}
        {activeTab === 'markers' ? <MarkersContent /> : null}
        {activeTab === 'layers' ? <LayersContent /> : null}
      </Box>
    </Box>
  );
}
