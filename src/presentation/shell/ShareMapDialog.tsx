import { Trans, useLingui } from '@lingui/react/macro';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { satelliteSceneKey } from '@/domain/satellite/SatelliteScene';
import { createMapShareUrl } from '@/presentation/map/mapShareUrl';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';

interface ShareMapDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

enum CopyState {
  Idle,
  Copied2d,
  Copied3d,
  Failed,
}

const shareDialogMaxWidth = 'sm' as const;

export function ShareMapDialog({ open, onClose }: ShareMapDialogProps) {
  const { t } = useLingui();
  const { mapDiagnostics, mapLayers } = useRuntimeServices();
  const [copyState, setCopyState] = useState(CopyState.Idle);
  const [excludedSceneKey, setExcludedSceneKey] = useState<string | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => mapDiagnostics.subscribe(listener),
    [mapDiagnostics],
  );
  const getSnapshot = useCallback(() => mapDiagnostics.getSnapshot(), [mapDiagnostics]);
  const mapSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const selectedScene = useStore(mapLayerStore, (state) => state.selectedScene);
  const camera = mapSnapshot?.camera;
  const scene = selectedScene ?? mapLayers?.getSelectedScene() ?? null;
  const selectedSceneKey = scene === null ? null : satelliteSceneKey(scene);
  const includeSatellite =
    selectedSceneKey !== null && selectedSceneKey !== excludedSceneKey;
  const sceneKey = includeSatellite ? selectedSceneKey : null;
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

  const copyLink = async (
    value: string,
    copiedState: CopyState.Copied2d | CopyState.Copied3d,
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(copiedState);
    } catch {
      setCopyState(CopyState.Failed);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={() => {
          setExcludedSceneKey(null);
          onClose();
        }}
        fullWidth
        maxWidth={shareDialogMaxWidth}
      >
        <DialogTitle>
          <Trans>Share this map view</Trans>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            <Trans>
              The 2D link always shares center and zoom. A selected satellite image can
              be included without storing the scene locally.
            </Trans>
          </Typography>
          <Stack spacing={1.5}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              label={t`2D share link`}
              value={share2dUrl}
              slotProps={{ htmlInput: { readOnly: true } }}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              disabled={share3dUrl === ''}
              label={t`3D share link`}
              value={share3dUrl}
              helperText={
                share3dUrl === ''
                  ? t`Enable the 3D terrain map to share bearing and pitch.`
                  : t`This link includes the current bearing and pitch.`
              }
              slotProps={{ htmlInput: { readOnly: true } }}
            />
            <FormControlLabel
              sx={{ m: 0 }}
              slotProps={{ typography: { variant: 'body2' } }}
              control={
                <Checkbox
                  size="small"
                  sx={{ p: 0, mr: 1 }}
                  checked={includeSatellite}
                  disabled={selectedSceneKey === null}
                  onChange={(_, checked) => {
                    setExcludedSceneKey(checked ? null : selectedSceneKey);
                  }}
                />
              }
              label={t`Include selected satellite image`}
            />
          </Stack>
          {copyState === CopyState.Failed ? (
            // MUI's severity token is not user-visible copy.
            // eslint-disable-next-line -- MUI severity token, not user-visible copy.
            <Alert severity="error">
              <Trans>
                The link could not be copied. Select it and copy it manually.
              </Trans>
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1, gap: 1 }}>
          <Button
            size="small"
            onClick={() => {
              setExcludedSceneKey(null);
              onClose();
            }}
          >
            <Trans>Close</Trans>
          </Button>
          <Button
            size="small"
            startIcon={<ContentCopyOutlinedIcon />}
            disabled={share3dUrl === ''}
            onClick={() => void copyLink(share3dUrl, CopyState.Copied3d)}
          >
            <Trans>Copy 3D link</Trans>
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<ContentCopyOutlinedIcon />}
            disabled={share2dUrl === ''}
            onClick={() => void copyLink(share2dUrl, CopyState.Copied2d)}
          >
            <Trans>Copy 2D link</Trans>
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={copyState === CopyState.Copied2d || copyState === CopyState.Copied3d}
        autoHideDuration={2_500}
        message={
          copyState === CopyState.Copied3d
            ? t`3D share link copied`
            : t`2D share link copied`
        }
        onClose={() => {
          setCopyState(CopyState.Idle);
        }}
      />
    </>
  );
}
