import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import CloseIcon from '@mui/icons-material/Close';
import TourOutlinedIcon from '@mui/icons-material/TourOutlined';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { Fragment, useId } from 'react';

import { Keycap, touchFirstQuery } from '@/presentation/KeyboardShortcutKeys';
import {
  keyboardShortcutKeyCombinations,
  keyboardShortcutKeys,
  shiftKeyLabel,
  type KeyboardShortcutAction,
} from '@/presentation/keyboardShortcuts';
import { basemapPresets } from '@/presentation/map/mapTypes';
import { MapLegend } from '@/presentation/shell/MapLegend';

interface KeyGuideRow {
  readonly label: MessageDescriptor;
  /** Key combinations, each listing the keycaps pressed together. */
  readonly combinations: readonly (readonly string[])[];
  /**
   * How combinations relate: alternatives (`or`), the two ends of a range, or a list of
   * separate keys such as the arrows.
   */
  readonly join: 'or' | 'range' | 'list';
}

interface KeyGuideGroup {
  readonly title: MessageDescriptor;
  readonly note?: MessageDescriptor;
  readonly rows: readonly KeyGuideRow[];
}

function shortcutRow(
  label: MessageDescriptor,
  action: KeyboardShortcutAction,
): KeyGuideRow {
  return {
    label,
    combinations: keyboardShortcutKeyCombinations({ action }),
    join: 'or',
  };
}

/* eslint-disable lingui/no-unlocalized-strings -- Media queries and keycap labels are machine tokens. */
/** Wide enough for the legend's three columns and the shortcuts side by side. */
const wideHelpQuery = '(width >= 1200px)';
const fullScreenHelpQuery = '(width < 600px)';

/**
 * Every global shortcut, plus Escape and MapLibre's own camera keys. Built at render
 * because keycap labels depend on the platform.
 */
function keyGuideGroups(): readonly KeyGuideGroup[] {
  const shift = shiftKeyLabel();
  const lastBasemap = basemapPresets.at(-1) ?? basemapPresets[0];
  return [
    {
      title: msg`Workspace`,
      rows: [
        shortcutRow(msg`Search places, coordinates, and tracks`, 'focus-search'),
        shortcutRow(msg`Show or hide the navigation`, 'toggle-navigation'),
        shortcutRow(msg`Plan a route`, 'new-track'),
        shortcutRow(msg`Place a marker`, 'place-marker'),
        shortcutRow(msg`Choose a forecast point`, 'select-forecast-point'),
        shortcutRow(msg`Search satellite scenes at the map centre`, 'search-satellite'),
        shortcutRow(msg`Copy a link to this map view`, 'copy-map-link'),
        {
          label: msg`Cancel placing, point selection, or the ruler`,
          combinations: [['Esc']],
          join: 'or',
        },
      ],
    },
    {
      title: msg`Tracks`,
      rows: [
        shortcutRow(msg`Fit the map to the track`, 'fit-track'),
        shortcutRow(msg`Undo the last edit`, 'undo'),
        shortcutRow(msg`Save the track`, 'save'),
        shortcutRow(msg`Open a track file`, 'import-track'),
        shortcutRow(msg`Download the track as GPX`, 'download-gpx'),
      ],
    },
    {
      title: msg`Map`,
      rows: [
        {
          label: msg`Choose a base map`,
          combinations: [
            keyboardShortcutKeys({
              action: 'select-basemap',
              preset: basemapPresets[0],
            }),
            keyboardShortcutKeys({ action: 'select-basemap', preset: lastBasemap }),
          ],
          join: 'range',
        },
        {
          label: msg`Next or previous base map`,
          combinations: [
            keyboardShortcutKeys({ action: 'next-basemap' }),
            keyboardShortcutKeys({ action: 'previous-basemap' }),
          ],
          join: 'or',
        },
        shortcutRow(msg`Show Sentinel-2 imagery`, 'show-sentinel-2'),
        shortcutRow(msg`Turn the OSM overlay on or off`, 'toggle-osm-overlay'),
        shortcutRow(msg`Switch between 2D and 3D`, 'toggle-terrain'),
        shortcutRow(msg`Turn the map north`, 'north-up'),
        shortcutRow(msg`Turn the ruler on or off`, 'toggle-ruler'),
        shortcutRow(msg`Find my location`, 'geolocate'),
      ],
    },
    {
      title: msg`Map camera`,
      note: msg`After you click the map.`,
      rows: [
        {
          label: msg`Move the map`,
          combinations: [['←'], ['↑'], ['→'], ['↓']],
          join: 'list',
        },
        { label: msg`Zoom in or out`, combinations: [['+'], ['−']], join: 'list' },
        {
          label: msg`Rotate`,
          combinations: [
            [shift, '←'],
            [shift, '→'],
          ],
          join: 'or',
        },
        {
          label: msg`Tilt`,
          combinations: [
            [shift, '↑'],
            [shift, '↓'],
          ],
          join: 'or',
        },
      ],
    },
  ];
}
/* eslint-enable lingui/no-unlocalized-strings */

