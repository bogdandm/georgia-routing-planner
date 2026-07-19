import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Switch,
  Typography,
} from '@mui/material';

interface SettingsDialogProps {
  readonly developerMode: boolean;
  readonly navigationCollapsed: boolean;
  readonly onClose: () => void;
  readonly onDeveloperModeChange: (value: boolean) => void;
  readonly onNavigationCollapsedChange: (value: boolean) => void;
  readonly open: boolean;
}

export function SettingsDialog({
  developerMode,
  navigationCollapsed,
  onClose,
  onDeveloperModeChange,
  onNavigationCollapsedChange,
  open,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Settings</DialogTitle>
      <DialogContent dividers>
        <FormGroup>
          <FormControlLabel
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
        </FormGroup>
        <Typography variant="body2" color="text.secondary">
          Developer mode exposes local logs, health checks, and diagnostics export. It
          never uploads data automatically.
        </Typography>
        <FormGroup sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={navigationCollapsed}
                onChange={(event) => {
                  onNavigationCollapsedChange(event.target.checked);
                }}
              />
            }
            label="Collapse left navigation"
          />
        </FormGroup>
        <Typography variant="body2" color="text.secondary">
          Hides the workspace rail and tools to maximize the map. Use the expand button
          on the map to restore navigation.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
