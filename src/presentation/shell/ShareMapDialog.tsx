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
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/useRuntimeServices';
import { satelliteSceneKey } from '@/domain/satellite/SatelliteScene';
import { createMapShareUrl } from '@/presentation/map/mapShareUrl';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';

interface ShareMapDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ShareMapDialog({ open, onClose }: ShareMapDialogProps) {
  const { mapDiagnostics, mapLayers } = useRuntimeServices();
  const [copyState, setCopyState] = useState<
    'idle' | 'copied-2d' | 'copied-3d' | 'failed'
  >('idle');
  const subscribe = useCallback(
    (listener: () => void) => mapDiagnostics.subscribe(listener),
    [mapDiagnostics],
  );
  const getSnapshot = useCallback(() => mapDiagnostics.getSnapshot(), [mapDiagnostics]);
  const mapSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const selectedScene = useStore(mapLayerStore, (state) => state.selectedScene);
  const camera = mapSnapshot?.camera;
  const scene = selectedScene ?? mapLayers?.getSelectedScene() ?? null;
  const sceneKey = scene === null ? null : satelliteSceneKey(scene);
  const share2dUrl =
    camera === undefined
      ? ''
      : createMapShareUrl(window.location.href, camera, sceneKey);
  const share3dUrl =
    camera === undefined || mapSnapshot?.terrainMode !== 'terrain'
      ? ''
      : createMapShareUrl(window.location.href, camera, sceneKey, {
          mode: '3d',
          bearing: camera.bearing,
          pitch: camera.pitch,
        });

  const copyLink = async (value: string, copiedState: 'copied-2d' | 'copied-3d') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(copiedState);
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
            The 2D link always shares center and zoom. When a satellite scene is
            selected, its identity is included without storing the scene locally.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="2D share link"
            value={share2dUrl}
            slotProps={{ htmlInput: { readOnly: true } }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            disabled={share3dUrl === ''}
            label="3D share link"
            value={share3dUrl}
            helperText={
              share3dUrl === ''
                ? 'Enable the 3D terrain map to share bearing and pitch.'
                : 'This link includes the current bearing and pitch.'
            }
            slotProps={{ htmlInput: { readOnly: true } }}
            sx={{ mt: 2 }}
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
            startIcon={<ContentCopyOutlinedIcon />}
            disabled={share3dUrl === ''}
            onClick={() => void copyLink(share3dUrl, 'copied-3d')}
          >
            Copy 3D link
          </Button>
          <Button
            variant="contained"
            startIcon={<ContentCopyOutlinedIcon />}
            disabled={share2dUrl === ''}
            onClick={() => void copyLink(share2dUrl, 'copied-2d')}
          >
            Copy 2D link
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={copyState === 'copied-2d' || copyState === 'copied-3d'}
        autoHideDuration={2_500}
        message={
          copyState === 'copied-3d' ? '3D share link copied' : '2D share link copied'
        }
        onClose={() => {
          setCopyState('idle');
        }}
      />
    </>
  );
}