function KeyCombinations({ row }: { readonly row: KeyGuideRow }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'flex-end',
        columnGap: 0.75,
        rowGap: 0.5,
      }}
    >
      {row.combinations.map((keys, index) => (
        <Fragment key={keys.join(' ')}>
          {index === 0 || row.join === 'list' ? null : (
            <Typography component="span" variant="caption" color="text.secondary">
              {row.join === 'range' ? '–' : <Trans>or</Trans>}
            </Typography>
          )}
          <Box component="span" sx={{ display: 'inline-flex', gap: 0.5 }}>
            {keys.map((key) => (
              <Keycap key={key} label={key} />
            ))}
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}

function KeyboardGuide() {
  const { i18n } = useLingui();
  const titleId = useId();
  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      sx={{ minWidth: 0, flex: { lg: '0 0 360px' } }}
    >
      <Typography
        id={titleId}
        component="h3"
        variant="subtitle2"
        sx={{ fontWeight: 700, mb: 1 }}
      >
        <Trans>Keyboard shortcuts</Trans>
      </Typography>
      <Stack spacing={1.5}>
        {keyGuideGroups().map((group) => (
          <Box key={group.title.id}>
            <Typography
              variant="caption"
              color="text.secondary"
              component="h4"
              sx={{ fontWeight: 700 }}
            >
              {i18n._(group.title)}
            </Typography>
            {group.note === undefined ? null : (
              <Typography variant="caption" color="text.secondary" component="p">
                {i18n._(group.note)}
              </Typography>
            )}
            <Box
              component="dl"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'center',
                columnGap: 2,
                rowGap: 0.5,
                m: 0,
                mt: 0.5,
              }}
            >
              {group.rows.map((row) => (
                <Fragment key={row.label.id}>
                  <Typography component="dt" variant="body2">
                    {i18n._(row.label)}
                  </Typography>
                  <Box component="dd" sx={{ m: 0, textAlign: 'right' }}>
                    <KeyCombinations row={row} />
                  </Box>
                </Fragment>
              ))}
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

/**
 * The map legend and, unless the primary pointer is coarse, the keyboard shortcuts. Wide
 * viewports place them side by side with a vertical divider; narrower ones stack them.
 */
export function HelpPanel() {
  const wide = useMediaQuery(wideHelpQuery);
  const touchFirst = useMediaQuery(touchFirstQuery);
  return (
    <Stack
      direction={wide ? 'row' : 'column'}
      spacing={3}
      divider={<Divider flexItem orientation={wide ? 'vertical' : 'horizontal'} />}
    >
      <MapLegend />
      {touchFirst ? null : <KeyboardGuide />}
    </Stack>
  );
}

/** Help opened from the rail; `onStartTour` is `null` where the tour is unavailable. */
export function HelpDialog({
  open,
  onClose,
  onStartTour,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onStartTour: (() => void) | null;
}) {
  const { t } = useLingui();
  const fullScreen = useMediaQuery(fullScreenHelpQuery);
  return (
    <Dialog open={open} onClose={onClose} maxWidth={false} fullScreen={fullScreen}>
      <DialogTitle sx={{ pr: 7 }}>
        <Trans>Help</Trans>
      </DialogTitle>
      <DialogContent>
        <HelpPanel />
      </DialogContent>
      {onStartTour === null ? null : (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="contained"
            startIcon={<TourOutlinedIcon />}
            onClick={onStartTour}
          >
            <Trans>Take a tour!</Trans>
          </Button>
        </DialogActions>
      )}
      {/* A sibling of the title, so the dialog's accessible name stays "Help". */}
      <IconButton
        size="small"
        aria-label={t`Close`}
        onClick={onClose}
        sx={{ position: 'absolute', top: 12, right: 12 }}
      >
        <CloseIcon sx={{ fontSize: 20 }} />
      </IconButton>
    </Dialog>
  );
}
