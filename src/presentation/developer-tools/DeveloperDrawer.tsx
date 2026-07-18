import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  List,
  ListItem,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type SyntheticEvent } from 'react';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import type { HealthCheckResult } from '@/diagnostics/export/diagnosticBundleSchema';

interface DeveloperDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onTriggerFailure: () => void;
}

type DeveloperTab = 'overview' | 'logs' | 'health';

export function DeveloperDrawer({
  onClose,
  onTriggerFailure,
  open,
}: DeveloperDrawerProps) {
  const { buildInfo, diagnostics, logger } = useRuntimeServices();
  const [activeTab, setActiveTab] = useState<DeveloperTab>('overview');
  const [healthChecks, setHealthChecks] = useState<readonly HealthCheckResult[]>([]);
  const [notes, setNotes] = useState('');
  const [running, setRunning] = useState(false);
  const events = logger.getEvents().slice(-50).reverse();

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

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 } } } }}
    >
      <Box sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <BugReportOutlinedIcon color="primary" />
          <Typography component="h2" variant="h6">
            Developer diagnostics
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Local, bounded, and safe to export. Nothing is uploaded automatically.
        </Typography>
      </Box>
      <Divider />
      <Tabs value={activeTab} onChange={handleTabChange} variant="fullWidth">
        <Tab value="overview" label="Overview" />
        <Tab value="logs" label={`Logs (${String(events.length)})`} />
        <Tab value="health" label="Health" />
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
            <Button color="error" variant="outlined" onClick={onTriggerFailure}>
              Trigger controlled component failure
            </Button>
          </Stack>
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
                Run the checks from Overview to inspect browser, WebGL, storage, and
                IndexedDB health.
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
        <Button onClick={onClose}>Close</Button>
      </Stack>
    </Drawer>
  );
}
