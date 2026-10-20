import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CompareOutlinedIcon from '@mui/icons-material/CompareOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import lookupTimeZone from '@photostructure/tz-lookup';
import {
  Box,
  Button,
  IconButton,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  satelliteSceneBounds,
  satelliteSceneKey,
  type SatelliteScene,
} from '@/domain/satellite/SatelliteScene';
import { createComparisonShareUrl } from '@/presentation/map/mapShareUrl';
import { appColors } from '@/presentation/theme/appColors';
import {
  clearComparedScenes,
  closeComparison,
  maximumComparedScenes,
  minimumComparedScenes,
  openComparison,
  removeComparedScene,
  satelliteCompareStore,
} from '@/presentation/satellite-browser/satelliteCompareStore';

/** Zoom used when the main map has no camera yet, roughly one Sentinel tile. */
const fallbackComparisonZoom = 10;

/**
 * Pinned at the bottom of the results pane once a scene is added: the comparison count,
 * **Compare** (two or more scenes), and **Clear**.
 */
export function SatelliteComparisonTray() {
  const { t } = useLingui();
  const { mapDiagnostics } = useRuntimeServices();
  const scenes = useStore(satelliteCompareStore, (state) => state.scenes);
  const firstScene = scenes[0];
  if (firstScene === undefined) return null;

  const count = scenes.length;
  const canCompare = count >= minimumComparedScenes;
  const open = () => {
    const camera = mapDiagnostics.getSnapshot()?.camera;
    if (camera !== undefined) {
      openComparison({
        center: { longitude: camera.longitude, latitude: camera.latitude },
        zoom: camera.zoom,
      });
      return;
    }
    const [west, south, east, north] = satelliteSceneBounds(firstScene);
    openComparison({
      center: { longitude: (west + east) / 2, latitude: (south + north) / 2 },
      zoom: fallbackComparisonZoom,
    });
  };

  return (
    <Stack
      role="region"
      aria-label={t`Image comparison`}
      direction="row"
      spacing={1}
      sx={{
        minHeight: 56,
        px: 2,
        alignItems: 'center',
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: appColors.surface.subtle,
      }}
    >
      <CompareOutlinedIcon color="primary" fontSize="small" />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
        <Trans>
          Comparison: {count} of {maximumComparedScenes}
        </Trans>
      </Typography>
      <Button color="inherit" onClick={clearComparedScenes}>
        <Trans>Clear</Trans>
      </Button>
      <Tooltip title={canCompare ? '' : t`Add at least two images`}>
        <span>
          <Button variant="contained" disabled={!canCompare} onClick={open}>
            <Trans>Compare</Trans>
          </Button>
        </span>
      </Tooltip>
    </Stack>
  );
}

function sceneTimeZone(scene: SatelliteScene): string {
  const [west, south, east, north] = satelliteSceneBounds(scene);
  return lookupTimeZone((south + north) / 2, (west + east) / 2);
}

/** Sidebar content while the comparison grid replaces the map. */
export function SatelliteComparisonPanel() {
  const { i18n, t } = useLingui();
  const scenes = useStore(satelliteCompareStore, (state) => state.scenes);
  const sceneCount = scenes.length;
  const camera = useStore(satelliteCompareStore, (state) => state.camera);
  const [copyLinkStatus, setCopyLinkStatus] = useState<'idle' | 'copied' | 'failed'>(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
    'idle',
  );
  /* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
  const formats = useMemo(
    () => ({
      day: (acquiredAt: Date, timeZone: string) =>
        new Intl.DateTimeFormat(i18n.locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone,
        }).format(acquiredAt),
      time: (acquiredAt: Date, timeZone: string) =>
        new Intl.DateTimeFormat(i18n.locale, {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone,
          timeZoneName: 'short',
        }).format(acquiredAt),
      percent: new Intl.NumberFormat(i18n.locale, {
        style: 'percent',
        maximumFractionDigits: 0,
      }),
    }),
    [i18n.locale],
  );
  /* eslint-enable lingui/no-unlocalized-strings */

  const copyLink = async () => {
    if (camera === null) return;
    try {
      await navigator.clipboard.writeText(
        createComparisonShareUrl(
          window.location.href,
          camera.center,
          camera.zoom,
          scenes.map(satelliteSceneKey),
        ),
      );
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setCopyLinkStatus('copied');
    } catch {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
      setCopyLinkStatus('failed');
    }
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Box>
        <Button
          color="inherit"
          startIcon={<ArrowBackOutlinedIcon />}
          onClick={closeComparison}
          sx={{ ml: -1 }}
        >
          <Trans>Back to search</Trans>
        </Button>
      </Box>
      <Typography component="h3" variant="subtitle2">
        {t`${plural(sceneCount, {
          one: 'Comparing # image',
          other: 'Comparing # images',
        })}`}
      </Typography>
      <Stack component="ul" spacing={0} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {scenes.map((scene) => {
          const acquiredAt = new Date(scene.acquiredAt);
          const timeZone = sceneTimeZone(scene);
          const day = formats.day(acquiredAt, timeZone);
          const time = formats.time(acquiredAt, timeZone);
          const cloud = formats.percent.format(
            Math.round(scene.cloudCoverPercent) / 100,
          );
          return (
            <Stack
              component="li"
              key={satelliteSceneKey(scene)}
              direction="row"
              spacing={1}
              sx={{
                py: 1,
                alignItems: 'center',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">{day}</Typography>
                <Typography variant="caption" color="text.secondary">
                  <Trans>
                    {time} · {cloud} cloud
                  </Trans>
                </Typography>
              </Box>
              <Tooltip title={t`Remove ${day} from comparison`}>
                <IconButton
                  aria-label={t`Remove ${day} from comparison`}
                  onClick={() => {
                    removeComparedScene(satelliteSceneKey(scene));
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          );
        })}
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          startIcon={<ShareOutlinedIcon />}
          disabled={camera === null}
          onClick={() => void copyLink()}
        >
          <Trans>Share link</Trans>
        </Button>
        <Button color="inherit" onClick={clearComparedScenes}>
          <Trans>Clear</Trans>
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        <Trans>Imagery: Copernicus Sentinel data via Element 84 Earth Search.</Trans>
      </Typography>
      <Snackbar
        open={copyLinkStatus !== 'idle'}
        autoHideDuration={copyLinkStatus === 'copied' ? 2_500 : 4_000}
        message={
          copyLinkStatus === 'copied'
            ? t`Comparison link copied`
            : t`Clipboard access failed. Try again.`
        }
        onClose={() => {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- State token.
          setCopyLinkStatus('idle');
        }}
      />
    </Stack>
  );
}
