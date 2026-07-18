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
  readonly onClose: () => void;
  readonly onDeveloperModeChange: (value: boolean) => void;
  readonly open: boolean;
}

export function SettingsDialog({
  developerMode,
  onClose,
  onDeveloperModeChange,
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
