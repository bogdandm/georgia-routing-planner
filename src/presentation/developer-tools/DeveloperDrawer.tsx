import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import type { HealthCheckResult } from '@/diagnostics/export/diagnosticBundleSchema';
import { SentinelQueryTimeline } from '@/presentation/developer-tools/SentinelQueryTimeline';
import { useUiStore } from '@/presentation/shell/uiStore';

interface DeveloperDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onTriggerFailure: () => void;
}

type DeveloperTab = 'overview' | 'sentinel-query' | 'map' | 'logs' | 'health';

export function DeveloperDrawer({
  onClose,
  onTriggerFailure,
  open,
}: DeveloperDrawerProps) {
  const {
    buildInfo,
    diagnostics,
    logger,
    mapDiagnostics,
    mapProviderConfiguration,
    sentinelQueryDiagnostics,
  } = useRuntimeServices();
  const [activeTab, setActiveTab] = useState<DeveloperTab>('overview');
  const [healthChecks, setHealthChecks] = useState<readonly HealthCheckResult[]>([]);
  const [notes, setNotes] = useState('');
  const [running, setRunning] = useState(false);
  const [providerRunning, setProviderRunning] = useState(false);
  const providerAbort = useRef<AbortController | null>(null);
  const mapDebugOptions = useUiStore((state) => state.mapDebugOptions);
  const setMapDebugOptions = useUiStore((state) => state.setMapDebugOptions);
  const subscribeToMap = useCallback(
    (listener: () => void) => mapDiagnostics.subscribe(listener),
    [mapDiagnostics],
  );
  const readMapSnapshot = useCallback(
    () => mapDiagnostics.getSnapshot(),
    [mapDiagnostics],
  );
  const mapSnapshot = useSyncExternalStore(
    subscribeToMap,
    readMapSnapshot,
    readMapSnapshot,
  );
  const subscribeToSentinelQuery = useCallback(
    (listener: () => void) => sentinelQueryDiagnostics.subscribe(listener),
    [sentinelQueryDiagnostics],
  );
  const readSentinelQuerySnapshot = useCallback(
    () => sentinelQueryDiagnostics.getSnapshot(),
    [sentinelQueryDiagnostics],
  );
  const sentinelQuerySnapshot = useSyncExternalStore(
    subscribeToSentinelQuery,
    readSentinelQuerySnapshot,
    readSentinelQuerySnapshot,
  );
  const events = logger.getEvents().slice(-50).reverse();

  useEffect(
    () => () => {
      providerAbort.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!open || sentinelQuerySnapshot.status !== 'running') return;

    sentinelQueryDiagnostics.refreshRunningDurations();
    const intervalId = window.setInterval(() => {
      sentinelQueryDiagnostics.refreshRunningDurations();
    }, 250);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [open, sentinelQueryDiagnostics, sentinelQuerySnapshot.status]);

  const handleTabChange = (_event: SyntheticEvent, value: DeveloperTab) => {
    setActiveTab(value);
  };

  const runHealthChecks = async () => {
    setRunning(true);
    try {
      setHealthChecks(await diagnostics.runHealthChecks());
      setActiveTab('health');
    } finally {
      setRunning(false);
    }
  };

  const handleDownload = () => {
    diagnostics.downloadBundle(notes);
  };

  const runProviderChecks = async () => {
    if (mapProviderConfiguration.status !== 'valid') return;
    providerAbort.current?.abort();
    const controller = new AbortController();
    providerAbort.current = controller;
    setProviderRunning(true);
    try {
      setHealthChecks(
        await diagnostics.runProviderHealthChecks(
          mapProviderConfiguration.value,
          controller.signal,
        ),
      );
      setActiveTab('health');
    } finally {
      if (providerAbort.current === controller) {
        providerAbort.current = null;
        setProviderRunning(false);
      }
    }
  };

  const handleClose = () => {
    providerAbort.current?.abort();
    onClose();
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      variant="persistent"
      slotProps={{
        paper: {
          role: 'complementary',
          'aria-labelledby': 'developer-diagnostics-title',
          sx: {
            width: { xs: '100%', sm: 440 },
            borderLeft: 1,
            borderColor: 'divider',
            boxShadow: 'none',
          },
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <BugReportOutlinedIcon color="primary" />
            <Typography id="developer-diagnostics-title" component="h2" variant="h6">
              Developer diagnostics
            </Typography>
          </Stack>
          <IconButton
            aria-label="Close developer diagnostics"
            size="small"
            onClick={handleClose}
          >
            <CloseOutlinedIcon />
          </IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Local, bounded, and safe to export. Nothing is uploaded automatically.
        </Typography>
      </Box>
      <Divider />
      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        variant="scrollable"
        aria-label="Developer diagnostics sections"
        sx={{
          minHeight: 44,
          px: 1,
          '& .MuiTab-root': {
            minWidth: 'auto',
            minHeight: 44,
            m: 0,
            px: 1.5,
            py: 1,
            borderRadius: 0,
            color: 'text.secondary',
            fontSize: '0.8125rem',
            lineHeight: 1.25,
          },
          '& .MuiTab-root.Mui-selected': {
            color: 'primary.main',
            bgcolor: 'transparent',
          },
          '& .MuiTabs-indicator': {
            height: 2,
            borderRadius: 0,
          },
        }}
      >
        <Tab disableRipple value="overview" label="Overview" />
        <Tab disableRipple value="sentinel-query" label="Sentinel query" />
        <Tab disableRipple value="map" label="Map" />
        <Tab disableRipple value="logs" label={`Logs (${String(events.length)})`} />
        <Tab disableRipple value="health" label="Health" />
      </Tabs>
      <Divider />

      <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
        {activeTab === 'overview' ? (
          <Stack spacing={2}>
            <Alert severity="info">Developer mode is active for this browser.</Alert>
            <Box>
              <Typography variant="overline">Build</Typography>
              <Typography variant="body2">Version: {buildInfo.appVersion}</Typography>
              <Typography variant="body2">Commit: {buildInfo.commit}</Typography>
              <Typography variant="body2">Mode: {buildInfo.mode}</Typography>
            </Box>
            <Button
              startIcon={<HealthAndSafetyOutlinedIcon />}
              variant="outlined"
              disabled={running}
              onClick={() => void runHealthChecks()}
            >
              {running ? 'Running checks…' : 'Run local health checks'}
            </Button>
            <Button
              variant="outlined"
              disabled={providerRunning || mapProviderConfiguration.status !== 'valid'}
              onClick={() => void runProviderChecks()}
            >
              {providerRunning
                ? 'Checking configured providers…'
                : 'Check configured providers'}
            </Button>
            {mapProviderConfiguration.status === 'invalid' ? (
              <Alert severity="error">{mapProviderConfiguration.message}</Alert>
            ) : null}
            <Button color="error" variant="outlined" onClick={onTriggerFailure}>
              Trigger controlled component failure
            </Button>
          </Stack>
        ) : null}

        {activeTab === 'sentinel-query' ? (
          <SentinelQueryTimeline snapshot={sentinelQuerySnapshot} />
        ) : null}

        {activeTab === 'map' ? (
          mapSnapshot === null ? (
            <Alert severity="info">
              The map has not published a diagnostics snapshot yet.
            </Alert>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Chip label={mapSnapshot.lifecycle} size="small" />
                <Chip label={mapSnapshot.terrainMode} size="small" />
                <Chip label={mapSnapshot.webGlContext} size="small" />
              </Stack>
              <Box>
                <Typography variant="overline">Exact current camera</Typography>
                <Typography variant="body2">
                  Longitude {mapSnapshot.camera.longitude.toFixed(5)}, latitude{' '}
                  {mapSnapshot.camera.latitude.toFixed(5)}
                </Typography>
                <Typography variant="body2">
                  Zoom {mapSnapshot.camera.zoom.toFixed(2)}, bearing{' '}
                  {mapSnapshot.camera.bearing.toFixed(1)}°, pitch{' '}
                  {mapSnapshot.camera.pitch.toFixed(1)}°
                </Typography>
              </Box>
              <Box>
                <Typography variant="overline">Style and WebGL</Typography>
                <Typography variant="body2">Style: {mapSnapshot.styleId}</Typography>
                <Typography variant="body2">
                  Context: {mapSnapshot.webGlCapabilities.contextType}; version:{' '}
                  {mapSnapshot.webGlCapabilities.version ?? 'unknown'}
                </Typography>
                <Typography variant="body2">
                  Max texture:{' '}
                  {mapSnapshot.webGlCapabilities.maxTextureSize ?? 'unknown'}; last
                  idle: {mapSnapshot.lastIdleAt ?? 'not yet'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="overline">MapLibre debug rendering</Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={mapDebugOptions.showTileBoundaries}
                      onChange={(event) => {
                        setMapDebugOptions({
                          ...mapDebugOptions,
                          showTileBoundaries: event.target.checked,
                        });
                      }}
                    />
                  }
                  label="Show tile boundaries"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={mapDebugOptions.showCollisionBoxes}
                      onChange={(event) => {
                        setMapDebugOptions({
                          ...mapDebugOptions,
                          showCollisionBoxes: event.target.checked,
                        });
                      }}
                    />
                  }
                  label="Show collision boxes"
                />
              </Box>
              <Box>
                <Typography variant="overline">
                  Ordered sources ({String(mapSnapshot.sourceIds.length)})
                </Typography>
                <List dense disablePadding aria-label="Ordered map sources">
                  {mapSnapshot.sourceIds.map((sourceId) => (
                    <ListItem key={sourceId} disableGutters>
                      <ListItemText primary={sourceId} />
                    </ListItem>
                  ))}
                </List>
              </Box>
              <Box>
                <Typography variant="overline">
                  Ordered layers ({String(mapSnapshot.layerIds.length)})
                </Typography>
                <List dense disablePadding aria-label="Ordered map layers">
                  {mapSnapshot.layerIds.map((layerId) => (
                    <ListItem key={layerId} disableGutters>
                      <ListItemText primary={layerId} />
                    </ListItem>
                  ))}
                </List>
              </Box>
              <Box>
                <Typography variant="overline">Recent source failures</Typography>
                {mapSnapshot.recoverableFailures.length === 0 ? (
                  <Typography variant="body2">None recorded.</Typography>
                ) : (
                  <List dense disablePadding aria-label="Recent map source failures">
                    {mapSnapshot.recoverableFailures.map((failure) => (
                      <ListItem
                        key={`${failure.category}:${failure.sourceId ?? 'none'}:${failure.reason}:${failure.httpStatus === null ? 'none' : String(failure.httpStatus)}`}
                        disableGutters
                      >
                        <ListItemText
                          primary={`${failure.category} × ${String(failure.count)}`}
                          secondary={[
                            failure.sourceId ?? 'No stable source ID',
                            failure.httpStatus === null
                              ? failure.reason
                              : `HTTP ${String(failure.httpStatus)} · ${failure.reason}`,
                            `Recovery: ${failure.recoveryState}`,
                            failure.retryAttempt === 0
                              ? 'No automatic retry attempted'
                              : `Retry attempt ${String(failure.retryAttempt)}`,
                            `Last failure: ${failure.lastOccurredAt}`,
                          ].join(' · ')}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Box>
            </Stack>
          )
        ) : null}

        {activeTab === 'logs' ? (
          <List dense disablePadding aria-label="Recent diagnostic events">
            {events.length === 0 ? (
              <ListItem>
                <ListItemText primary="No diagnostic events recorded." />
              </ListItem>
            ) : (
              events.map((event) => (
                <ListItem key={event.id} divider alignItems="flex-start">
                  <ListItemText
                    primary={event.name}
                    secondary={`${event.level.toUpperCase()} · ${event.timestamp}`}
                  />
                </ListItem>
              ))
            )}
          </List>
        ) : null}

        {activeTab === 'health' ? (
          <Stack spacing={1.5}>
            {healthChecks.length === 0 ? (
              <Typography color="text.secondary">
                Run local or explicit provider checks from Overview to inspect browser,
                map, WebGL, storage, and reachability health.
              </Typography>
            ) : (
              healthChecks.map((check) => (
                <Box
                  key={check.name}
                  sx={{ p: 1.5, border: 1, borderColor: 'divider' }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ justifyContent: 'space-between' }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{check.name}</Typography>
                    <Chip
                      size="small"
                      label={check.status}
                      color={
                        check.status === 'pass'
                          ? 'success'
                          : check.status === 'warn'
                            ? 'warning'
                            : 'error'
                      }
                    />
                  </Stack>
                  <Typography variant="body2">{check.summary}</Typography>
                  {check.remediation === undefined ? null : (
                    <Typography variant="caption" color="text.secondary">
                      {check.remediation}
                    </Typography>
                  )}
                </Box>
              ))
            )}
          </Stack>
        ) : null}
      </Box>

      <Divider />
      <Stack spacing={1.5} sx={{ p: 2 }}>
        <TextField
          label="Reproduction notes"
          multiline
          minRows={2}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
        <Button
          startIcon={<DownloadOutlinedIcon />}
          variant="contained"
          onClick={handleDownload}
        >
          Download diagnostics
        </Button>
      </Stack>
    </Drawer>
  );
}
