import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
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
import { CopyLinkButton } from '@/presentation/map/CopyLinkButton';
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
import { TrackShareTable } from '@/presentation/tracks/TrackShareTable';

// The same names as the quick layer chooser, so both share one catalog entry each.
const basemapLabels: Readonly<Record<SatelliteBasemap, MessageDescriptor>> = {
  'google-satellite': msg`Google Satellite`,
  'bing-satellite': msg`Bing Aerial`,
  'esri-satellite': msg`Esri World Imagery`,
  'napr-orthophoto': msg`NAPR Orthophoto`,
};

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
 * The single Share dialog, opened from the rail for the map center or from map point
 * actions for a clicked point. Its map options are browser-local preferences that the
 * point action **Copy link** applies without opening the dialog. Below the map link,
 * the tracks drawn on the map get their own public links built on that map link.
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
  // Null until the stored record loads; the link and options wait for it so a copy or
  // change never starts from defaults that would overwrite the stored choices.
  const [preferences, setPreferences] = useState<MapSharePreferences | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const open = request !== null;

  useEffect(() => {
    if (!open || preferences !== null) return undefined;
    let current = true;
    void database
      .loadMapSharePreferences()
      .catch((): MapSharePreferences => {
        logger.log({ level: 'warn', name: 'storage.settings.load-failed' });
        return defaultMapSharePreferences;
      })
      .then((loaded) => {
        if (current) setPreferences(loaded);
      });
    return () => {
      current = false;
    };
  }, [database, logger, open, preferences]);

  const changePreferences = (change: Partial<MapSharePreferences>) => {
    if (preferences === null) return;
    const next = { ...preferences, ...change };
    setPreferences(next);
    void database.saveMapSharePreferences(next).catch(() => {
      logger.log({ level: 'warn', name: 'storage.settings.save-failed' });
    });
  };

  const state =
    mapSnapshot === null
      ? null
      : readShareableMapState(mapSnapshot, { visibility, selectedScene });
  const view =
    state === null || shownRequest === null || preferences === null
      ? null
      : selectMapShareView(state, preferences, shownRequest.center);
  const url =
    view === null || shownRequest === null
      ? ''
      : createMapShareUrl(shownRequest.pageUrl, view);
  const close = () => {
    closeMapShare();
    setCopyFailed(false);
  };
  const copyLink = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      return true;
    } catch {
      setCopyFailed(true);
      return false;
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
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>
        <Trans>Share</Trans>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              <Trans>Map view</Trans>
            </Typography>
            {locationText === null ? null : (
              <Typography variant="body2" color="text.secondary">
                {locationText}
              </Typography>
            )}
          </Box>
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
                available={preferences !== null && basemapLabel !== null}
                included={preferences?.includeSatelliteLayer ?? false}
                onChange={(includeSatelliteLayer) => {
                  changePreferences({ includeSatelliteLayer });
                }}
              />
              <ShareOption
                label={t`Sentinel-2 image`}
                description={sceneText}
                available={preferences !== null && sharedScene !== null}
                included={preferences?.includeSentinelImage ?? false}
                onChange={(includeSentinelImage) => {
                  changePreferences({ includeSentinelImage });
                }}
              />
              <ShareOption
                label={t`3D camera`}
                description={cameraText}
                available={preferences !== null && state?.terrainMode === 'terrain'}
                included={preferences?.include3dCamera ?? false}
                onChange={(include3dCamera) => {
                  changePreferences({ include3dCamera });
                }}
              />
            </Stack>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
            <CopyLinkButton
              label={t`Copy map link`}
              variant="contained"
              disabled={url === ''}
              copy={copyLink}
            />
          </Stack>
          {copyFailed ? (
            <Alert severity="error">
              <Trans>
                The link could not be copied. Select it and copy it manually.
              </Trans>
            </Alert>
          ) : null}
          <TrackShareTable mapUrl={url} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
        <Button size="small" onClick={close}>
          <Trans>Close</Trans>
        </Button>
      </DialogActions>
    </Dialog>
  );
}
