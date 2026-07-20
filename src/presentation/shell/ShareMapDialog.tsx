import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { satelliteSceneKey } from '@/domain/satellite/SatelliteScene';
import { createMapShareUrl } from '@/presentation/map/mapShareUrl';

interface ShareMapDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ShareMapDialog({ open, onClose }: ShareMapDialogProps) {
  const { mapDiagnostics, mapLayers } = useRuntimeServices();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const camera = mapDiagnostics.getSnapshot()?.camera;
  const scene = mapLayers?.getAppliedScene() ?? null;
  const shareUrl =
    camera === undefined
      ? ''
      : createMapShareUrl(
          window.location.href,
          camera,
          scene === null ? null : satelliteSceneKey(scene),
        );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>Share this map view</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The link includes the map center, zoom, and applied satellite scene. Device
            location is never added automatically.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Share link"
            value={shareUrl}
            slotProps={{ htmlInput: { readOnly: true } }}
          />
          {copyState === 'failed' ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              The link could not be copied. Select it and copy it manually.
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="contained"
            startIcon={<ContentCopyOutlinedIcon />}
            disabled={shareUrl === ''}
            onClick={() => void copyLink()}
          >
            Copy link
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={copyState === 'copied'}
        autoHideDuration={2_500}
        message="Share link copied"
        onClose={() => {
          setCopyState('idle');
        }}
      />
    </>
  );
}
