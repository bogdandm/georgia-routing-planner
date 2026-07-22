import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import type { StorageUsageReader } from '@/application/ports/StorageUsageReader';
import { StorageUsagePanel } from '@/presentation/shell/StorageUsagePanel';

type SettingsTab = 'general' | 'storage';

interface SettingsDialogProps {
  readonly developerMode: boolean;
  readonly onClose: () => void;
  readonly onDeveloperModeChange: (value: boolean) => void;
  readonly open: boolean;
  readonly storageUsage: StorageUsageReader;
}

export function SettingsDialog({
  developerMode,
  onClose,
  onDeveloperModeChange,
  open,
  storageUsage,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  if (!open) return null;

  return (
    <Paper
      role="dialog"
      aria-modal="false"
      aria-labelledby="settings-panel-title"
      elevation={8}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      sx={{
        position: 'fixed',
        zIndex: (theme) => theme.zIndex.modal,
        top: '50%',
        left: '50%',
        width: 'min(560px, calc(100vw - 24px))',
        maxHeight: 'calc(100dvh - 24px)',
        display: 'flex',
        flexDirection: 'column',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <DialogTitle id="settings-panel-title" sx={{ px: 2, py: 1.25 }}>
        Settings
      </DialogTitle>
      <Tabs
        value={activeTab}
        onChange={(_event, value: SettingsTab) => {
          setActiveTab(value);
        }}
        aria-label="Settings tabs"
        sx={{
          minHeight: 42,
          px: 1,
          borderTop: 1,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTabs-flexContainer': { gap: 0.25 },
          '& .MuiTab-root': {
            flex: '0 0 auto',
            minWidth: 0,
            minHeight: 42,
            mx: 0,
            mb: 0,
            px: 1.25,
            py: 1,
            borderRadius: 0,
            bgcolor: 'transparent',
            color: 'text.primary',
            fontSize: '0.875rem',
            fontWeight: 600,
            textTransform: 'none',
          },
          '& .MuiTab-root.Mui-selected': {
            bgcolor: 'transparent',
            color: 'primary.main',
          },
          '& .MuiTab-root.Mui-focusVisible': {
            outline: 'none',
            boxShadow: 'inset 0 -4px 0 rgba(33, 158, 188, 0.3)',
          },
          '& .MuiTabs-indicator': {
            height: 2,
            borderRadius: 0,
            bgcolor: 'info.main',
          },
        }}
      >
        <Tab disableRipple value="general" label="General" />
        <Tab disableRipple value="storage" label="Storage" />
      </Tabs>

      <DialogContent sx={{ minHeight: 120, px: 2, py: 1.5 }}>
        {activeTab === 'general' ? (
          <Stack spacing={0.75} role="tabpanel" aria-label="General settings">
            <FormControlLabel
              sx={{ m: 0 }}
              control={
                <Switch
                  checked={developerMode}
                  onChange={(event) => {
                    onDeveloperModeChange(event.target.checked);
                  }}
                />
              }
              label="Enable developer diagnostics"
            />
            <Typography variant="body2" color="text.secondary">
              Exposes local logs, health checks, and diagnostics export. Nothing is
              uploaded automatically.
            </Typography>
          </Stack>
        ) : null}

        {activeTab === 'storage' ? (
          <Box role="tabpanel" aria-label="Storage usage settings">
            <StorageUsagePanel reader={storageUsage} />
          </Box>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 1.5, py: 0.75 }}>
        <Button size="small" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Paper>
  );
}
