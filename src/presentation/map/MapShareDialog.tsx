import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import {
  Alert,
  Box,
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
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import {
  defaultMapSharePreferences,
  type MapSharePreferences,
} from '@/application/map/MapSharePreferences';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  closeMapShare,
  mapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import {
  createMapShareUrl,
  readShareableMapState,
  selectMapShareView,
  type SatelliteBasemap,
} from '@/presentation/map/mapShareUrl';

// The same names as the quick layer chooser, so both share one catalog entry each.
const basemapLabels: Readonly<Record<SatelliteBasemap, MessageDescriptor>> = {
  'google-satellite': msg`Google Satellite`,
  'bing-satellite': msg`Bing Aerial`,
  'esri-satellite': msg`Esri World Imagery`,
  'napr-orthophoto': msg`NAPR Orthophoto`,
};

enum CopyState {
  Idle,
  Copied,
  Failed,
}

function ShareOption({
  label,
  description,
  available,
  included,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  readonly included: boolean;
  readonly onChange: (included: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <Box>
      <FormControlLabel
        sx={{ m: 0 }}
        slotProps={{ typography: { variant: 'body2' } }}
        disabled={!available}
        control={
          <Checkbox
            size="small"
            sx={{ p: 0, mr: 1 }}
            // An unavailable option keeps its stored preference but adds nothing.
            checked={available && included}
            slotProps={{ input: { 'aria-describedby': descriptionId } }}
            onChange={(event) => {
              onChange(event.target.checked);
            }}
          />
        }
        label={label}
      />
      <Typography
        id={descriptionId}
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', pl: 3.5, mt: 0.5 }}
      >
        {description}
      </Typography>
    </Box>
  );
}

/**
 * The single map share dialog, opened from the rail for the map center or from map point
 * actions for a clicked point. Its options are browser-local preferences that the
 * point action **Copy link** applies without opening the dialog.
 */
export function MapShareDialog() {
  const { t, i18n } = useLingui();
  const { database, logger, mapDiagnostics } = useRuntimeServices();
  const request = useStore(mapInteractionStore, (state) => state.shareRequest);
  // The dialog keeps rendering the last request while its exit transition runs.
  const [shownRequest, setShownRequest] = useState(request);
  if (request !== null && request !== shownRequest) setShownRequest(request);
  const subscribe = useCallback(
    (listener: () => void) => mapDiagnostics.subscribe(listener),
    [mapDiagnostics],
  );
  const getSnapshot = useCallback(() => mapDiagnostics.getSnapshot(), [mapDiagnostics]);
  const mapSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const visibility = useStore(mapLayerStore, (state) => state.visibility);
  const selectedScene = useStore(mapLayerStore, (state) => state.selectedScene);
  const [storedPreferences, setStoredPreferences] =
    useState<MapSharePreferences | null>(null);
  const [copyState, setCopyState] = useState(CopyState.Idle);
  const open = request !== null;

  useEffect(() => {
    if (!open || storedPreferences !== null) return undefined;
    let current = true;
    void database
      .loadMapSharePreferences()
      .catch((): MapSharePreferences => {
        logger.log({ level: 'warn', name: 'storage.settings.load-failed' });
        return defaultMapSharePreferences;
      })
      .then((loaded) => {
        // A choice made before the stored record arrived wins over it.
        if (current) setStoredPreferences(loaded);
      });
    return () => {
      current = false;
    };
  }, [database, logger, open, storedPreferences]);

  const preferences = storedPreferences ?? defaultMapSharePreferences;
  const changePreferences = (change: Partial<MapSharePreferences>) => {
    const next = { ...preferences, ...change };
    setStoredPreferences(next);
    void database.saveMapSharePreferences(next).catch(() => {
      logger.log({ level: 'warn', name: 'storage.settings.save-failed' });
    });
  };

  const state =
    mapSnapshot === null
      ? null
      : readShareableMapState(mapSnapshot, { visibility, selectedScene });
  const view =
    state === null || shownRequest === null
      ? null
      : selectMapShareView(state, preferences, shownRequest.center);
  const url =
    view === null || shownRequest === null
      ? ''
      : createMapShareUrl(shownRequest.pageUrl, view);
  const close = () => {
    closeMapShare();
    if (copyState === CopyState.Failed) setCopyState(CopyState.Idle);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState(CopyState.Copied);
    } catch {
      setCopyState(CopyState.Failed);
    }
  };

  let locationText: string | null = null;
  if (view !== null) {
    const coordinates = `${view.center.latitude.toFixed(5)}, ${view.center.longitude.toFixed(5)}`;
    const zoom = new Intl.NumberFormat(i18n.locale, {
      maximumFractionDigits: 2,
    }).format(view.zoom);
    locationText = t`${coordinates}, zoom ${zoom}`;
  }
  const basemap = state?.basemap ?? null;
  const basemapLabel = basemap === null ? null : basemapLabels[basemap];
  const sharedScene = (state?.sceneKey ?? null) === null ? null : selectedScene;
  let sceneText = t`No Sentinel-2 image is shown on the map.`;
  if (sharedScene !== null) {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option tokens.
    const sceneDateOptions = { dateStyle: 'long', timeZone: 'UTC' } as const;
    sceneText = new Intl.DateTimeFormat(i18n.locale, sceneDateOptions).format(
      new Date(sharedScene.acquiredAt),
    );
  }
  let cameraText = t`The map is in 2D.`;
  if (state?.terrainMode === 'terrain') {
    const bearing = Math.round(state.camera.bearing);
    const pitch = Math.round(state.camera.pitch);
    cameraText = t`3D terrain with bearing ${bearing}° and pitch ${pitch}°.`;
  }

  return (
    <>
      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>
          <Trans>Share map view</Trans>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {locationText === null ? null : (
              <Typography variant="body2" color="text.secondary">
                {locationText}
              </Typography>
            )}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                <Trans>Include in link</Trans>
              </Typography>
              <Stack spacing={1.5} sx={{ px: 1 }}>
                <ShareOption
                  label={t`Satellite layer`}
                  description={
                    basemapLabel === null
                      ? t`No satellite layer is shown on the map.`
                      : i18n._(basemapLabel)
                  }
                  available={basemapLabel !== null}
                  included={preferences.includeSatelliteLayer}
                  onChange={(includeSatelliteLayer) => {
                    changePreferences({ includeSatelliteLayer });
                  }}
                />
                <ShareOption
                  label={t`Sentinel-2 image`}
                  description={sceneText}
                  available={sharedScene !== null}
                  included={preferences.includeSentinelImage}
                  onChange={(includeSentinelImage) => {
                    changePreferences({ includeSentinelImage });
                  }}
                />
                <ShareOption
                  label={t`3D camera`}
                  description={cameraText}
                  available={state?.terrainMode === 'terrain'}
                  included={preferences.include3dCamera}
                  onChange={(include3dCamera) => {
                    changePreferences({ include3dCamera });
                  }}
                />
              </Stack>
            </Box>
            <TextField
              fullWidth
              size="small"
              label={t`Link`}
              value={url}
              slotProps={{ htmlInput: { readOnly: true } }}
              onFocus={(event) => {
                event.target.select();
              }}
            />
            {copyState === CopyState.Failed ? (
              <Alert severity="error">
                <Trans>
                  The link could not be copied. Select it and copy it manually.
                </Trans>
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1, gap: 1 }}>
          <Button size="small" onClick={close}>
            <Trans>Close</Trans>
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<ContentCopyOutlinedIcon />}
            disabled={url === ''}
            onClick={() => void copyLink()}
          >
            <Trans>Copy link</Trans>
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={copyState === CopyState.Copied}
        autoHideDuration={2_500}
        message={t`Link copied`}
        onClose={() => {
          setCopyState(CopyState.Idle);
        }}
      />
    </>
  );
}
